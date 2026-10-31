import {z} from 'zod';
import {sql} from '@agidawn/backend/db';
import {sha256} from '@agidawn/backend/lib/ids';
import {Conflict} from '@agidawn/backend/audit';
import {withOutline} from '@agidawn/backend/content/outline';
import {readSnapshot} from './archive/snapshots.ts';
import {missing} from './state.ts';
import type {ArchiveSnapshot,ReaderPosition} from './contracts.ts';

// Metadata and asset readiness may change without changing the saved body or its anchors.
const bodyKey=(snapshot:ArchiveSnapshot)=>sha256(JSON.stringify(['sections-v1',snapshot.formatVersion,snapshot.bodyHtml]));
const columns=sql`p.snapshot_id,p.anchor,p.section_offset,p.progress,p.version,p.updated_at,s.body_revision`;
interface PositionRow {snapshot_id:string;body_revision:number;anchor:string|null;section_offset:number;progress:number;version:number;updated_at:Date}
const position=(row:PositionRow):ReaderPosition=>({snapshotId:row.snapshot_id,bodyRevision:row.body_revision,anchor:row.anchor,offset:row.section_offset,progress:row.progress,version:row.version,updatedAt:row.updated_at.toISOString()});
export async function readPosition(snapshotId:string){
  const snapshot=await readSnapshot(snapshotId);if(!snapshot)throw missing();const hash=bodyKey(snapshot);
  const [saved]=await sql<PositionRow[]>`SELECT ${columns} FROM reader_positions p JOIN reader_snapshots s ON s.id=p.snapshot_id WHERE p.article_id=${snapshot.articleId} AND p.body_hash=${hash}`;
  const [previous]=saved?[]:await sql<PositionRow[]>`SELECT ${columns} FROM reader_positions p JOIN reader_snapshots s ON s.id=p.snapshot_id WHERE p.article_id=${snapshot.articleId} AND p.body_hash<>${hash} ORDER BY p.updated_at DESC,p.snapshot_id DESC LIMIT 1`;
  return {position:saved?position(saved):null,previous:previous?position(previous):null};
}
const input=z.object({expectedVersion:z.number().int().nonnegative(),anchor:z.string().regex(/^sec-[1-9]\d*$/).max(30).nullable(),offset:z.number().min(0).max(1),progress:z.number().min(0).max(1)}).strict();
export async function savePosition(snapshotId:string,value:unknown):Promise<ReaderPosition>{
  const patch=input.parse(value);
  return sql.begin(async db=>{
    const snapshot=await readSnapshot(snapshotId,db);if(!snapshot)throw missing();
    if(patch.anchor&&!withOutline(snapshot.bodyHtml).outline.some(entry=>entry.id===patch.anchor))throw Object.assign(new Error('章节不属于该正文版本'),{statusCode:400});
    const hash=bodyKey(snapshot);
    const [row]=patch.expectedVersion===0
      ?await db<Omit<PositionRow,'body_revision'>[]>`INSERT INTO reader_positions(article_id,body_hash,snapshot_id,anchor,section_offset,progress) VALUES(${snapshot.articleId},${hash},${snapshotId},${patch.anchor},${patch.offset},${patch.progress}) ON CONFLICT DO NOTHING RETURNING *`
      :await db<Omit<PositionRow,'body_revision'>[]>`UPDATE reader_positions SET snapshot_id=${snapshotId},anchor=${patch.anchor},section_offset=${patch.offset},progress=${patch.progress},version=version+1,updated_at=now() WHERE article_id=${snapshot.articleId} AND body_hash=${hash} AND version=${patch.expectedVersion} RETURNING *`;
    if(!row)throw new Conflict('阅读位置已由其他窗口更新，请载入已保存位置后继续');
    return position({...row,body_revision:snapshot.bodyRevision});
  });
}
