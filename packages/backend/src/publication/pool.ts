import type {ReaderListQuery,ReaderListPage} from "@agidawn/contracts/site";
import {READER_PAGE_SIZES} from "@agidawn/contracts/site";
import {sql,withCustomPlans,type Db} from "../db.ts";
import {categoryExists} from "./categories.ts";
import {findTopic} from "./topics.ts";
import {READER_COLUMNS,READER_FROM,readerVisible,toReaderItem,withReaderMetadata,type ReaderRow} from "./items.ts";
import {shared} from "../lib/cache.ts";
import {beijingMidnight} from "@agidawn/contracts/time";
export class ReaderQueryError extends Error {readonly statusCode=400;}
export class SearchBusyError extends Error {readonly retryAfter:number;constructor(retryAfter:number){super("search capacity exhausted");this.retryAfter=retryAfter;}}
let running=0;const waiters:Array<()=>void>=[];
type ReaderPageRow={total:number;page:number;page_count:number}&(ReaderRow|{id:null});
const sharedReaderSearch=shared((input:{key:string;run:(db:Db)=>Promise<ReaderPageRow[]>})=>input.key,input=>withSearchCapacity(input.run));
export async function withSearchCapacity<T>(fn:(db:Db)=>Promise<T>):Promise<T>{
  if(running>=4){
    if(waiters.length>=8)throw new SearchBusyError(5);
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{const i=waiters.indexOf(go);if(i>=0)waiters.splice(i,1);reject(new SearchBusyError(5));},3000);
      const go=()=>{clearTimeout(timer);resolve();};waiters.push(go);
    });
  }
  running++;try{return await withCustomPlans(fn);}finally{running--;waiters.shift()?.();}
}
export function searchWords(q:string){
  return q.toLowerCase().replace(/(\p{Script=Han})(?=[a-z])/gu,"$1 ").replace(/([a-z][a-z0-9]*)(?=\p{Script=Han})/gu,"$1 ")
    .split(/\s+/).map(t=>t.trim()).filter(Boolean);
}
export function searchTerms(q:string){return searchWords(q).slice(0,6).map(t=>t.replace(/[\\%_]/g,m=>"\\"+m));}
function readerDay(value:string|undefined){
  if(value===undefined)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new ReaderQueryError("invalid calendar date");
  const day=new Date(value+"T00:00:00Z");
  if(!Number.isFinite(+day)||day.toISOString().slice(0,10)!==value)throw new ReaderQueryError("invalid calendar date");
  return beijingMidnight(value);
}
export async function loadReaderList(query:ReaderListQuery):Promise<ReaderListPage>{
  const limit=query.limit??READER_PAGE_SIZES[0],page=query.page??1;
  if(!READER_PAGE_SIZES.some(size=>size===limit))throw new ReaderQueryError("limit must be 25, 50 or 100");
  if(!Number.isSafeInteger(page)||page<1)throw new ReaderQueryError("page must be a positive safe integer");
  for(const [key,value] of Object.entries(query))if(typeof value==="string"&&(value.includes("\0")||value.length>(key==="q"?200:100)))throw new ReaderQueryError("invalid article filter");
  if(query.category&&!await categoryExists(query.category))throw new ReaderQueryError("invalid category");
  const topic=query.topic?await findTopic(query.topic):null;
  if(query.topic&&!topic)throw new ReaderQueryError("invalid topic");
  const from=readerDay(query.from),to=readerDay(query.to);if(from&&to&&from>to)throw new ReaderQueryError("from must not follow to");
  const terms=searchTerms(query.q?.trim()??"");
  const match=terms.reduce((acc,term)=>sql`${acc} AND (p.search_text LIKE ${"%"+term+"%"} OR
    (s.site_fulltext AND p.visibility='public' AND coalesce(o.visibility,'public')='public' AND EXISTS
      (SELECT 1 FROM pool_search ps WHERE ps.article_id=p.article_id AND ps.body LIKE ${"%"+term+"%"})))`,sql`TRUE`);
  // One statement keeps totals and the selected page on the same database snapshot.
  const run=async(db:Db)=>db<ReaderPageRow[]>`WITH matches AS MATERIALIZED (
    SELECT p.article_id,p.sort_at ${READER_FROM} WHERE ${readerVisible} AND ${match}
    ${query.sourceId?sql`AND p.source_id=${query.sourceId}`:sql``}
    ${query.category==="uncategorized"?sql`AND p.category IS NULL`:query.category?sql`AND p.category=${query.category}`:sql``}
    ${topic?sql`AND p.tags && ${topic.tags}::text[]`:sql``}
    ${from?sql`AND p.sort_at>=${from}`:sql``}
    ${to?sql`AND p.sort_at<${new Date(+to+86400_000)}`:sql``}
  ), totals AS (SELECT count(*) AS total FROM matches), pagination AS (
    SELECT total,ceil(total::numeric/${limit})::bigint AS page_count,
      greatest(1,least(${page}::bigint,ceil(total::numeric/${limit})))::bigint AS page FROM totals
  ), selected AS (
    SELECT article_id FROM matches ORDER BY sort_at DESC,article_id DESC
    LIMIT ${limit} OFFSET (SELECT (page-1)*${limit}::bigint FROM pagination)
  ), content AS (
    SELECT ${READER_COLUMNS} ${READER_FROM} JOIN selected ON selected.article_id=p.article_id
  ) SELECT pagination.*,content.* FROM pagination LEFT JOIN content ON true ORDER BY content.sort_at DESC,content.id DESC`;
  const key=JSON.stringify([query.sourceId??null,query.category??null,query.topic??null,query.from??null,query.to??null,query.q?.trim()??"",page,limit]);
  const rows=terms.length?await sharedReaderSearch({key,run}):await run(sql),summary=rows[0]!;
  return {items:await withReaderMetadata(rows.flatMap(row=>row.id===null?[]:[toReaderItem(row)])),total:summary.total,page:summary.page,limit,pageCount:summary.page_count};
}
