// Cron-style schedules (Asia/Shanghai), the engine's and then the site's modules'. Each run is recorded in
// job_runs; missed slots run once.
import type { PgBoss } from "pg-boss";
import { ensureQueue, recordRun } from "@agidawn/backend/jobs/queue";
import { serverModules, type Scheduled } from "@agidawn/backend/modules";
import { sweepUnprocessed } from "@agidawn/backend/jobs/content";
import { adaptIntervals, scheduleDueSources } from "@agidawn/backend/sources/collect";
import { scheduleMpReconcile } from "@agidawn/backend/sources/mp";
import { followXRenames } from "@agidawn/backend/sources/x-renames";
import { dajialaConfigured } from "@agidawn/backend/providers/dajiala";
import { refreshSourceIcons } from "@agidawn/backend/sources/icons";
import { dailyRetention } from "@agidawn/backend/operations/retention";
import { submitIndexNow } from "@agidawn/backend/operations/indexnow";
import { checkAlerts, sendDigest } from "@agidawn/backend/operations/alerts";
import { recoverStaleWork } from "@agidawn/backend/operations/recover";
import { forwardPendingFeedback } from "@agidawn/backend/operations/feedback";
import { backupConfigured, runBackup } from "@agidawn/backend/operations/backup";
import { sourceHealthWeekly } from "@agidawn/backend/operations/reports";

const collecting = process.env.COLLECT_ENABLED === "true";

const ENGINE_SCHEDULES: Scheduled[] = [
  { name: "content.sweep", cron: "*/5 * * * *", run: sweepUnprocessed },
  // The deletions the privacy notice promises, once their retention periods are over.
  { name: "ops.retention", cron: "30 3 * * *", missed: "once", run: () => dailyRetention() },
  // IndexNow for added, changed and removed discovery URLs, hourly so a new story or report reaches Bing,
  // and the AI answers that search it, within the hour (off unless INDEXNOW_SUBMIT_ENABLED).
  { name: "seo.indexnow", cron: "50 * * * *", missed: "once", run: () => submitIndexNow() },
  // Work a stopped process left half way becomes visible, and unknown paid requests get their one
  // automatic release; ops.alerts runs in parallel and sees the result by its next run at the latest.
  { name: "ops.recover", cron: "*/10 * * * *", run: () => recoverStaleWork() },
  { name: "ops.alerts", cron: "*/10 * * * *", run: () => checkAlerts() },
  // One message with other follow-ups and their actual impact (nothing when there are none).
  { name: "ops.digest", cron: "0 9 * * *", missed: "once", run: () => sendDigest() },
  // Feedback that did not reach the internal Feishu chat when it was sent (off with FEISHU_INTERNAL_ENABLED).
  { name: "feedback.forward", cron: "*/10 * * * *", run: () => forwardPendingFeedback() },
  ...(backupConfigured() ? [{ name: "ops.backup", cron: "10 4 * * *", missed: "once" as const, run: () => runBackup() }] : []),
  { name: "reports.source-health", cron: "0 9 * * 1", missed: "once", run: () => sourceHealthWeekly() },
  ...(collecting
    ? [
        { name: "sources.schedule", cron: "* * * * *", run: () => scheduleDueSources() },
        { name: "sources.adapt-intervals", cron: "20 4 * * *", run: adaptIntervals },
        // X accounts quiet for a day: a renamed one is followed to its new handle (SocialData, paid per lookup).
        { name: "sources.x-renames", cron: "50 4 * * *", missed: "once" as const, run: () => followXRenames() },
        // Icons are read from the sources' own sites, so they stop with collection.
        { name: "sources.icons", cron: "40 4 * * *", missed: "once" as const, run: () => refreshSourceIcons() },
      ]
    : []),
  // WeChat official accounts through Dajiala (paid), each once per its interval; only with its key.
  ...(collecting && dajialaConfigured() ? [{ name: "sources.mp-reconcile", cron: "*/15 * * * *", run: () => scheduleMpReconcile() }] : []),
];

export async function registerSchedules(boss: PgBoss) {
  for(const name of ["content.analyze","events.group","events.digest","notify.selected","media.prepare"])if(await boss.getQueue(name))await boss.deleteQueue(name);
  const schedules = [...ENGINE_SCHEDULES, ...serverModules().flatMap((m) => m.schedules ?? [])].filter((s) => s.when?.() ?? true);
  for (const s of schedules) {
    const queue = `cron.${s.name}`;
    await ensureQueue(queue, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
    await boss.schedule(queue, s.cron, {}, { tz: "Asia/Shanghai", missed: s.missed ?? "skip" });
    // Schedules fire at minute boundaries; a 15 s pickup keeps them on time with a third of the polling.
    await boss.work(queue, { pollingIntervalSeconds: 15 }, async () => recordRun(s.name, s.run));
  }
  // Retired or disabled timers must leave no queued work behind, including queues an earlier release
  // already unscheduled. pg-boss deletes the queue's jobs and schedules; job_runs retains its audit.
  const current = new Set(schedules.map((s) => `cron.${s.name}`));
  for (const old of await boss.getQueues()) {
    if (old.name.startsWith("cron.") && !current.has(old.name)) await boss.deleteQueue(old.name);
  }
}
