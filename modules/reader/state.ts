import { z } from "zod";
import { sql,type Db } from "@agidawn/backend/db";
import { audit, Conflict } from "@agidawn/backend/audit";
import type { ReaderState,ReaderStatePatch,BulkReaderStateResult,ReaderLibrary,ReaderViewQuery,LibraryFilters } from "./contracts.ts";
import {listCategories} from "@agidawn/backend/publication/categories";
import {listTopics} from "@agidawn/backend/publication/topics";
import {encodeCursor,decodeCursor,queryBinding} from "@agidawn/backend/lib/cursor";
import {searchWords,withSearchCapacity} from "@agidawn/backend/publication/pool";
import {searchLibraryBatch,type LibraryRow} from "./search.ts";
import type {LibraryMatch} from "./contracts.ts";
import {collapseWhitespace,truncate} from "@agidawn/backend/lib/text";
import {isValidDate,beijingMidnight} from "@agidawn/contracts/time";

export const missing = () => Object.assign(new Error("article not found"), { statusCode: 404 });
export async function requireArticle(id: string) {
  if (!(await sql`SELECT 1 FROM articles WHERE id = ${id}`).length) throw missing();
}

export async function readState(articleId: string, db:Db=sql): Promise<ReaderState> {
  const [row] = await db`SELECT * FROM reader_state WHERE article_id = ${articleId}`;
  return { articleId, starred: row?.starred ?? false, status: row?.status ?? "to-read", updatedAt: row?.updated_at?.toISOString() ?? null, version: row?.version ?? 0 };
}

const patchSchema = z.object({ expectedVersion: z.number().int().nonnegative(), starred: z.boolean().optional(),
  status: z.enum(["to-read", "reading", "read"]).optional() }).strict().refine(v => v.starred !== undefined || v.status !== undefined);

