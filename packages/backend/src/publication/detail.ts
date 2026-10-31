import type {ReaderItemDetail} from "@agidawn/contracts/site";
import {sql} from "../db.ts";
import {withOutline} from '../content/outline.ts';
import {materialRepresentationHash,serverModules,type MaterialCapture} from "../modules.ts";
import {READER_COLUMNS,READER_FROM,readerVisible,toReaderItem,withReaderMetadata,type ReaderRow} from "./items.ts";
import {listTopics} from "./topics.ts";
export async function loadItemDetail(id:string):Promise<{kind:"found";item:ReaderItemDetail}|{kind:"not_found"}>{
  const [row]=await sql<(ReaderRow&{body_html:string|null;raw_title:string;raw_url:string;raw_published_at:Date|null})[]>`
    SELECT ${READER_COLUMNS},a.body_html,a.title AS raw_title,a.url AS raw_url,a.published_at AS raw_published_at
    ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}`;
  if(!row)return {kind:"not_found"};
  const summary=toReaderItem(row);let body:string|null=null,translation:ReaderItemDetail['translation']=null;
  if(row.site_fulltext&&row.visibility==="public"&&(!row.manual_visibility||row.manual_visibility==="public")&&row.body_html&&row.body_revision!==null){
    const capture:MaterialCapture={articleId:id,bodyRevision:row.body_revision,bodyHtml:row.body_html,title:row.raw_title,author:row.author,originalUrl:row.raw_url,
      publishedAt:row.raw_published_at?.toISOString()??null,discoveredAt:row.discovered_at.toISOString(),sourceId:row.source_id,sourceName:row.source_name,quality:row.body_quality==="partial"?"partial":"ready",issues:row.body_issues};
    const rewrite=serverModules().find(module=>module.publicationBody)?.publicationBody;
    const input={articleId:id,bodyRevision:row.body_revision,representationHash:materialRepresentationHash(capture),html:row.body_html};
    const render=(html:string)=>rewrite?rewrite({...input,html}):Promise.resolve(html.replace(/<img\b[^>]*>/gi,''));
    body=await render(input.html);
    const translated=await serverModules().find(module=>module.publicationTranslation)?.publicationTranslation?.(input);
    if(translated){const outlined=withOutline(await render(translated.html));translation={bodyHtml:outlined.html,outline:outlined.outline,complete:translated.complete};}
  }
  const outlined=body?withOutline(body):{html:null,outline:[]};
  const topics=(await listTopics()).filter(topic=>topic.tags.some(tag=>row.tags.includes(tag))).map(({slug,name})=>({slug,name}));
  const [metadata]=await withReaderMetadata([summary]);
  return {kind:"found",item:{...metadata!,bodyHtml:outlined.html,outline:outlined.outline,topics,translation}};
}
