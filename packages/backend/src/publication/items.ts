import {sql} from "../db.ts";
import type {ReaderBodyState,ReaderItemSummary,BodyIssue} from "@agidawn/contracts/site";
import {publicSourceName,displayTags} from "./rules.ts";
import {serverModules} from '../modules.ts';
import {cleanSummary} from '../content/snippets.ts';
import {cleanArticlePresentation,figurePresentationIssues} from '../content/presentation.ts';
import {estimateReadingMinutes,isTruncatedExcerpt} from '../content/reading.ts';
export interface ReaderRow {
  id:string;title:string;summary:string|null;source_id:string;source_name:string;author:string|null;
  url:string;published_at:Date|null;discovered_at:Date;sort_at:Date;category:string|null;tags:string[];
  body_status:string;body_revision:number|null;site_fulltext:boolean;visibility:string;manual_visibility:string|null;
  processing_state:string;body_quality:string;body_issues:BodyIssue[];
  views:number;likes:number;
  quality_html?:string|null;reading_text?:string|null;translated_body?:string|null;
}
export const READER_COLUMNS=sql`p.article_id AS id,p.title,p.summary,p.source_id,s.name AS source_name,a.author,
 p.url,p.published_at,p.discovered_at,p.sort_at,p.category,p.tags,a.body_status,a.body_revision,
 s.site_fulltext,p.visibility,o.visibility AS manual_visibility,a.processing_state,a.body_quality,a.body_issues,
 (SELECT coalesce(sum(e.views),0) FROM article_engagement e WHERE e.article_id=p.article_id) AS views,
 (SELECT count(*) FROM article_engagement e WHERE e.article_id=p.article_id AND e.liked) AS likes,
 CASE WHEN s.site_fulltext AND p.visibility='public' AND coalesce(o.visibility,'public')='public' THEN a.body_html ELSE NULL END AS quality_html,
 CASE WHEN s.site_fulltext AND p.visibility='public' AND coalesce(o.visibility,'public')='public' THEN a.body_text ELSE NULL END AS reading_text`;
export const READER_FROM=sql`FROM publications p JOIN articles a ON a.id=p.article_id JOIN sources s ON s.id=p.source_id LEFT JOIN editorial_overrides o ON o.article_id=a.id`;
export const readerVisible=sql`p.eligible AND p.visibility<>'withdrawn' AND coalesce(o.visibility,'public')<>'withdrawn' AND s.participation_mode='editorial'`;
export function readerBodyState(row:ReaderRow):ReaderBodyState{
  const permitted=row.site_fulltext&&row.visibility==="public"&&(!row.manual_visibility||row.manual_visibility==="public");
  const inferred=permitted&&row.quality_html?figurePresentationIssues(cleanArticlePresentation(row.quality_html,{url:row.url,issues:row.body_issues})):[];
  const issues=permitted?[...row.body_issues,...inferred].filter((issue,index,all)=>all.findIndex(value=>value.kind===issue.kind&&value.message===issue.message)===index):[];
  return {status:!permitted?"not-permitted":row.body_status==="ok"?row.body_quality==="partial"||issues.length?"partial":"ready":row.processing_state==="failed"||row.body_status==="none"?"unavailable":"pending",
    bodyRevision:permitted?row.body_revision:null,refreshPending:permitted&&row.body_revision!==null&&row.processing_state==="new",issues};
}
export function toReaderItem(row:ReaderRow):ReaderItemSummary{
  return {id:row.id,title:row.title,summary:row.summary,source:{id:row.source_id,name:publicSourceName(row.source_name)},author:row.author,links:{original:row.url},
    publishedAt:row.published_at?.toISOString()??null,discoveredAt:row.discovered_at.toISOString(),timelineAt:row.sort_at.toISOString(),category:row.category,tags:displayTags(row.tags),bodyState:readerBodyState(row),engagement:{views:row.views,likes:row.likes},readingMinutes:row.body_status==='ok'?estimateReadingMinutes(row.translated_body??row.reading_text??''):null,summaryTruncated:isTruncatedExcerpt(row.summary,row.reading_text??null)};
}
export async function withReaderMetadata(items:ReaderItemSummary[],known?:Map<string,import('@agidawn/contracts/site').ReaderMetadataTranslation>){
  if(!items.length)return items;
  const translations=known??await serverModules().find(module=>module.publicationMetadata)?.publicationMetadata?.(items);
  return items.map(item=>{
    const translated=translations?.get(item.id),context={title:item.title,url:item.links.original};
    return {...item,summary:cleanSummary(item.summary,context),metadataTranslation:translated?{
      title:translated.title,summary:cleanSummary(translated.summary,{...context,title:translated.title}),
    }:null};
  });
}
