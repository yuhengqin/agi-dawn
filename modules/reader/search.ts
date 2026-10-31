import type {Db} from "@agidawn/backend/db";
import {storedMaterials} from "@agidawn/backend/content/materials";
import {materialRepresentationHash} from "@agidawn/backend/modules";
import {collapseWhitespace} from "@agidawn/backend/lib/text";
import * as cheerio from "cheerio";
import type {LibraryMatch} from "./contracts.ts";

export interface LibraryRow {
  id:string;title:string;source:string;summary:string|null;note:string|null;discovered_at:Date;cursor_at:string;note_at:string|null;note_updated_at:Date|null;
  visibility:string|null;classification_version:number;starred:boolean|null;status:"to-read"|"reading"|"read"|null;version:number|null;updated_at:Date|null;
}
function bodyText(html:string){
  const $=cheerio.load(html,null,false);
  $("script,style,noscript").remove();$("br,hr").replaceWith("\n");
  // Syntax highlighting and emphasis may split a word across inline elements.
  $("address,article,aside,blockquote,caption,dd,details,div,dl,dt,fieldset,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,li,main,nav,ol,p,pre,section,summary,table,tbody,td,tfoot,th,thead,tr,ul").prepend("\n").append("\n");
  return collapseWhitespace($.root().text());
}
function snippet(text:string,words:string[]){
  const lower=text.toLowerCase(),at=Math.min(...words.map(word=>lower.indexOf(word)).filter(at=>at>=0));
  const chars=[...text],start=Math.max(0,[...text.slice(0,at)].length-45),prefix=start>0?"…":"",room=160-prefix.length;
  const suffix=chars.length-start>room?"…":"";
  return prefix+chars.slice(start,start+room-suffix.length).join("")+suffix;
}
/** No public projection/index supplies private body text; only an exact current saved capture may match. */
export async function searchLibraryBatch(db:Db,rows:LibraryRow[],words:string[]):Promise<Map<string,LibraryMatch[]>>{
  const captures=await storedMaterials(db,rows.map(row=>row.id));
  const hashes=new Map(captures.map(capture=>[capture.articleId,materialRepresentationHash(capture)]));
  const snapshots=captures.length?await db`SELECT article_id,body_revision,representation_hash FROM reader_snapshots
    WHERE article_id=ANY(${captures.map(c=>c.articleId)}::text[]) AND representation_hash=ANY(${[...hashes.values()]}::text[])`:[];
  const bodies=new Map(captures.filter(capture=>snapshots.some(s=>s.article_id===capture.articleId&&s.body_revision===capture.bodyRevision&&s.representation_hash===hashes.get(capture.articleId)))
    .map(capture=>[capture.articleId,bodyText(capture.bodyHtml)]));
  const matches=new Map<string,LibraryMatch[]>();
  for(const row of rows){
    const fields:Array<[LibraryMatch["field"],string]>=[["title",row.title],["summary",row.summary??""],["body",bodies.get(row.id)??""],["note",row.note??""]];
    const texts=fields.map(([field,text])=>({field,text:collapseWhitespace(text),lower:collapseWhitespace(text).toLowerCase()}));
    if(words.every(word=>texts.some(text=>text.lower.includes(word))))matches.set(row.id,texts.filter(text=>words.some(word=>text.lower.includes(word)))
      .map(({field,text})=>({field,snippet:snippet(text,words)})));
  }
  return matches;
}
