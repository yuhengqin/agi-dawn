import type {OutlineEntry} from '@agidawn/contracts/site';
import * as cheerio from 'cheerio';

export function withOutline(html:string,options:{excludeFigures?:boolean}={}){
  const outline:OutlineEntry[]=[];let n=0;
  const output=html.replace(/<h([2-4])(?: id="sec-\d+")?>([\s\S]*?)<\/h\1>/gi,(_match,level:string,inner:string)=>{
    const id='sec-'+(++n),text=cheerio.load(inner,null,false).root().text().replace(/\s+/g,' ').trim();
    if(text)outline.push({id,text:text.slice(0,80),level:Number(level)});
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  if(options.excludeFigures){
    const $=cheerio.load(output,null,false),excluded=new Set($('figure :is(h2,h3,h4),figcaption :is(h2,h3,h4),[data-reader-card] :is(h2,h3,h4)').map((_,node)=>$(node).attr('id')).get());
    return {html:output,outline:outline.filter(entry=>!excluded.has(entry.id))};
  }
  return {html:output,outline};
}
