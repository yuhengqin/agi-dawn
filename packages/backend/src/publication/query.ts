import type {ReaderTopicQuery} from '@agidawn/contracts/site';
import {beijingMidnight} from '@agidawn/contracts/time';
import {searchWords,searchPattern} from '@agidawn/contracts/search';
import {sql,withCustomPlans,type Db} from '../db.ts';
import {serverModules} from '../modules.ts';
import {categoryExists} from './categories.ts';
import {readerVisible} from './items.ts';
import {htmlSearchText,sourceSearchText,summarySearchText} from './search-text.ts';

export class ReaderQueryError extends Error {readonly statusCode=400;}
export class SearchBusyError extends Error {readonly retryAfter:number;constructor(retryAfter:number){super('search capacity exhausted');this.retryAfter=retryAfter;}}
let running=0;const waiters:Array<()=>void>=[];
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

function readerDay(value:string|undefined){
  if(value===undefined)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new ReaderQueryError('invalid calendar date');
  const day=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(+day)||day.toISOString().slice(0,10)!==value)throw new ReaderQueryError('invalid calendar date');
  return beijingMidnight(value);
}

/** The list and topic alternatives must match the same public text and permissions. */
export async function readerFilters(query:ReaderTopicQuery){
  for(const [key,value] of Object.entries(query))if(typeof value==='string'&&(value.includes('\0')||value.length>(key==='q'?200:100)))throw new ReaderQueryError('invalid article filter');
  if(query.category&&!await categoryExists(query.category))throw new ReaderQueryError('invalid category');
  const from=readerDay(query.from),to=readerDay(query.to);if(from&&to&&from>to)throw new ReaderQueryError('from must not follow to');
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
  const where=sql`${readerVisible} AND ${match}
    ${query.sourceId?sql`AND p.source_id=${query.sourceId}`:sql``}
    ${query.category==='uncategorized'?sql`AND p.category IS NULL`:query.category?sql`AND p.category=${query.category}`:sql``}
    ${from?sql`AND p.sort_at>=${from}`:sql``}
    ${to?sql`AND p.sort_at<${new Date(+to+86400_000)}`:sql``}`;
  return {joins,where,originalBody,words,terms};
}
