import type {ReaderListQuery,ReaderListPage} from "@agidawn/contracts/site";
import {READER_PAGE_SIZES} from "@agidawn/contracts/site";
import {sql,type Db} from "../db.ts";
import {findTopic} from "./topics.ts";
import {READER_COLUMNS,READER_FROM,toReaderItem,withReaderMetadata,type ReaderRow} from "./items.ts";
import {shared} from "../lib/cache.ts";
import {searchWords,matchRanges} from '@agidawn/contracts/search';
import type {ReaderMatch,ReaderMetadataTranslation} from '@agidawn/contracts/site';
import {searchSnippet} from './search-text.ts';
import {readerFilters,ReaderQueryError,withSearchCapacity} from './query.ts';
export {ReaderQueryError,SearchBusyError,withSearchCapacity} from './query.ts';
type SearchFields={translated_title:string|null;translated_summary:string|null;translated_body:string|null;search_body:string|null;topic_names:string|null};
type ReaderPageRow={total:number;page:number;page_count:number}&((ReaderRow&SearchFields)|{id:null});
const sharedReaderSearch=shared((input:{key:string;run:(db:Db)=>Promise<ReaderPageRow[]>})=>input.key,input=>withSearchCapacity(input.run));
export {searchWords};
export function searchTerms(q:string){return searchWords(q).slice(0,6).map(t=>t.replace(/[\\%_]/g,m=>"\\"+m));}
export async function loadReaderList(query:ReaderListQuery):Promise<ReaderListPage>{
  const limit=query.limit??READER_PAGE_SIZES[0],page=query.page??1;
  if(!READER_PAGE_SIZES.some(size=>size===limit))throw new ReaderQueryError("limit must be 25, 50 or 100");
  if(!Number.isSafeInteger(page)||page<1)throw new ReaderQueryError("page must be a positive safe integer");
  const {joins,where,originalBody,words,terms}=await readerFilters(query);
  const topic=query.topic?await findTopic(query.topic):null;
  if(query.topic&&!topic)throw new ReaderQueryError("invalid topic");
  // One statement keeps totals and the selected page on the same database snapshot.
  const run=async(db:Db)=>db<ReaderPageRow[]>`WITH matches AS MATERIALIZED (
    SELECT p.article_id,p.sort_at ${READER_FROM} ${joins} WHERE ${where}
    ${topic?sql`AND p.tags && ${topic.tags}::text[]`:sql``}
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
