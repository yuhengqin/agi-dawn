// Operations alerts. The person reading them is the site owner, not an engineer: each
// message says what readers see, whether it heals by itself and what, if anything, the owner must do.
//   now   — readers are affected and it has not healed: sent at once, repeated hourly, recovery reported.
//   today — money at risk or only the owner can act: sent at once, repeated at most daily, recovery reported.
//   later — other follow-ups: one 09:00 message a day, meant to be handed to the AI. A source's follow-up is
//           closed on its own: a fix removes it, and one judged not worth fixing is closed with a reason.
// Delivery goes through sendAlert (alert webhook or ops chat, internal-chat fallback; off unless FEISHU_INTERNAL_ENABLED).
import { beijingDay, beijingStamp } from "@agidawn/contracts/time";
import { ALERTS } from "@agidawn/site";
import { audit } from "../audit.ts";
import { sql } from "../db.ts";
import { agentHandoffs, closeAgentWake, wakeAgent } from "../notify/agent.ts";
import { duration, formatAlert, formatRecovery, sendAlert, type Finding, type Level } from "../notify/feishu.ts";
import { backupConfigured } from "./backup.ts";
import { serverModules } from "../modules.ts";
import { awaitingRelease, providerAccessRefused } from "../providers/receipts.ts";
import { SOURCE_PROBLEMS, sourceHealth } from "../sources/health.ts";

const REPEAT_MS: Record<Exclude<Level, "later">, number> = { now: 3600_000, today: 24 * 3600_000 };

// Valves default off: read at call time, only an explicit "true" turns them on.
const collecting = () => process.env.COLLECT_ENABLED === "true";
/**
 * How long the site may go without a new article before it counts as stalled (ALERT_QUIET_MINUTES, else
 * the site's own setting; small source lists are quieter). At most a day: the check looks one day back.
 */
const QUIET_MINUTES = Math.min(Number(process.env.ALERT_QUIET_MINUTES || ALERTS.quietMinutes), 1440);

/** One check: the problems it finds now. `open` retains ongoing incidents, read once per round. */
type Check = (now: number, open: AlertState) => Promise<Finding[]>;

/** Everything checked every round, in the order the findings are listed. */
const CHECKS: Check[] = [
  // Readers affected now
  contentCollection,
  contentProcessing,
  // Money, and things only the owner can do
  providerFindings,
  backupAge,
  moduleAlerts,
  // Follow-ups
  sourceFollowUps,
  unknownOutcomes,
  agentHandoffs,
  waitingQueues,
  moduleFollowUps,
];

/** Everything wrong right now, with its level. */
export async function collectFindings(now = Date.now(), open?: AlertState): Promise<Finding[]> {
  const announced = open ?? await alertState();
  const out: Finding[] = [];
  for (const check of CHECKS) out.push(...(await check(now, announced)));
  return out;
}

// Content flow, judged by outcome: whatever broke (worker, egress proxy, models, queues), readers see
// a site that stops changing. Its persisted backlog survives worker restarts and paused valves.
async function contentCollection(now: number, open: AlertState): Promise<Finding[]> {
  if (!collecting() && !open["content.collect"]) return [];
  const [last] = await sql<{ at: Date | null }[]>`SELECT max(a.discovered_at) AS at FROM articles a
    JOIN sources s ON s.id = a.source_id WHERE s.participation_mode = 'editorial' AND a.discovered_at > now() - interval '1 day'`;
  if (last?.at && now - last.at.getTime() <= QUIET_MINUTES * 60_000) return [];
  // A site without an enabled source has nothing to collect.
  const [anySource] = await sql`SELECT 1 FROM sources WHERE enabled AND participation_mode = 'editorial' LIMIT 1`;
  if (!anySource) return [];
  return [{
    key: "content.collect",
    level: "now",
    title: "网站停止收录新文章",
    impact: last?.at ? `读者看不到新文章：最后一篇收录于 ${beijingStamp(last.at)}` : "读者看不到新文章：一天内没有收录任何文章",
    heals: ALERTS.usualFlow ? `没有，${ALERTS.usualFlow}` : "没有",
    action: "尽快发起一次维护处理",
    detail: `editorial articles.discovered_at 超过 ${QUIET_MINUTES} 分钟没有新值（热度信号单独评估）；查 sources.schedule、出网代理与采集失败`,
    since: last?.at ?? undefined,
  }];
}

