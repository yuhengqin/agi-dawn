import * as cheerio from 'cheerio';
import type {AnyNode,Element} from 'domhandler';
import {sanitizeBody} from '@agidawn/backend/content/sanitize';

type Request=(parts:string[],retry?:boolean)=>Promise<{t:string[]|null;receiptId:number}>;
const blocks=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','figcaption','td','th','dt','dd','caption']);
const container=/^(p|h[1-6]|li|blockquote|figcaption|td|th|dt|dd|caption|ul|ol|table|pre|figure|div)$/;
const protectedElements='picture, video, img, code, math, svg';

function shield(html:string){
  const $=cheerio.load(html,null,false),tokens:string[]=[],links:Array<Record<string,string>>=[];
  for(const node of $(protectedElements).toArray()){
    if($(node).parents(protectedElements).length)continue;
    tokens.push($.html(node));$(node).replaceWith(`⟦${tokens.length-1}⟧`);
  }
  $('a').each((i,node)=>{links.push({...node.attribs});node.attribs={id:`L${i}`};});
  return {html:$.html(),tokens,links};
}
function restore(text:string|null,input:ReturnType<typeof shield>):string|null{
  if(!text?.trim())return null;
  const counts=new Map<number,number>();
  for(const match of text.matchAll(/⟦(\d+)⟧/g)){const n=Number(match[1]);counts.set(n,(counts.get(n)??0)+1);}
  if(counts.size!==input.tokens.length||input.tokens.some((_,i)=>counts.get(i)!==1))return null;
  const $=cheerio.load(text,null,false),seen=new Set<number>();let valid=true;
  $('a').each((_,node)=>{
    const match=/^L(\d+)$/.exec(node.attribs.id??''),n=match?Number(match[1]):-1,attrs=input.links[n];
    if(!attrs||seen.has(n))valid=false;else{seen.add(n);node.attribs=attrs;}
  });
  if(!valid||seen.size!==input.links.length)return null;
  return $.html().replace(/⟦(\d+)⟧/g,(_,n:string)=>input.tokens[Number(n)]!);
}

/** Only wording goes to the model; original containers, code and media stay here. */
export async function translateHtml(html:string,request:Request){
  const $=cheerio.load(html,null,false),all:Array<{html:string;write:(html:string)=>void}>=[];
  // Direct text around nested lists/paragraphs is a segment too, without adding wrapper elements.
  const visit=(nodes:AnyNode[])=>{
    let inline:AnyNode[]=[];
    const flush=()=>{
      const run=inline;inline=[];
      if(!run.length||!/\p{L}/u.test($(run).text()))return;
      all.push({html:run.map(node=>$.html(node)).join(''),write:text=>{$(run[0]!).replaceWith(text);$(run.slice(1)).remove();}});
    };
    for(const node of nodes){
      if(node.type!=='tag'||!container.test(node.name)){inline.push(node);continue;}
      flush();
      const element=node as Element;
      if(['pre','code','math','svg'].includes(element.name))continue;
      const child=element.children.some(n=>n.type==='tag'&&container.test((n as Element).name));
      if(blocks.has(element.name)&&!child){if(/\p{L}/u.test($(element).text()))all.push({html:$(element).html()??'',write:text=>{$(element).html(text);}});}
      else visit(element.children);
    }
    flush();
  };
  visit($.root().children().toArray());
  let remaining=60_000;
  const chosen:typeof all=[];
  for(const segment of all){if(segment.html.length>remaining)break;remaining-=segment.html.length;chosen.push(segment);}
  const inputs=chosen.map(segment=>shield(segment.html)),receiptIds:number[]=[];
  async function batches(parts:string[],retry=false){
    const output:Array<string|null>=[];
    for(let start=0;start<parts.length;){
      let end=start,chars=0;
      while(end<parts.length&&(end===start||chars+parts[end]!.length<=3500))chars+=parts[end++]!.length;
      const batch=parts.slice(start,end),first=await request(batch,retry);receiptIds.push(first.receiptId);let result=first.t;
      if(!result&&batch.length>1){const mid=Math.ceil(batch.length/2),left=await request(batch.slice(0,mid),retry),right=await request(batch.slice(mid),retry);
        receiptIds.push(left.receiptId,right.receiptId);result=left.t&&right.t?[...left.t,...right.t]:null;}
      output.push(...(result??batch.map(()=>null)));start=end;
    }
    return output;
  }
  const first=await batches(inputs.map(input=>input.html)),translated=first.map((text,i)=>restore(text,inputs[i]!));
  const missing=translated.flatMap((text,i)=>text===null?[i]:[]);
  if(missing.length){const again=await batches(missing.map(i=>inputs[i]!.html),true);missing.forEach((i,k)=>{translated[i]=restore(again[k]??null,inputs[i]!);});}
  let segments=0;chosen.forEach((segment,i)=>{if(translated[i]!==null){segment.write(translated[i]!);segments++;}});
  return {html:sanitizeBody($.html()),complete:segments===all.length&&all.length>0,segments,receiptIds};
}
