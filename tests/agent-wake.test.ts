// The operations agent is woken through its webhook when a problem is first told to the owner, so it
// starts on it at once. Ways it can go wrong:
// - a new reader-facing or owner-facing problem is not handed over, or the worker going down is not;
// - hourly reminders, recoveries or follow-ups wake it again and again (each wake is a paid agent run);
// - an agent that is unreachable or refuses stops the owner's alert, or makes the next check send it again;
// - the request lacks the key, or carries it anywhere but the Authorization header;
// - it is woken where no webhook is configured, or where outward actions are off (FEISHU_INTERNAL_ENABLED, as
//   for the owner's alerts: development and rehearsal may hold production credentials);
// - a check that fails half way and is retried wakes it again for a problem it already woke it for.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { closeDb, sql } from "@agidawn/backend/db";
import { getBoss, stopBoss } from "@agidawn/backend/jobs/queue";
import { installModules, type ServerModule } from "@agidawn/backend/modules";
import type { Finding } from "@agidawn/backend/notify/feishu";
import { claimAgentWake } from "@agidawn/backend/notify/agent";
import { checkAlerts } from "@agidawn/backend/operations/alerts";
import { checkWorkerHeartbeat } from "@agidawn/backend/operations/watch";

const T = tag();
const KEY = `test-agent-key-${T}`;
let found: Finding[] = [];
const fake: ServerModule = { name: "fake", alerts: async () => found };
installModules([fake]);
process.env.COLLECT_ENABLED = "false";

const wakes: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];
let status = 200;
const agent = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    wakes.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(status, { "content-type": "application/json" });
    res.end("{}");
  });
});