async function lockStateArticles(db:Db,ids:string[]) {
  // A state row may not exist yet; single and bulk writes lock its article instead.
  const rows=await db`SELECT id FROM articles WHERE id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  if(rows.length!==ids.length)throw missing();
}

async function patchStateTx(tx:Db,articleId:string,patch:ReaderStatePatch,actor:string):Promise<ReaderState> {
    const rows = patch.expectedVersion === 0
      ? await tx`INSERT INTO reader_state (article_id,starred,status) VALUES (${articleId},${patch.starred ?? false},${patch.status ?? "to-read"})
        ON CONFLICT DO NOTHING RETURNING *`
      : await tx`UPDATE reader_state SET starred=coalesce(${patch.starred ?? null},starred),status=coalesce(${patch.status ?? null},status),
        version=version+1,updated_at=now() WHERE article_id=${articleId} AND version=${patch.expectedVersion} RETURNING *`;
    const row = rows[0];
    if (!row) throw new Conflict("阅读状态已改变，请重新载入");
    await audit(actor, "reader.state", `article:${articleId}`, null, { version: patch.expectedVersion }, { version: row.version }, { db: tx });
    return { articleId, starred: row.starred, status: row.status, version: row.version, updatedAt: row.updated_at.toISOString() };
}

export async function patchState(articleId: string, input: unknown, actor: string): Promise<ReaderState> {
  const patch=patchSchema.parse(input);
  return sql.begin(async tx=>{
    await lockStateArticles(tx,[articleId]);
    return patchStateTx(tx,articleId,patch,actor);
  });
}

const bulkStateSchema=z.object({
  articles:z.array(z.object({id:z.string().regex(/^[\w-]{1,80}$/),expectedVersion:z.number().int().nonnegative()}).strict()).min(1).max(100),
  starred:z.boolean().optional(),status:z.enum(["to-read","reading","read"]).optional(),
}).strict().refine(value=>value.starred!==undefined||value.status!==undefined,"请选择收藏或阅读状态操作");

export async function saveBulkState(input:unknown,actor:string):Promise<BulkReaderStateResult> {
  const value=bulkStateSchema.parse(input),ids=value.articles.map(article=>article.id).sort();
  if(new Set(ids).size!==ids.length)throw Object.assign(new Error("所选文章重复，请重新选择"),{statusCode:400});
  return sql.begin(async tx=>{
    await lockStateArticles(tx,ids);
    let changed=0;
    for(const id of ids){
      const current=await readState(id,tx),expected=value.articles.find(article=>article.id===id)!.expectedVersion;
      if(current.version!==expected)throw new Conflict("所选文章的收藏或阅读状态已改变，整批未保存，请重新载入列表后再整理");
      if((value.starred===undefined||value.starred===current.starred)&&(value.status===undefined||value.status===current.status))continue;
      await patchStateTx(tx,id,{expectedVersion:expected,starred:value.starred,status:value.status},actor);changed++;
    }
    return {selected:ids.length,changed};
  });
}

const filterId=z.string().min(1).max(100).refine(value=>!value.includes("\0"));
const calendarDate=z.string().refine(value=>value>="0001-01-01"&&isValidDate(value),"日期必须是有效的 YYYY-MM-DD");
export const libraryFiltersSchema = z.object({sourceId:filterId.optional(),category:filterId.optional(),topic:filterId.optional(),
  q:z.string().max(200).refine(value=>!value.includes("\0")).trim().refine(value=>searchWords(value).length<=6,"最多输入6个关键词").optional(),
  starred: z.enum(["true","false"]).optional(), status: z.enum(["to-read","reading","read"]).optional(),
  hasNote:z.enum(["true","false"]).optional(),sort:z.enum(["collected","note-updated"]).optional(),
  dateField:z.enum(["collected","note-updated"]).optional(),dateFrom:calendarDate.optional(),dateTo:calendarDate.optional() }).strict();
const librarySchema=libraryFiltersSchema.extend({cursor:z.string().max(1000).optional(),limit:z.coerce.number().int().min(1).max(100).default(40)});

export function checkLibraryFilters(q:ReaderViewQuery,filters:LibraryFilters){
  const invalid=(message:string)=>Object.assign(new Error(message),{statusCode:400});
  if(q.dateFrom&&q.dateTo&&q.dateFrom>q.dateTo)throw invalid("开始日期不能晚于结束日期");
  if(q.sourceId&&!filters.sources.some(s=>s.id===q.sourceId))throw invalid("来源不存在");
  if(q.category&&!filters.categories.some(c=>c.id===q.category))throw invalid("分类不存在");
  if(q.topic&&!filters.topics.some(t=>t.slug===q.topic))throw invalid("主题不存在");
}

export async function readLibrary(input: unknown):Promise<ReaderLibrary> {
  const q = librarySchema.parse(input);
  const [sources,categories,topics]=await Promise.all([sql<{id:string;name:string}[]>`SELECT id,name FROM sources ORDER BY name,id`,listCategories(),listTopics()]);
  const invalid=(message:string)=>Object.assign(new Error(message),{statusCode:400});
  checkLibraryFilters(q,{sources,categories,topics});
  const topic=q.topic?topics.find(t=>t.slug===q.topic):null;
  const words=searchWords(q.q??"");
  const noteSort=q.sort==="note-updated";
  const binding=queryBinding({sourceId:q.sourceId??null,category:q.category??null,topic:q.topic??null,starred:q.starred??null,status:q.status??null,hasNote:q.hasNote??null,sort:q.sort??"collected",dateField:q.dateFrom||q.dateTo?q.dateField??"collected":null,dateFrom:q.dateFrom??null,dateTo:q.dateTo??null,words,limit:q.limit});
  // Preserve PostgreSQL microseconds in keysets; JS Date truncates them to milliseconds.
  const preciseTime=(value:unknown):value is string=>typeof value==="string"&&/^(?!0000)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)&&Number.isFinite(+new Date(value))&&new Date(value).toISOString()===value.slice(0,23)+"Z";
  let after: { at: string; noteAt:string|null; id: string } | null = null;
  if (q.cursor) {
    try {
      const value=decodeCursor("reader-library",q.cursor);
      if(value.binding!==binding||!preciseTime(value.at)||(value.noteAt!==null&&!preciseTime(value.noteAt))||typeof value.id!=="string"||!/^[\w-]{1,80}$/.test(value.id))throw new Error();
      after={at:value.at,noteAt:value.noteAt as string|null,id:value.id};
    } catch { throw invalid("invalid library cursor or changed filters"); }
  }
  // Match ECMAScript trim, including full-width spaces and whitespace-only saved drafts.
  const whitespace="\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const hasNote=sql`btrim(coalesce(n.text,''),${whitespace})<>''`,noteTime=sql`CASE WHEN ${hasNote} THEN n.updated_at END`;
  const dateTime=q.dateField==="note-updated"?noteTime:sql`a.discovered_at`;
  const candidates=(db:Db,batchAfter:typeof after,limit:number)=>db<LibraryRow[]>`SELECT a.id,coalesce(p.title,a.title) AS title,s.name AS source,a.discovered_at,p.visibility,coalesce(o.version,0) AS classification_version,r.starred,r.status,r.version,r.updated_at,n.text AS note,${noteTime} AS note_updated_at,
    to_char(a.discovered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,to_char(${noteTime} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS note_at
    ${words.length?sql`,CASE WHEN p.article_id IS NOT NULL THEN p.summary WHEN jsonb_typeof(o.fields->'summary')='string' THEN nullif(trim(o.fields->>'summary'),'') ELSE a.excerpt END AS summary`:sql``}
    FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN reader_state r ON r.article_id=a.id
    LEFT JOIN editorial_overrides o ON o.article_id=a.id LEFT JOIN reader_notes n ON n.article_id=a.id
    WHERE (${q.starred ?? null}::text IS NULL OR coalesce(r.starred,false)=${q.starred === "true"})
      AND (${q.status ?? null}::text IS NULL OR coalesce(r.status,'to-read')=${q.status ?? null})
      ${q.hasNote?sql`AND (${hasNote})=${q.hasNote==="true"}`:sql``}
      ${q.dateFrom?sql`AND ${dateTime}>=${beijingMidnight(q.dateFrom)}`:sql``}
      ${q.dateTo?sql`AND ${dateTime}<(${beijingMidnight(q.dateTo)}::timestamptz+interval '24 hours')`:sql``}
      ${q.sourceId?sql`AND a.source_id=${q.sourceId}`:sql``}
      ${q.category==="uncategorized"?sql`AND p.category IS NULL`:q.category?sql`AND p.category=${q.category}`:sql``}
      ${topic?sql`AND p.tags && ${topic.tags}::text[]`:sql``}
      ${batchAfter ? noteSort ? batchAfter.noteAt!==null ? sql`AND (${noteTime}<${batchAfter.noteAt}::text::timestamptz OR ${noteTime} IS NULL OR (${noteTime}=${batchAfter.noteAt}::text::timestamptz AND (a.discovered_at,a.id)<(${batchAfter.at}::text::timestamptz,${batchAfter.id})))`
        :sql`AND ${noteTime} IS NULL AND (a.discovered_at,a.id)<(${batchAfter.at}::text::timestamptz,${batchAfter.id})`
        :sql`AND (a.discovered_at,a.id)<(${batchAfter.at}::text::timestamptz,${batchAfter.id})` : sql``}
    ORDER BY ${noteSort?sql`${noteTime} DESC NULLS LAST,`:sql``}a.discovered_at DESC,a.id DESC LIMIT ${limit}`;
  const position=(row:LibraryRow)=>({at:row.cursor_at,noteAt:row.note_at,id:row.id});
  const matches=new Map<string,LibraryMatch[]>();
  const rows=words.length?await withSearchCapacity(async db=>{
    await db`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const found:LibraryRow[]=[];let batchAfter=after;
    while(found.length<=q.limit){
      const batch=await candidates(db,batchAfter,100);if(!batch.length)break;
      const hits=await searchLibraryBatch(db,batch,words);
      for(const row of batch)if(hits.has(row.id)){found.push(row);matches.set(row.id,hits.get(row.id)!);if(found.length>q.limit)return found;}
      if(batch.length<100)break;batchAfter=position(batch.at(-1)!);
    }
    return found;
  }):await candidates(sql,after,q.limit+1);
  const items = rows.slice(0,q.limit).map(r => ({ id:r.id,title:r.title,source:r.source,withdrawn:r.visibility==="withdrawn",classificationVersion:r.classification_version,
    state:{articleId:r.id,starred:r.starred??false,status:r.status??"to-read",version:r.version??0,updatedAt:r.updated_at?.toISOString()??null},note:r.note_updated_at?{snippet:truncate(collapseWhitespace(r.note??""),160),updatedAt:r.note_updated_at.toISOString()}:null,matches:matches.get(r.id)??[] }));
  const last = rows[q.limit-1];
  return {items,nextCursor:rows.length>q.limit&&last?encodeCursor("reader-library",{binding,...position(last)}):null,
    filters:{sources,categories,topics:topics.map(({slug,name,definition})=>({slug,name,definition}))}};
}
