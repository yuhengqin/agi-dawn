import type {ReaderItemDetail} from "@agidawn/contracts/site";
import {sql} from "../db.ts";
import {withOutline} from '../content/outline.ts';
import {cleanArticlePresentation} from '../content/presentation.ts';
import {locateArticleFigures} from '../content/figure-links.ts';
import {materialRepresentationHash,serverModules,type MaterialCapture} from "../modules.ts";
import {READER_COLUMNS,READER_FROM,readerTranslationJoin,readerVisible,toReaderItem,withReaderMetadata,type ReaderRow} from "./items.ts";
import {listTopics} from "./topics.ts";
import {articleIntro,isChineseBody} from '../content/reading.ts';
export async function loadItemDetail(id:string):Promise<{kind:"found";item:ReaderItemDetail}|{kind:"not_found"}>{
  const [row]=await sql<(ReaderRow&{raw_title:string;raw_url:string;raw_published_at:Date|null})[]>`
    SELECT ${READER_COLUMNS},a.title AS raw_title,a.url AS raw_url,a.published_at AS raw_published_at
    ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}`;
  if(!row)return {kind:"not_found"};
  const capture:MaterialCapture|null=row.quality_html&&row.body_revision!==null
    ?{articleId:id,bodyRevision:row.body_revision,bodyHtml:row.quality_html,title:row.raw_title,author:row.author,originalUrl:row.raw_url,
      publishedAt:row.raw_published_at?.toISOString()??null,discoveredAt:row.discovered_at.toISOString(),sourceId:row.source_id,sourceName:row.source_name,quality:row.body_quality==="partial"?"partial":"ready",issues:row.body_issues}:null;
  const input=capture?{articleId:id,bodyRevision:capture.bodyRevision,representationHash:materialRepresentationHash(capture),html:capture.bodyHtml}:null;
  const translated=input&&await serverModules().find(module=>module.publicationTranslation)?.publicationTranslation?.(input);
  const summary=toReaderItem({...row,translated_html:translated?.html});
  let body:ReaderItemDetail['body']=null;
  if(input){
    const rewrite=serverModules().find(module=>module.publicationBody)?.publicationBody;
    const clean=(html:string)=>cleanArticlePresentation(html,{url:row.raw_url,publishedAt:row.raw_published_at?.toISOString(),issues:row.body_issues,author:row.author});
    const render=async(html:string)=>clean(rewrite?await rewrite({...input,html:clean(html)}):html.replace(/<img\b[^>]*>/gi,''));
    const rendered=await render(translated?.html??input.html);
    const sourceFigures=translated&&rendered.includes('data-reader-figure-status="missing"')?clean(input.html):undefined;
    const outlined=withOutline(locateArticleFigures(rendered,row.raw_url,sourceFigures),{excludeFigures:true});
    body={...outlined,language:translated?'translation':'original',contentLanguage:isChineseBody(outlined.html)?'zh':null,complete:translated?.complete??true,readingMinutes:summary.readingMinutes??null};
  }
  const topics=(await listTopics()).filter(topic=>topic.tags.some(tag=>row.tags.includes(tag))).map(({slug,name})=>({slug,name}));
  const [metadata]=await withReaderMetadata([summary]);
  const relatedRows=await sql<ReaderRow[]>`SELECT ${READER_COLUMNS},translated.body_html AS translated_html ${READER_FROM} ${readerTranslationJoin()} WHERE ${readerVisible} AND p.article_id<>${id}
    AND (p.tags && ${row.tags}::text[] OR p.source_id=${row.source_id})
    ORDER BY (p.tags && ${row.tags}::text[]) DESC,p.sort_at DESC,p.article_id DESC LIMIT 3`;
  const related=await withReaderMetadata(relatedRows.map(toReaderItem));
  const original=body?{summary:metadata!.summary,html:cleanArticlePresentation(row.quality_html??'',{url:row.raw_url,publishedAt:row.raw_published_at?.toISOString(),author:row.author})}:undefined;
  return {kind:"found",item:{...metadata!,body,intro:articleIntro(metadata!.metadataTranslation?.summary??metadata!.summary,body?.html??null,original),topics,related}};
}