before(async () => {
  await getBoss(); // collectFindings reads the job tables
  await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", () => resolve()));
});
beforeEach(async () => {
  found = [];
  wakes.length = 0;
  status = 200;
  const { port } = agent.address() as { port: number };
  process.env.AGENT_WEBHOOK_URL = `http://127.0.0.1:${port}/automations/webhook/${T}`;
  process.env.AGENT_WEBHOOK_KEY = KEY;
  process.env.FEISHU_INTERNAL_ENABLED = "true"; // no alert chat is set, so no Feishu message goes out
  await sql`DELETE FROM settings WHERE key IN ('alerts.state', 'heartbeat.worker', 'watchdog.worker') OR key LIKE 'agent.wake.%'`;
});
after(async () => {
  delete process.env.AGENT_WEBHOOK_URL;
  delete process.env.AGENT_WEBHOOK_KEY;
  delete process.env.FEISHU_INTERNAL_ENABLED;
  await new Promise<void>((resolve) => agent.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

const MIN = 60_000;
const down: Finding = { key: "content.collect", level: "now", title: "网站停止收录新文章", impact: "读者看不到新文章", detail: "近 2 小时 0 篇" };
const balance: Finding = { key: "balance.jina", level: "today", title: "Jina 余额不足" };
const quiet: Finding = { key: "sources.unstable.x", level: "later", title: "信源反复抓取失败" };
const woken = () => wakes.map((w) => w.body.key);

test("a new problem wakes the agent once; reminders, recoveries and follow-ups do not", async () => {
  const t0 = Date.now();
  found = [down, balance, quiet];
  await checkAlerts(t0);
  assert.deepEqual(woken().sort(), ["balance.jina", "content.collect"], "each newly told problem, follow-ups excluded");
  const w = wakes.find((x) => x.body.key === "content.collect")!;
  assert.equal(w.auth, `Bearer ${KEY}`);
  assert.equal(w.path, `/automations/webhook/${T}`, "the key is not put in the address");
  assert.ok(!JSON.stringify(w.body).includes(KEY), "nor in the body");
  assert.deepEqual([w.body.level, w.body.title, w.body.detail], ["now", down.title, down.detail], "what it needs to start on the problem");

  await checkAlerts(t0 + 61 * MIN);
  assert.equal(wakes.length, 2, "the hourly reminder does not wake it again");
  found = [balance, quiet];
  await checkAlerts(t0 + 70 * MIN);
  assert.equal(wakes.length, 2, "nor does the recovery");
  found = [down, balance, quiet];
  await checkAlerts(t0 + 80 * MIN);
  assert.deepEqual(woken().slice(2), ["content.collect"], "a problem that comes back is new again");
});

test("an agent that refuses or cannot be reached does not hold up or repeat the owner's alert", async () => {
  const t0 = Date.now();
  status = 500;
  found = [down];
  const r = await checkAlerts(t0);
  assert.deepEqual(r.sent, ["content.collect"], "the owner's alert is recorded as sent");
  assert.equal(wakes.length, 1);
  assert.deepEqual((await checkAlerts(t0 + 10 * MIN)).sent, [], "nothing is sent again at the next check");

  await sql`DELETE FROM settings WHERE key = 'alerts.state'`;
  process.env.AGENT_WEBHOOK_URL = "http://127.0.0.1:9/automations/webhook/unreachable";
  assert.deepEqual((await checkAlerts(t0 + 20 * MIN)).sent, ["content.collect"]);
});

test("nothing is woken where no webhook is configured or outward actions are off", async () => {
  found = [down];
  process.env.FEISHU_INTERNAL_ENABLED = "false";
  await checkAlerts(Date.now());
  await sql`DELETE FROM settings WHERE key = 'alerts.state'`;
  process.env.FEISHU_INTERNAL_ENABLED = "true";
  delete process.env.AGENT_WEBHOOK_URL;
  await checkAlerts(Date.now());
  assert.equal(wakes.length, 0);
});

test("a check that fails after telling a problem wakes the agent only once the problem is recorded as told", async () => {
  // Feishu takes the first alert and refuses the second; the check is retried, as the job queue does.
  let messages = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://open.feishu.cn/")) return realFetch(input, init);
    if (url.includes("tenant_access_token")) return Response.json({ code: 0, tenant_access_token: "fictional", expire: 7200 });
    messages += 1;
    return Response.json(messages === 2 ? { code: 99, msg: "synthetic send failure" } : { code: 0, data: { message_id: `m${messages}` } });
  }) as typeof fetch;
  Object.assign(process.env, { FEISHU_APP_ID: "test-app", FEISHU_APP_SECRET: "test-secret", FEISHU_ALERT_CHAT_ID: `oc_test_${T}` });
  try {
    const t0 = Date.now();
    found = [down, balance];
    await assert.rejects(checkAlerts(t0), /synthetic send failure/);
    assert.equal(wakes.length, 0, "nothing woken before the told state is saved");
    await checkAlerts(t0 + MIN);
    await checkAlerts(t0 + 2 * MIN);
    assert.deepEqual(woken().sort(), ["balance.jina", "content.collect"], "each woken once, after the retry saved them");
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_ALERT_CHAT_ID"]) delete process.env[k];
  }
});

test("the worker going down wakes the agent once, its recovery does not", async () => {
  const beat = (stale: boolean) => sql`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('heartbeat.worker', '{}', 'test', ${new Date(Date.now() - (stale ? 61 * MIN : 0))})
    ON CONFLICT (key) DO UPDATE SET updated_at = EXCLUDED.updated_at`;
  await beat(false);
  await checkWorkerHeartbeat();
  await beat(true);
  await checkWorkerHeartbeat();
  await checkWorkerHeartbeat();
  assert.deepEqual(woken(), ["worker"]);
  await beat(false);
  await checkWorkerHeartbeat();
  assert.deepEqual(woken(), ["worker"]);
});


test("a definite refusal remains visible and can be resumed without repeating the owner's alert", async () => {
  const t0 = Date.now();
  found = [down]; status = 401;
  await checkAlerts(t0);
  const [row] = await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(row?.value.status, "refused");
  assert.ok(row?.value.eventId);
  await checkAlerts(t0+10*MIN);
  assert.equal(wakes.length, 2, "a definite refusal is resumed by the existing ten-minute check");
  await claimAgentWake(row!.value.eventId, "test-run", "test");
  const [claimed] = await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(claimed?.value.status, "claimed", "the running agent explicitly records ownership");
});

test("an unknown HTTP outcome is durable and never blindly creates a second paid run", async () => {
  const t0 = Date.now();
  found = [down]; status = 500;
  await checkAlerts(t0);
  await checkAlerts(t0+10*MIN);
  const [row] = await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(row?.value.status, "unknown");
  assert.equal(wakes.length, 1);
});

test("a recorded alert resumes its missing handoff after a process interruption", async () => {
  const t0 = Date.now();
  found = [down];
  await sql`INSERT INTO settings(key,value) VALUES('alerts.state',${sql.json({[down.key]:{title:down.title,since:new Date(t0).toISOString(),sentAt:new Date(t0).toISOString(),handoff:true}})})`;
  assert.deepEqual((await checkAlerts(t0+10*MIN)).sent, []);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]!.body.eventId, `${down.key}:${new Date(t0).toISOString()}`);
});


test("an open incident from the old version is reconciled instead of waking a possible existing run twice", async () => {
  const t0=Date.now();found=[down];
  await sql`INSERT INTO settings(key,value) VALUES('alerts.state',${sql.json({[down.key]:{title:down.title,since:new Date(t0).toISOString(),sentAt:new Date(t0).toISOString()}})})`;
  await checkAlerts(t0+10*MIN);
  assert.equal(wakes.length,0);
  const [row]=await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(row?.value.status,"unknown");
});
