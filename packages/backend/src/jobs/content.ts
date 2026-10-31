// Body processing is independent of automatic collection and never invokes a model.
import type { PgBoss } from "pg-boss";
import { sql, type Db, type Tx } from "../db.ts";
import { extractArticleBody, pageFetchable } from "../content/extract.ts";
import { publishArticle, publishArticleTx } from "../publication/publish.ts";
import { BudgetExceededError, failureKind } from "../providers/receipts.ts";
import { enqueue, QUEUES, shutdownSignal, work } from "./queue.ts";

const MAX_EXTRACT_FAILURES = 3;

export async function queueProcessing(articleId: string, opts: {refresh?:boolean; db?: Db } = {}): Promise<string | null> {
  if(!opts.db)return sql.begin(tx=>queueProcessing(articleId,{...opts,db:tx}));
  const db = opts.db;
  if(opts.refresh)await db`UPDATE articles SET body_refresh_requested_at=clock_timestamp(),processing_attempts=0,processing_error=NULL,processing_retry_at=NULL WHERE id=${articleId}`;
  await publishArticleTx(db as Tx, articleId);
  const [a] = await db<{ body_status: string; participation_mode: string; kind: string; url: string;body_refresh_requested_at:Date|null;x_post:{tweetId?:string}|null }[]>`
    SELECT a.body_status,a.body_refresh_requested_at,a.x_post, s.participation_mode, s.kind, a.url FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${articleId}`;
  if (!a) return null;
  if (a.body_status === "ok"&&!a.body_refresh_requested_at || a.participation_mode !== "editorial" || !pageFetchable(a.url, a.kind)&&!a.x_post?.tweetId) {
    await db`UPDATE articles SET processing_state = 'skipped', processing_queued_at = NULL, processing_retry_at = NULL WHERE id = ${articleId}`;
    return null;
  }
  const jobId=await enqueue(QUEUES.extractBody, { articleId }, { singletonKey: articleId }, db);
  await db`UPDATE articles SET processing_state = 'new', processing_queued_at = ${jobId?new Date():null} WHERE id = ${articleId}`;
  return jobId;
}

export async function processArticle(articleId: string): Promise<{ state: string; retryAt?: Date }> {
  const [input] = await sql<{ revision: number; body_status: string; participation_mode: string;refreshToken:string|null }[]>`
    SELECT a.revision, a.body_status,extract(epoch FROM a.body_refresh_requested_at)::text AS "refreshToken", s.participation_mode FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${articleId}`;
  if (!input) return { state: "missing" };
  if (input.participation_mode !== "editorial") return { state: "skipped" };
  try {
    const state = input.body_status === "ok"&&!input.refreshToken ? "ok" : await extractArticleBody(articleId,{force:!!input.refreshToken});
    if (state === "unconfirmed") throw new Error("全文暂未取得可靠正文");
    if (state === "skipped") { await queueProcessing(articleId); return { state: "stale" }; }
    await sql`UPDATE articles SET processing_state = 'skipped', processing_attempts = 0, processing_error = NULL,
      processing_retry_at = NULL, processing_queued_at = NULL,body_refresh_requested_at=NULL WHERE id = ${articleId} AND body_status = 'ok'
        AND extract(epoch FROM body_refresh_requested_at)::text IS NOT DISTINCT FROM ${input.refreshToken}`;
    await publishArticle(articleId);
    return { state: "ready" };
  } catch (error) {
    if (shutdownSignal.signal.aborted) throw error;
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    const [a] = await sql<{ processing_attempts: number }[]>`SELECT processing_attempts FROM articles WHERE id = ${articleId} AND revision = ${input.revision}`;
    if (!a) return { state: "stale" };
    const kind = failureKind(error);
    const waiting = kind === "budget" || kind === "busy";
    const attempts = a.processing_attempts + (waiting ? 0 : 1);
    const failed = !waiting && (attempts >= MAX_EXTRACT_FAILURES || kind === "refused");
    const retryAt = failed ? null : new Date(Date.now() + (error instanceof BudgetExceededError ? error.retryAfterSeconds * 1000 : 600_000));
    await sql`UPDATE articles SET processing_state = ${failed ? "failed" : "new"}, processing_attempts = ${attempts},
      processing_error = ${message}, processing_retry_at = ${retryAt}, processing_queued_at = NULL
      WHERE id = ${articleId} AND revision = ${input.revision} AND extract(epoch FROM body_refresh_requested_at)::text IS NOT DISTINCT FROM ${input.refreshToken}`;
    await publishArticle(articleId);
    return retryAt ? { state: "retrying", retryAt } : { state: "failed" };
  }
}

export async function registerContentJobs(boss: PgBoss) { await registerExtractionJobs(boss); }
export async function registerExtractionJobs(boss: PgBoss) {
  await work(boss, QUEUES.extractBody, { localConcurrency: 4, pollingIntervalSeconds: 2 }, ({ articleId }) => processArticle(articleId));
}

export async function sweepUnprocessed(): Promise<{ enqueued: number }> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM articles WHERE processing_state = 'new'
    AND created_at < now() - interval '3 minutes' AND (processing_retry_at IS NULL OR processing_retry_at <= now())
    AND (processing_queued_at IS NULL OR processing_queued_at < now() - interval '30 minutes')
    ORDER BY discovered_at DESC LIMIT 500`;
  let enqueued = 0;
  for (const { id } of rows) if (await queueProcessing(id)) enqueued++;
  return { enqueued };
}

export async function resumeAfterRelease(receipt: { purpose: string; subject: string | null }, db: Db): Promise<boolean> {
  const id = ["body_fallback", "x_article", "collection_detail"].includes(receipt.purpose) ? /^article:([^@:#]+)/.exec(receipt.subject ?? "")?.[1] : undefined;
  if (!id) return false;
  const [a] = await db`UPDATE articles SET processing_state = 'new', processing_attempts = 0, processing_error = NULL,
    processing_retry_at = NULL WHERE id = ${id} AND processing_state = 'failed' RETURNING id`;
  return !!a && !!(await queueProcessing(id, { db }));
}

export const failureGroupSql = (column = "processing_error") =>
  sql.unsafe(`regexp_replace(left(coalesce(${column}, '(no message)'), 120), '[0-9a-f]{8,}|[0-9]{4,}', '…', 'g')`);

export async function requeueFailed(group: string | null): Promise<{ requeued: number }> {
  const rows = await sql<{ id: string }[]>`UPDATE articles SET processing_state = 'new', processing_attempts = 0,
    processing_retry_at = NULL, processing_error = NULL WHERE processing_state = 'failed'
    AND (${group}::text IS NULL OR ${failureGroupSql()} = ${group}) RETURNING id`;
  for (const { id } of rows.slice(0, 500)) await queueProcessing(id);
  return { requeued: rows.length };
}
