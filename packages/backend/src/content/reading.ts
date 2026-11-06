import * as cheerio from 'cheerio';
import {collapseWhitespace} from '../lib/text.ts';

export function estimateReadingMinutes(text:string):number|null{
  if(!text.trim())return null;
  const chinese=(text.match(/\p{Script=Han}/gu)??[]).length,words=(text.replace(/\p{Script=Han}/gu,' ').match(/[\p{L}\p{N}]+/gu)??[]).length;
  return Math.max(1,Math.ceil(chinese/350+words/220));
}
export function isTruncatedExcerpt(summary:string|null,body:string|null):boolean{
  if(!summary||!body||/[.!?。！？…]["'”’）)]*$/.test(summary.trim()))return false;
  const text=collapseWhitespace(summary),full=collapseWhitespace(body),at=full.indexOf(text);
  return text.length>=24&&at>=0&&at<=300&&full.length>at+text.length;
}
export function articleIntro(summary:string|null,html:string|null,original?:{summary:string|null;html:string|null}):string|null{
  if(!summary||!html)return summary;
  if(original?.summary&&original.html&&articleIntro(original.summary,original.html)===null)return null;
  const $=cheerio.load(html,null,false);
  const first=$('p').filter((_,node)=>!$(node).closest('figure,blockquote,pre,[data-reader-embed]').length&&$(node).text().trim().length>0).first().text();
  const normalize=(text:string)=>collapseWhitespace(text.normalize('NFKC')).replace(/(?:\.{2,}|…+)$/u,'').trim().toLowerCase();
  const intro=normalize(summary),paragraph=normalize(first);
  return intro===paragraph||(intro.length>=24&&paragraph.startsWith(intro))?null:summary;
}