/** Processing is checked while collection and models run, and while either of its incidents is open. */
const watchingProcessing = (open: AlertState) => collecting() || !!open["content.process"];

async function contentProcessing(now: number, open: AlertState): Promise<Finding[]> {
  if (!watchingProcessing(open)) return [];
  // An article still new two hours after discovery is overdue, and one failed in the last three hours counts.
  // While an announced incident is open, the windows stay where its first detection put them: time passing
  // cannot remove unfinished articles from it. The alert's duration starts at detection, not article age.
  const incident = open["content.process"];
  const detectedAt = incident ? Math.min(now, Date.parse(incident.since)) : now;
  const overdueBefore = now - 2 * 3600_000;
  const waitingAfter = new Date(detectedAt - 2 * 86400_000);
  const waitingBefore = new Date(incident ? Math.max(overdueBefore, detectedAt) : overdueBefore);
  const failedAfter = new Date(detectedAt - 3 * 3600_000);
  const unfinished = sql`(processing_state = 'new' AND discovered_at > ${waitingAfter} AND discovered_at < ${waitingBefore})
    OR (processing_state = 'failed' AND discovered_at > ${failedAfter})`;
  const [p] = await sql<{ waiting: number; failed: number; oldest: Date | null }[]>`
    SELECT count(*) FILTER (WHERE processing_state = 'new')::int AS waiting,
           count(*) FILTER (WHERE processing_state = 'failed')::int AS failed,
           min(discovered_at) FILTER (WHERE processing_state = 'new') AS oldest
    FROM articles WHERE ${unfinished}`;
  if (p!.waiting < 10 && p!.failed < 20 && !(incident && p!.waiting + p!.failed > 0)) return [];
  const errors = await sql<{ error: string; n: number }[]>`
    SELECT left(coalesce(processing_error, '（无）'), 120) AS error, count(*)::int AS n FROM articles
    WHERE (${unfinished}) AND processing_error IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 3`;
  return [{
    key: "content.process",
    level: "now",
    title: "部分文章的正文处理尚未完成",
    impact: [p!.waiting > 0 && `${p!.waiting} 篇积压文章仍在等待处理`, p!.failed > 0 && `${p!.failed} 篇处理失败的文章仍未补齐`]
      .filter(Boolean)
      .join("；") + "；文章条目和原文链接仍可访问",
    heals: p!.failed > 0 ? "已失败的文章需要恢复处理；服务恢复不代表积压已经补齐" : "排队中的文章会继续处理，仍需核实是否完成",
    action: "转给 AI 处理",
    // Article age is useful detail; incident duration starts at first detection.
    detail: [p!.oldest && `最老的一篇 ${beijingStamp(p!.oldest)} 收进`, errors.map((e) => `${e.error}（${e.n}）`).join("；") || "没有记录错误"].filter(Boolean).join("；"),
  }];
}

async function backupAge(now: number): Promise<Finding[]> {
  if (!backupConfigured()) return [];
  const [b] = await sql<{ value: { at: string; uploaded: boolean; filesError?: string } }[]>`SELECT value FROM settings WHERE key = 'backup.last'`;
  // A failed archive updates backup.last too. Reuse the run history so repeated failures cannot
  // reset the age; before the first success, count from the first attempt rather than from now.
  const [runs] = await sql<{ last_ok: Date | null; first_attempt: Date | null }[]>`
    SELECT max(finished_at) FILTER (WHERE status = 'ok') AS last_ok, min(started_at) AS first_attempt
    FROM job_runs WHERE job = 'ops.backup'`;
  const lastOk = Math.max(runs?.last_ok?.getTime() ?? 0, b?.value.uploaded ? Date.parse(b.value.at) : 0);
  const since = lastOk || runs?.first_attempt?.getTime() || now;
  const age = now - since;
  const state = b?.value.filesError ? `数据库已上传，附件打包失败：${b.value.filesError}` : b?.value.uploaded === false ? "未上传" : "";
  if (age > 50 * 3600_000) {
    return [{
      key: "backup.failed",
      level: "today",
      title: "数据库备份连续两天没成功",
      impact: lastOk ? `万一服务器出事，最近 ${duration(age)} 的数据可能无法完整恢复` : "还没有成功的完整备份，服务器出事时可能无法恢复数据",
      heals: "不会",
      action: "转给 AI 处理",
      detail: `${lastOk ? "最近一次成功" : "首次备份尝试"} ${beijingStamp(since)}${state ? `；${state}` : ""}；看 ops.backup 的运行记录`,
      since: new Date(since),
    }];
  }
  if (!b || !b.value.uploaded || age > 30 * 3600_000) {
    return [{ key: "backup.stale", level: "later", title: "数据库备份超过一天没成功", detail: b ? `最近一次 ${beijingStamp(b.value.at)}${state ? `（${state}）` : ""}；看 ops.backup` : "还没有成功的备份记录" }];
  }
  return [];
}

