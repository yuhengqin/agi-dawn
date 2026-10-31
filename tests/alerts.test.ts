// Ops alerts reach the site's operators: a problem is announced once, repeated no more than its level
// allows (hourly for reader impact), closed with one recovery message.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@agidawn/backend/db";
import { upsertMaterial } from "@agidawn/backend/content/materials";
import { getBoss, stopBoss } from "@agidawn/backend/jobs/queue";
import { checkAlerts, collectFindings, sendDigest } from "@agidawn/backend/operations/alerts";
import { assertAccepted, paidRequest } from "@agidawn/backend/providers/receipts";

process.env.COLLECT_ENABLED = "false";

const T = tag();
const SOURCE = `test-alerts-${T}`;
const stuckIds: string[] = [];
before(async () => {
  await getBoss(); // collectFindings reads the job tables
  await sql`INSERT INTO sources (id, name, kind, next_fetch_at) VALUES (${SOURCE}, 'Test alerts', 'rss', '2100-01-01')`;
  // Ten new articles that have waited three hours: new content is stuck, readers see nothing new.
  for (let i = 0; i < 10; i++) {
    const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${T}-${i}`, title: `stuck ${i}`, bodyStatus: "none", via: "fetch" });
    stuckIds.push(articleId);
  }
  // One left over from yesterday: it outlives this episode, so it must not be what dates it.
  const { articleId: straggler } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${T}-old`, title: "stuck since yesterday", bodyStatus: "none", via: "fetch" });
  stuckIds.push(straggler);
  await sql`UPDATE articles SET discovered_at = now() - interval '3 hours', processing_state = 'new' WHERE id IN ${sql(stuckIds)}`;
  await sql`UPDATE articles SET discovered_at = now() - interval '40 hours' WHERE id = ${straggler}`;
});
after(async () => {
  await stopBoss();
  await closeDb();
});

test("an outage is announced once, repeated hourly, and closed with one recovery", async () => {
  process.env.COLLECT_ENABLED = "true";
  try {
    const t0 = Date.now();
    const stuck = (sent: string[]) => sent.filter((k) => k.startsWith("content.process"));

    let r = await checkAlerts(t0);
    assert.deepEqual(stuck(r.sent), ["content.process"]);
    // The episode is dated from when it was first seen: the article left over from yesterday is a fact in
    // the detail, not the start of a backlog that built up in the last three hours.
    const [state] = await sql<{ value: Record<string, { since: string }> }[]>`SELECT value FROM settings WHERE key = 'alerts.state'`;
    assert.equal(Date.parse(state!.value["content.process"]!.since), t0, "the episode is not dated by the oldest waiting article");
    const finding = (await collectFindings(t0)).find((f) => f.key === "content.process")!;
    assert.match(finding.detail!, /最老的一篇 .* 收进/);
    r = await checkAlerts(t0 + 50 * 60_000);
    assert.deepEqual(stuck(r.sent), [], "no repeat within the hour");
    r = await checkAlerts(t0 + 61 * 60_000);
    assert.deepEqual(stuck(r.sent), ["content.process"], "hourly reminder while it lasts");

    await sql`UPDATE articles SET processing_state = 'skipped' WHERE id IN ${sql(stuckIds)}`;
    r = await checkAlerts(t0 + 70 * 60_000);
    assert.deepEqual(stuck(r.sent), ["content.process:recovered"]);
    r = await checkAlerts(t0 + 80 * 60_000);
    assert.deepEqual(stuck(r.sent), []);
  } finally {
    process.env.COLLECT_ENABLED = "false";
  }
});

// A restart, a paused valve, or old failures leaving the initial detection window cannot
// close an open incident. A partial repair must keep the remaining work visible.
test("content incidents survive restarts, pauses, aging failures and partial recovery", async () => {
  process.env.COLLECT_ENABLED = "true";
  const now = Date.now();
  const sent = (result: Awaited<ReturnType<typeof checkAlerts>>) => result.sent.filter(k => k.startsWith("content.process"));
  try {
    await sql`UPDATE articles SET processing_state='new',discovered_at=${new Date(now - 3 * 3600_000)} WHERE id IN ${sql(stuckIds)}`;
    assert.deepEqual(sent(await checkAlerts(now)), ["content.process"]);
    await sql`INSERT INTO settings(key,value) VALUES('heartbeat.worker',${sql.json({ startedAt: new Date(now + 60_000).toISOString() })})`;
    assert.deepEqual(sent(await checkAlerts(now + 2 * 60_000)), [], "a restart does not resolve the backlog");
    assert.ok((await collectFindings(now + 2 * 60_000)).some(f => f.key === "content.process"));
    process.env.COLLECT_ENABLED = "false";
    assert.deepEqual(sent(await checkAlerts(now + 3 * 60_000)), [], "pausing processing is not recovery");
    process.env.COLLECT_ENABLED = "true";
    await sql`UPDATE articles SET discovered_at=${new Date(now - 3600_000)} WHERE id IN ${sql(stuckIds)}`;
    assert.deepEqual(sent(await checkAlerts(now + 4 * 60_000)), [], "requeued failed work is not complete before the two-hour waiting threshold");
    await sql`UPDATE articles SET processing_state='failed',discovered_at=${new Date(now - 2 * 3600_000)} WHERE id IN ${sql(stuckIds)}`;
    assert.deepEqual(sent(await checkAlerts(now + 2 * 3600_000)), ["content.process"], "unresolved failures do not age out");
    await sql`UPDATE articles SET processing_state='skipped' WHERE id IN ${sql(stuckIds.slice(1))}`;
    assert.deepEqual(sent(await checkAlerts(now + 2 * 3600_000 + 60_000)), [], "one unfinished article still blocks recovery");
    await sql`UPDATE articles SET processing_state='skipped' WHERE id=${stuckIds[0]!}`;
    assert.deepEqual(sent(await checkAlerts(now + 2 * 3600_000 + 2 * 60_000)), ["content.process:recovered"]);
  } finally {
    await sql`DELETE FROM settings WHERE key='heartbeat.worker'`;
    await sql`UPDATE articles SET processing_state='skipped' WHERE id IN ${sql(stuckIds)}`;
    process.env.COLLECT_ENABLED = "false";
  }
});

