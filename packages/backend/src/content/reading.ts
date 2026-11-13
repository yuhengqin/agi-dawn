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
  const opening:string[]=[];
  for(const node of $.root().children().toArray()){
    const block=$(node);if(block.is('h1,h2,h3,h4,h5,h6'))break;
    if(block.is('figure,pre,[data-reader-embed]'))continue;
    const text=block.text().trim();if(text)opening.push(text);
    if(opening.join('').length>=3000)break;
  }
  const normalize=(text:string)=>collapseWhitespace(text.normalize('NFKC')).replace(/(?:\.{2,}|…+)$/u,'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,'').toLowerCase();
  const intro=normalize(summary),paragraph=normalize(opening.join(' '));
  return intro===paragraph||(intro.length>=24&&paragraph.startsWith(intro))?null:summary;
}