/** What the site's modules find. */
async function moduleAlerts(now: number): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const m of serverModules()) if (m.alerts) out.push(...(await m.alerts(now)));
  return out;
}

/**
 * One follow-up per source and problem, so fixing a source removes its own line. A quiet source is left to
 * the weekly report: being slow, or too new to have a rhythm, is nothing anyone can fix, and may never end.
 */
async function sourceFollowUps(now: number): Promise<Finding[]> {
  if (!collecting()) return [];
  return (await sourceHealth(now)).flatMap(group => SOURCE_PROBLEMS.flatMap(p => group[p.problem].map((s): Finding => ({
    key: `sources.${p.problem}.${s.id}`, level: "later", title: `${group.name}信源「${s.name}」${p.title}`,
    detail: `${s.id}：${p.describe(s)}；${p.action}`, observedAt: p.observedAt(s) ?? undefined,
  }))));
}

/** Paid requests and content-group pushes whose outcome is not known yet. */
async function unknownOutcomes(): Promise<Finding[]> {
  const out: Finding[] = [];

  const [r] = await sql<{ receipts: number; services: string | null }[]>`
    SELECT (SELECT count(*)::int FROM receipts WHERE ${awaitingRelease()}) AS receipts,
           (SELECT string_agg(DISTINCT service || '/' || purpose, '、') FROM receipts WHERE ${awaitingRelease()}) AS services`;
  if (r!.receipts > 0) {
    out.push({ key: "receipts.unknown", level: "later", title: `${r!.receipts} 个付费请求的结果尚未确认`, detail: `${r!.services}；后台“运行”页查看实际影响；仍阻塞内容的请求需核对或按已有授权恢复` });
  }
  return out;
}

/** Runnable jobs (deferred ones excluded) that have waited more than two hours. */
async function waitingQueues(now: number): Promise<Finding[]> {
  const queues = await sql<{ name: string; n: number; oldest: Date }[]>`
    SELECT name, count(*)::int AS n, min(start_after) AS oldest FROM pgboss.job
    WHERE state IN ('created', 'retry') AND start_after <= now() AND name NOT LIKE 'cron.%' GROUP BY 1`;
  return queues.filter((q) => now - q.oldest.getTime() > 2 * 3600_000).map((q): Finding => (
    { key: `queue.${q.name}`, level: "later", title: `后台任务排队超过 2 小时：${q.name}`, detail: `${q.n} 个等待，最早的等了 ${duration(now - q.oldest.getTime())}` }));
}

/** The site's modules' follow-ups. */
async function moduleFollowUps(now: number): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const m of serverModules()) if (m.followUps) out.push(...(await m.followUps(now)));
  return out;
}

