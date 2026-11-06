import type {ReaderListQuery,ReaderListPage} from "@agidawn/contracts/site";
import {READER_PAGE_SIZES} from "@agidawn/contracts/site";
import {sql,withCustomPlans,type Db} from "../db.ts";
import {categoryExists} from "./categories.ts";
import {findTopic} from "./topics.ts";
import {READER_COLUMNS,READER_FROM,readerVisible,toReaderItem,withReaderMetadata,type ReaderRow} from "./items.ts";
import {shared} from "../lib/cache.ts";
import {beijingMidnight} from "@agidawn/contracts/time";
import {searchWords,searchPattern,matchRanges} from '@agidawn/contracts/search';
import type {ReaderMatch,ReaderMetadataTranslation} from '@agidawn/contracts/site';
import {serverModules} from '../modules.ts';
import {htmlSearchText,searchSnippet,sourceSearchText,summarySearchText} from './search-text.ts';
export class ReaderQueryError extends Error {readonly statusCode=400;}
export class SearchBusyError extends Error {readonly retryAfter:number;constructor(retryAfter:number){super("search capacity exhausted");this.retryAfter=retryAfter;}}
let running=0;const waiters:Array<()=>void>=[];
type SearchFields={translated_title:string|null;translated_summary:string|null;translated_body:string|null;search_body:string|null;topic_names:string|null};
type ReaderPageRow={total:number;page:number;page_count:number}&((ReaderRow&SearchFields)|{id:null});
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
export {searchWords};
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
  const words=searchWords(query.q?.trim()??'').slice(0,6),terms=words.map(searchPattern);
  const allowed=sql`s.site_fulltext AND p.visibility='public' AND coalesce(o.visibility,'public')='public'`;
  const extension=serverModules().find(module=>module.publicationSearch)?.publicationSearch?.({articleId:sql`p.article_id`,title:sql`p.title`,summary:sql`p.summary`,bodyRevision:sql`a.body_revision`,bodyHtml:sql`a.body_html`,bodyAllowed:allowed})??sql`SELECT NULL::text AS title,NULL::text AS summary,NULL::text AS body`;
  const joins=sql`LEFT JOIN LATERAL (${extension}) AS translated ON true
    LEFT JOIN LATERAL (SELECT string_agg(t.name,' ') AS names FROM article_topics t WHERE p.tags && t.tags) AS topic ON true
    LEFT JOIN LATERAL (SELECT ${summarySearchText(sql`p.summary`,sql`p.title`,sql`p.url`)} AS summary,
      ${summarySearchText(sql`translated.summary`,sql`translated.title`,sql`p.url`)} AS translated_summary,
      ${sourceSearchText(sql`s.name`)} AS source_name) AS searchable ON true
    LEFT JOIN pool_search ps ON ps.article_id=p.article_id`;
  const originalBody=sql`CASE WHEN ${allowed} THEN CASE WHEN a.body_html IS NOT NULL THEN ${htmlSearchText(sql`a.body_html`)} ELSE ps.body END ELSE NULL END`;
  const match=terms.reduce((acc,term)=>sql`${acc} AND (p.title ~* ${term} OR searchable.summary ~* ${term} OR searchable.source_name ~* ${term} OR topic.names ~* ${term}
    OR translated.title ~* ${term} OR searchable.translated_summary ~* ${term} OR (${allowed} AND (${originalBody} ~* ${term} OR translated.body ~* ${term})))`,sql`TRUE`);
  // One statement keeps totals and the selected page on the same database snapshot.
  const run=async(db:Db)=>db<ReaderPageRow[]>`WITH matches AS MATERIALIZED (
    SELECT p.article_id,p.sort_at ${READER_FROM} ${joins} WHERE ${readerVisible} AND ${match}
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
    SELECT ${READER_COLUMNS},translated.title AS translated_title,translated.summary AS translated_summary,
      translated.body AS translated_body,${originalBody} AS search_body,topic.names AS topic_names
      ${READER_FROM} JOIN selected ON selected.article_id=p.article_id ${joins}
  ) SELECT pagination.*,content.* FROM pagination LEFT JOIN content ON true ORDER BY content.sort_at DESC,content.id DESC`;
  const key=JSON.stringify([query.sourceId??null,query.category??null,query.topic??null,query.from??null,query.to??null,query.q?.trim()??"",page,limit]);
  const rows=terms.length?await sharedReaderSearch({key,run}):await run(sql),summary=rows[0]!;
  type TextRow=ReaderRow&SearchFields;
  const content=rows.filter(row=>row.id!==null) as TextRow[],translations=new Map<string,ReaderMetadataTranslation>();
  for(const row of content)if(row.translated_title)translations.set(row.id,{title:row.translated_title,summary:row.translated_summary});
  const items=await withReaderMetadata(content.map(toReaderItem),translations);
  for(const [index,item] of items.entries())if(words.length){
    const row=content[index]!,fields:Array<[ReaderMatch['field'],ReaderMatch['language'],string|null]>=[
      ['title','translation',item.metadataTranslation?.title??null],['summary','translation',item.metadataTranslation?.summary??null],
      ['title','original',item.title],['summary','original',item.summary],['source','original',item.source.name],['topic','original',row.topic_names],
      ['body','translation',row.translated_body],['body','original',row.search_body]];
    item.matches=fields.filter(([, ,text])=>text&&matchRanges(text,words).length).map(([field,language,text])=>({field,language,snippet:searchSnippet(text!,words)}));
  }
  return {items,total:summary.total,page:summary.page,limit,pageCount:summary.page_count};
}