// Backup failures may overwrite the latest-attempt summary. Alert age must use the last successful
// run; repeated failures must not reset it. With no success ever, age starts at the first attempt.
test("backup failures still escalate after fifty hours without a success", async () => {
  Object.assign(process.env, {
    DB_BACKUP_STORE_SECRET_ID: "test-backup-key", DB_BACKUP_STORE_SECRET_KEY: "test-backup-secret",
    DB_BACKUP_STORE_BUCKET: "test-bucket", DB_BACKUP_STORE_REGION: "test-region",
  });
  const now = Date.now();
  const old = new Date(now - 51 * 3600_000);
  try {
    await sql`INSERT INTO settings (key, value) VALUES ('backup.last', ${sql.json({ at: new Date(now).toISOString(), uploaded: false, filesError: "tar failed" })})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    await sql`INSERT INTO job_runs (job, started_at, finished_at, status) VALUES ('ops.backup', ${old}, ${old}, 'ok')`;
    await sql`INSERT INTO job_runs (job, started_at, finished_at, status) VALUES ('ops.backup', ${new Date(now)}, ${new Date(now)}, 'failed')`;
    const backup = async () => (await collectFindings(now)).filter((f) => f.key.startsWith("backup."));
    assert.equal((await backup())[0]?.level, "today", "the fresh failed attempt must not hide a stale successful backup");
    await sql`DELETE FROM job_runs WHERE job = 'ops.backup'`;
    await sql`INSERT INTO job_runs (job, started_at, finished_at, status) VALUES ('ops.backup', ${old}, ${old}, 'failed')`;
    await sql`DELETE FROM settings WHERE key = 'backup.last'`;
    assert.equal((await backup())[0]?.level, "today", "never-successful backups must also escalate");
    await sql`UPDATE job_runs SET started_at = ${new Date(now)}, finished_at = ${new Date(now)} WHERE job = 'ops.backup'`;
    assert.equal((await backup())[0]?.level, "later", "a first failed attempt does not claim two days of failure");
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith("DB_BACKUP_STORE_")) delete process.env[key];
  }
});


test("the ops digest does not describe unknown paid work as harmless or already retried", async () => {
  const lines: string[] = [];
  const log = console.log;
  const enabled = process.env.FEISHU_INTERNAL_ENABLED;
  process.env.FEISHU_INTERNAL_ENABLED = "false";
  try {
    await sql`INSERT INTO receipts(logical_key,service,purpose,status) VALUES('digest-unknown-impact','jina','body_fallback','unknown')`;
    console.log = (value: unknown) => { lines.push(String(value)); };
    await sendDigest();
    const message = lines.join("\n");
    assert.match(message, /结果.*未知|结果.*确认/);
    assert.doesNotMatch(message, /以下事项不影响读者|自动重试过一次/);
  } finally {
    console.log = log;
    if (enabled === undefined) delete process.env.FEISHU_INTERNAL_ENABLED;
    else process.env.FEISHU_INTERNAL_ENABLED = enabled;
  }
});

// The request and alert layers must agree: TPM quota errors are temporary, spending
// refusals need attention, and an unrelated input error mentioning "balance" is not an outage.
test("provider alerts use the same 429 spending classification as paid requests", async () => {
  const cases: [string, number, unknown, boolean][] = [
    ["jina", 429, { message: "rate limit reached" }, false],
    ["socialdata", 429, { error: { message: "insufficient balance" } }, true],
    ["jina", 400, { error: { message: "invalid balance parameter" } }, false],
  ];
  for (const [service, status, body, expected] of cases) {
    const purpose = `alert-429-${tag()}`;
    try {
      await assert.rejects(paidRequest({ service, purpose, identity: purpose }, async () => {
        assertAccepted(service, status, JSON.stringify(body));
        return { response: null };
      }));
      const finding = (await collectFindings()).find(f => f.key === `provider.refused.${service}`);
      assert.equal(!!finding, expected, `${service}: ${JSON.stringify(body)}`);
    } finally {
      await sql`DELETE FROM receipts WHERE purpose=${purpose}`;
      await sql`DELETE FROM settings WHERE key=${`provider.stop.${service}`}`;
    }
  }
});

test("a refused provider stays open without a newer successful call", async () => {
  const now=Date.now();
  const [r]=await sql<{id:number}[]>`INSERT INTO receipts(logical_key,service,purpose,status) VALUES('lifecycle-refusal','jina','body_fallback','failed') RETURNING id`;
  for(let n=1;n<=3;n++) await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,status,error) VALUES(${r!.id},${n},'jina','failed','jina HTTP 402 insufficient balance')`;
  assert.ok((await checkAlerts(now)).open.includes("provider.refused.jina"));
  await sql`UPDATE receipt_attempts SET started_at=now()-interval '2 hours' WHERE receipt_id=${r!.id}`;
  assert.ok((await checkAlerts(now+2*3600_000)).open.includes("provider.refused.jina"), "silence cannot establish restored access");
  await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,status) VALUES(${r!.id},4,'jina','received')`;
  assert.ok((await checkAlerts(now+2*3600_000+60_000)).sent.includes("provider.refused.jina:recovered"));
});
