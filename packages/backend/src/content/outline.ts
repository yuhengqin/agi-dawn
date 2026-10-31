import type {OutlineEntry} from '@agidawn/contracts/site';
import {stripTagMarkup} from '../lib/text.ts';

export function withOutline(html:string){
  const outline:OutlineEntry[]=[];let n=0;
  const output=html.replace(/<h([2-4])(?: id="sec-\d+")?>([\s\S]*?)<\/h\1>/gi,(_match,level:string,inner:string)=>{
    const id='sec-'+(++n),text=stripTagMarkup(inner,'').trim();
    if(text)outline.push({id,text:text.slice(0,80),level:Number(level)});
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });return {html:output,outline};
}
