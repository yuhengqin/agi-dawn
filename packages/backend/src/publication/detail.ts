import type {ReaderItemDetail} from "@agidawn/contracts/site";
import {sql} from "../db.ts";
import {withOutline} from '../content/outline.ts';
import {cleanArticlePresentation} from '../content/presentation.ts';
import {materialRepresentationHash,serverModules,type MaterialCapture} from "../modules.ts";
import {READER_COLUMNS,READER_FROM,readerVisible,toReaderItem,withReaderMetadata,type ReaderRow} from "./items.ts";
import {listTopics} from "./topics.ts";
import {articleIntro,estimateReadingMinutes} from '../content/reading.ts';
import {stripTagMarkup} from '../lib/text.ts';
export async function loadItemDetail(id:string):Promise<{kind:"found";item:ReaderItemDetail}|{kind:"not_found"}>{
  const [row]=await sql<(ReaderRow&{body_html:string|null;raw_title:string;raw_url:string;raw_published_at:Date|null})[]>`
    SELECT ${READER_COLUMNS},a.body_html,a.title AS raw_title,a.url AS raw_url,a.published_at AS raw_published_at
    ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}`;
  if(!row)return {kind:"not_found"};
  const summary=toReaderItem(row);let body:ReaderItemDetail['body']=null;
  if(row.site_fulltext&&row.visibility==="public"&&(!row.manual_visibility||row.manual_visibility==="public")&&row.body_html&&row.body_revision!==null){
    const capture:MaterialCapture={articleId:id,bodyRevision:row.body_revision,bodyHtml:row.body_html,title:row.raw_title,author:row.author,originalUrl:row.raw_url,
      publishedAt:row.raw_published_at?.toISOString()??null,discoveredAt:row.discovered_at.toISOString(),sourceId:row.source_id,sourceName:row.source_name,quality:row.body_quality==="partial"?"partial":"ready",issues:row.body_issues};
    const rewrite=serverModules().find(module=>module.publicationBody)?.publicationBody;
    const input={articleId:id,bodyRevision:row.body_revision,representationHash:materialRepresentationHash(capture),html:row.body_html};
    const clean=(html:string)=>cleanArticlePresentation(html,{url:row.raw_url,publishedAt:row.raw_published_at?.toISOString(),issues:row.body_issues});
    const render=async(html:string)=>clean(rewrite?await rewrite({...input,html:clean(html)}):html.replace(/<img\b[^>]*>/gi,''));
    const translated=await serverModules().find(module=>module.publicationTranslation)?.publicationTranslation?.(input);
    const outlined=withOutline(await render(translated?.html??input.html),{excludeFigures:true});
    body={...outlined,language:translated?'translation':'original',complete:translated?.complete??true,readingMinutes:estimateReadingMinutes(stripTagMarkup(outlined.html,' '))};
  }
  const topics=(await listTopics()).filter(topic=>topic.tags.some(tag=>row.tags.includes(tag))).map(({slug,name})=>({slug,name}));
  const [metadata]=await withReaderMetadata([summary]);
  const relatedRows=await sql<ReaderRow[]>`SELECT ${READER_COLUMNS} ${READER_FROM} WHERE ${readerVisible} AND p.article_id<>${id}
    AND (p.tags && ${row.tags}::text[] OR p.source_id=${row.source_id})
    ORDER BY (p.tags && ${row.tags}::text[]) DESC,p.sort_at DESC,p.article_id DESC LIMIT 3`;
  const related=await withReaderMetadata(relatedRows.map(toReaderItem));
  const original=body?{summary:metadata!.summary,html:cleanArticlePresentation(row.body_html??'',{url:row.raw_url,publishedAt:row.raw_published_at?.toISOString()})}:undefined;
  return {kind:"found",item:{...metadata!,readingMinutes:body?.readingMinutes??null,body,intro:articleIntro(metadata!.metadataTranslation?.summary??metadata!.summary,body?.html??null,original),topics,related}};
}