const PROVIDERS:Record<string,{name:string;where:string;stops:string}>={
  socialdata:{name:"SocialData",where:"SocialData 后台",stops:"X 上的新内容可能收不到"},
  jina:{name:"Jina",where:"Jina 后台",stops:"部分文章可能取不到正文"},
  dajiala:{name:"极致了",where:"极致了后台",stops:"公众号新文章可能收不到"},
};
export const providerName=(service:string)=>PROVIDERS[service]?.name??service;
export const providerStops=async(service:string)=>PROVIDERS[service]?.stops??"相关采集服务可能受影响";
export const providerConsole=(service:string)=>PROVIDERS[service]?.where??service+" 后台";
const REFUSED_PREFIX="provider.refused.";
async function providerFindings(now:number,open:AlertState):Promise<Finding[]>{
  const ongoing=Object.keys(open).filter(key=>key.startsWith(REFUSED_PREFIX)).map(key=>key.slice(REFUSED_PREFIX.length));
  const failures=await sql`SELECT service,error,count(*)::int AS n,max(started_at) AS latest FROM receipt_attempts a
    WHERE status='failed' AND (started_at>${new Date(now-3600_000)} OR service=ANY(${ongoing})) AND error IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM receipt_attempts good WHERE good.service=a.service AND good.status='received' AND good.started_at>a.started_at)
    GROUP BY service,error ORDER BY latest DESC`;
  const refused=new Map<string,{n:number;error:string}>();
  for(const failure of failures)if(providerAccessRefused(failure.service,failure.error)){
    const prior=refused.get(failure.service);refused.set(failure.service,{n:(prior?.n??0)+Number(failure.n),error:prior?.error??failure.error});
  }
  const out:Finding[]=[];
  for(const [service,failure] of refused)out.push({key:REFUSED_PREFIX+service,level:"today",title:providerName(service)+" 拒绝调用，需要核对账号或额度",
    impact:await providerStops(service),heals:"恢复访问后，仍需确认失败任务已接续",action:"去"+providerConsole(service)+"核对余额、凭据和消费上限",
    detail:"最近一次成功后被拒 "+failure.n+" 次："+failure.error.slice(0,200)});
  const capped=await sql`SELECT b.service,b.per_day,count(a.id)::int AS used FROM budgets b
    JOIN receipt_attempts a ON a.service=b.service AND a.origin='live' AND a.started_at>now()-interval '1 day'
    WHERE b.per_day>0 GROUP BY b.service,b.per_day HAVING count(a.id)>=b.per_day`;
  for(const cap of capped)out.push({key:"budget.day."+cap.service,level:"later",title:providerName(cap.service)+" 过去 24 小时的调用额度用完了",
    impact:await providerStops(cap.service),heals:"额度按滚动窗口恢复",action:"如经常出现，可在后台调整预算",detail:"24 小时内 "+cap.used+" 次，上限 "+cap.per_day});
  return out;
}

interface AlertState {
  [key: string]: { title: string; since: string; sentAt?: string; handoff?: true };
}

async function alertState(): Promise<AlertState> {
  const [row] = await sql<{ value: AlertState }[]>`SELECT value FROM settings WHERE key = 'alerts.state'`;
  return { ...(row?.value ?? {}) };
}

/**
 * Every 10 minutes: new problems and recoveries of the now/today levels go out; follow-ups wait for 09:00.
 */
export async function checkAlerts(now = Date.now()) {
  const state = await alertState();
  const all = await collectFindings(now, state);
  const sent: string[] = [];
  for (const f of all) {
    const open = state[f.key];
    if (f.level === "later") {
      // Switching before the first check changes the impact, not whether access has recovered.
      if (f.key.startsWith(REFUSED_PREFIX) && !open) state[f.key] = { title: f.title, since: new Date(now).toISOString(), handoff: true };
      continue;
    }
    if (open?.sentAt && now - Date.parse(open.sentAt) <= REPEAT_MS[f.level]) continue;
    const since = open ? new Date(open.since) : (f.since ?? new Date(now));
    const msg = formatAlert(f, since, now, !!open?.sentAt);
    await sendAlert(msg.title, msg.lines);
    state[f.key] = { ...open, title: f.title, since: since.toISOString(), sentAt: new Date(now).toISOString(), ...(!open || open.handoff ? { handoff: true as const } : {}) };
    sent.push(f.key);
  }
  const found = new Set(all.map((f) => f.key));
  for (const [key, open] of Object.entries(state)) {
    if (found.has(key)) continue;
    if (!open.sentAt) {
      await closeAgentWake(key);
      delete state[key];
      continue;
    }
    const msg = formatRecovery(open.title, new Date(open.since), now);
    await sendAlert(msg.title, msg.lines);
    sent.push(`${key}:recovered`);
    await closeAgentWake(key);
    delete state[key];
  }
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('alerts.state', ${sql.json(state as never)}, 'alerts')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  // Revisit every open incident: a crash between saving the owner's alert and dispatching cannot lose it.
  // The durable handoff deduplicates by occurrence, independently from hourly owner reminders.
  for (const f of all) if (f.level !== "later" && state[f.key]) await wakeAgent({ ...f, since: new Date(state[f.key]!.since) }, now, !!state[f.key]!.handoff);
  return { open: Object.keys(state), sent };
}

