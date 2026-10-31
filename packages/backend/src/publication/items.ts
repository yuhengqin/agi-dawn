import {sql} from "../db.ts";
import type {ReaderBodyState,ReaderItemSummary,BodyIssue} from "@agidawn/contracts/site";
import {publicSourceName,displayTags} from "./rules.ts";
import {serverModules} from '../modules.ts';
export interface ReaderRow {
  id:string;title:string;summary:string|null;source_id:string;source_name:string;author:string|null;
  url:string;published_at:Date|null;discovered_at:Date;sort_at:Date;category:string|null;tags:string[];
  body_status:string;body_revision:number|null;site_fulltext:boolean;visibility:string;manual_visibility:string|null;
  processing_state:string;body_quality:string;body_issues:BodyIssue[];
  views:number;likes:number;
}
export const READER_COLUMNS=sql`p.article_id AS id,p.title,p.summary,p.source_id,s.name AS source_name,a.author,
 p.url,p.published_at,p.discovered_at,p.sort_at,p.category,p.tags,a.body_status,a.body_revision,
 s.site_fulltext,p.visibility,o.visibility AS manual_visibility,a.processing_state,a.body_quality,a.body_issues,
 (SELECT coalesce(sum(e.views),0) FROM article_engagement e WHERE e.article_id=p.article_id) AS views,
 (SELECT count(*) FROM article_engagement e WHERE e.article_id=p.article_id AND e.liked) AS likes`;
export const READER_FROM=sql`FROM publications p JOIN articles a ON a.id=p.article_id JOIN sources s ON s.id=p.source_id LEFT JOIN editorial_overrides o ON o.article_id=a.id`;
export const readerVisible=sql`p.eligible AND p.visibility<>'withdrawn' AND coalesce(o.visibility,'public')<>'withdrawn' AND s.participation_mode='editorial'`;
export function readerBodyState(row:ReaderRow):ReaderBodyState{
  const permitted=row.site_fulltext&&row.visibility==="public"&&(!row.manual_visibility||row.manual_visibility==="public");
  return {status:!permitted?"not-permitted":row.body_status==="ok"?row.body_quality==="partial"?"partial":"ready":row.processing_state==="failed"||row.body_status==="none"?"unavailable":"pending",
    bodyRevision:permitted?row.body_revision:null,refreshPending:permitted&&row.body_revision!==null&&row.processing_state==="new",issues:permitted?row.body_issues:[]};
}
export function toReaderItem(row:ReaderRow):ReaderItemSummary{
  return {id:row.id,title:row.title,summary:row.summary,source:{id:row.source_id,name:publicSourceName(row.source_name)},author:row.author,links:{original:row.url},
    publishedAt:row.published_at?.toISOString()??null,discoveredAt:row.discovered_at.toISOString(),timelineAt:row.sort_at.toISOString(),category:row.category,tags:displayTags(row.tags),bodyState:readerBodyState(row),engagement:{views:row.views,likes:row.likes}};
}
export async function withReaderMetadata(items:ReaderItemSummary[]){
  if(!items.length)return items;
  const translations=await serverModules().find(module=>module.publicationMetadata)?.publicationMetadata?.(items);
  return translations?items.map(item=>({...item,metadataTranslation:translations.get(item.id)??null})):items;
}
