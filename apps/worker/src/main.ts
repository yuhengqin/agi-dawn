// Worker process: queues and schedules for collection, processing, events, reports and ops, and the site's
// modules (site/modules/server.ts).
import { assertProductionSecrets } from "@agidawn/backend/config";
import { closeDb } from "@agidawn/backend/db";
import { getBoss, stopBoss, workModuleQueues } from "@agidawn/backend/jobs/queue";
import { installModules } from "@agidawn/backend/modules";
import { SERVER_MODULES } from "@agidawn/site/modules/server";
import { registerContentJobs } from "@agidawn/backend/jobs/content";
import { registerSourceJobs } from "@agidawn/backend/jobs/sources";
import { registerPublicationJobs } from "@agidawn/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { startHeartbeat } from "@agidawn/backend/operations/heartbeat";

installModules(SERVER_MODULES);
assertProductionSecrets([]);

const boss = await getBoss();
await registerContentJobs(boss);
if (process.env.COLLECT_ENABLED === "true") await registerSourceJobs(boss);
await registerPublicationJobs(boss);
await workModuleQueues(boss);
await registerSchedules(boss);
const heartbeat = startHeartbeat("worker");
console.log(JSON.stringify({ level: "info", msg: "worker started", pid: process.pid }));

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const started = performance.now();
  console.log(JSON.stringify({ level: "info", msg: "worker stopping" }));
  clearInterval(heartbeat);
  await stopBoss();
  const closing = performance.now();
  await closeDb();
  console.log(JSON.stringify({ level: "info", msg: "worker stopped", elapsedMs: Math.round(performance.now() - started),
    databaseCloseMs: Math.round(performance.now() - closing) }));
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