/** A follow-up someone judged not worth fixing: who, when and why. */
export interface DismissedFollowUp { title: string; reason: string; by: string; at: string }

/** The follow-ups closed as not to be fixed, by key. */
async function savedDismissals(): Promise<Record<string, DismissedFollowUp>> {
  const [row] = await sql<{ value: Record<string, DismissedFollowUp> }[]>`SELECT value FROM settings WHERE key = 'alerts.dismissed'`;
  return row?.value ?? {};
}

/** Only observations covered by the closure stay quiet; a new failure reopens the same key. */
export async function dismissedFollowUps(findings?: Finding[]): Promise<Record<string, DismissedFollowUp>> {
  const current = findings ?? await sourceFollowUps(Date.now());
  return Object.fromEntries(Object.entries(await savedDismissals()).filter(([key, closed]) => {
    const finding = current.find(f => f.key === key);
    return finding && (!finding.observedAt || finding.observedAt.getTime() <= Date.parse(closed.at));
  }));
}

/**
 * Closes a current source follow-up as not to be fixed, with the reason (audited): the digest stops listing
 * it. Only these name one source and one problem; a follow-up that counts many records would hide records
 * that arrive later. The closure covers evidence observed by its timestamp only. New failures reopen it even while the old
 * history is still in the seven-day window; disappearance also lapses the closure.
 */
export async function dismissFollowUp(key: string, reason: string, actor: string, now = Date.now()): Promise<DismissedFollowUp> {
  if (!reason?.trim()) throw new Error("reason is required");
  const finding = (await sourceFollowUps(now)).find((f) => f.key === key);
  if (!finding) throw new Error(`not a current source follow-up: ${key}`);
  const before = (await savedDismissals())[key] ?? null;
  const dismissed: DismissedFollowUp = { title: finding.title, reason: reason.trim(), by: actor, at: new Date(now).toISOString() };
  await sql.begin(async (tx) => {
    await tx`INSERT INTO settings (key, value, updated_by) VALUES ('alerts.dismissed', ${tx.json({ [key]: dismissed } as never)}, ${actor})
             ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(actor, "followup.dismiss", `followup:${key}`, dismissed.reason, before, dismissed, { db: tx });
  });
  return dismissed;
}

/** Undoes a closure (audited): the digest lists the follow-up again while it lasts. Null when it is not closed. */
export async function restoreFollowUp(key: string, reason: string, actor: string): Promise<DismissedFollowUp | null> {
  if (!reason?.trim()) throw new Error("reason is required");
  const before = (await savedDismissals())[key];
  if (!before) return null;
  await sql.begin(async (tx) => {
    await tx`UPDATE settings SET value = value - ${key}::text, updated_by = ${actor}, updated_at = now() WHERE key = 'alerts.dismissed'`;
    await audit(actor, "followup.restore", `followup:${key}`, reason.trim(), before, null, { db: tx });
  });
  return before;
}

/** 09:00: one message with the open follow-ups; nothing when there are none. Closures whose problem is gone lapse here. */
export async function sendDigest(now = Date.now()) {
  const found = (await collectFindings(now)).filter((f) => f.level === "later");
  const dismissed = await dismissedFollowUps(found);
  const lapsed = Object.keys(await savedDismissals()).filter((key) => !dismissed[key]);
  if (lapsed.length) await sql`UPDATE settings SET value = value - ${sql.array(lapsed)}::text[], updated_at = now() WHERE key = 'alerts.dismissed'`;
  const items = found.filter((f) => !dismissed[f.key]);
  const lines = items.map((f, i) => `${i + 1}. ${f.title}${f.detail ? `\n   ${f.detail}` : ""}`);
  if (!lines.length) return { items: 0 };
  await sendAlert(`📋 系统日报 · ${beijingDay(now)}`, ["以下事项需要跟进，具体影响见各条说明；可把整条转给 AI 处理。", ...lines]);
  return { items: lines.length };
}
