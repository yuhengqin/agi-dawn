import {randomUUID} from "node:crypto";
import * as cheerio from "cheerio";
import {sql,type Db} from "@agidawn/backend/db";
import {defineQueue,materialRepresentationHash,type MaterialCapture} from "@agidawn/backend/modules";
import {enqueueOn} from "@agidawn/backend/jobs/queue";
import {sha256} from "@agidawn/backend/lib/ids";
import type {ArchiveSnapshot} from "../contracts.ts";
import {storedMaterial} from '@agidawn/backend/content/materials';

export const archiveQueue=defineQueue<{snapshotId:string}>({name:"reader.archive",options:{policy:"short",retryLimit:2,retryDelay:60,expireInSeconds:600},
  worker:{localConcurrency:4,pollingIntervalSeconds:2},async run(data){
    const {archiveSnapshot}=await import("./assets.ts");
    for(const item of data) await archiveSnapshot(item.snapshotId);
  }});

export async function captureSnapshot(capture:MaterialCapture,tx:Db):Promise<void> {
  const representationHash=materialRepresentationHash(capture);
  const [row]=await tx`INSERT INTO reader_snapshots (id,article_id,body_revision,representation_hash,data)
    VALUES (${randomUUID()},${capture.articleId},${capture.bodyRevision},${representationHash},${tx.json(capture as never)})
    ON CONFLICT (article_id,body_revision,representation_hash) DO NOTHING RETURNING id`;
  if(!row) return;
  const $=cheerio.load(capture.bodyHtml,null,false);
  const urls=[...new Set($("img[src]").toArray().map(el=>$(el).attr("src")!))];
  for(const url of urls) await tx`INSERT INTO reader_snapshot_assets (snapshot_id,asset_key,original_url)
    VALUES (${row.id},${sha256(url).slice(0,32)},${url})`;
  await enqueueOn(archiveQueue,{snapshotId:row.id},{singletonKey:row.id},tx);
}

export async function readSnapshot(id:string,db:Db=sql):Promise<ArchiveSnapshot|null> {
  const [r]=await db`SELECT * FROM reader_snapshots WHERE id=${id}`;
  if(!r) return null;
  return {id:r.id,...r.data,representationHash:r.representation_hash,status:r.status,formatVersion:r.format_version,
    createdAt:r.created_at.toISOString(),completedAt:r.completed_at?.toISOString()??null};
}
export async function listSnapshots(articleId:string) {
  const rows=await sql`SELECT id FROM reader_snapshots WHERE article_id=${articleId} ORDER BY created_at DESC,id DESC`;
  return Promise.all(rows.map(r=>readSnapshot(r.id)));
}
export async function currentSnapshot(articleId:string,db:Db=sql):Promise<ArchiveSnapshot|null>{
  const capture=await storedMaterial(db,articleId);if(!capture)return null;
  const [row]=await db`SELECT id FROM reader_snapshots WHERE article_id=${articleId} AND body_revision=${capture.bodyRevision} AND representation_hash=${materialRepresentationHash(capture)}`;
  return row?readSnapshot(row.id,db):null;
}
