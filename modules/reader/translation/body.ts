import * as cheerio from 'cheerio';
import type {AnyNode,Element} from 'domhandler';
import {sanitizeBody} from '@agidawn/backend/content/sanitize';
import {isChineseText} from '@agidawn/backend/lib/text';

type Request=(parts:string[],retry?:boolean)=>Promise<{t:string[]|null;receiptId:number}>;
const blocks=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','figcaption','td','th','dt','dd','caption']);
const container=/^(p|h[1-6]|li|blockquote|figcaption|td|th|dt|dd|caption|ul|ol|dl|table|thead|tbody|tfoot|tr|pre|figure|div)$/;
const protectedElements='picture, video, img, code, math, svg, [data-reader-math="katex"]';

/** Infer the article's prose language, excluding protected code and generated reader notices. */
export function isChineseBody(html:string,language?:string|null):boolean{
  const $=cheerio.load(html,null,false);
  $('pre,code,math,svg,[data-reader-math],[data-reader-embed],figure[data-reader-figure-status="missing"] > p:first-child').remove();
  return isChineseText($.root().text(),language);
}

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
  const prose=(html:string)=>{const $=cheerio.load(html,null,false);$(protectedElements).remove();return $.root().text().replace(/⟦\d+⟧/g,'').replace(/https?:\/\/[^\s<>]+/g,'').replace(/\s+/g,' ').trim();};
  const before=prose(input.html),after=prose(text);
  if(!/[{}\[\]]/.test(before)&&/[{}\[\]]/.test(after))return null;
  const words=(value:string)=>value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)??[];
  const sourceWords=words(before),targetWords=words(after),han=(value:string)=>(value.match(/\p{Script=Han}/gu)??[]).length;
  const ordinaryHeading=/^(?:introduction|overview|background|conclusions?|summary|acknowledg(?:e)?ments?|results|discussion)$/i.test(before)
    ||/^(?:what|why|how|when|where)\b/i.test(before)||/\bwithout\b/i.test(before);
  if(han(before)===0&&(sourceWords.length>=8||ordinaryHeading)){
    if(han(after)===0)return null;
    if(sourceWords.length>=8&&han(after)<4&&targetWords.join(' ').toLowerCase().includes(sourceWords.join(' ').toLowerCase()))return null;
  }
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

function proseSegments($:cheerio.CheerioAPI){
  const all:Array<{html:string;write:(html:string)=>void}>=[];
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
  return all;
}

/** Only wording goes to the model; original containers, code and media stay here. */
export async function translateHtml(html:string,request:Request,previous?:{sourceHtml:string;translatedHtml:string}){
  const $=cheerio.load(html,null,false),all=proseSegments($),cache=new Map<string,string>(),ambiguous=new Set<string>();
  const key=(input:ReturnType<typeof shield>)=>JSON.stringify([input.html,input.tokens,input.links]);
  if(previous){
    const source=proseSegments(cheerio.load(previous.sourceHtml,null,false)),translated=proseSegments(cheerio.load(previous.translatedHtml,null,false));
    if(source.length===translated.length)source.forEach((segment,index)=>{
      const input=shield(segment.html),candidate=shield(translated[index]!.html),id=key(input);
      if(JSON.stringify(input.tokens)!==JSON.stringify(candidate.tokens)||JSON.stringify(input.links)!==JSON.stringify(candidate.links)||!restore(candidate.html,input))return;
      if(cache.has(id)&&cache.get(id)!==candidate.html){cache.delete(id);ambiguous.add(id);}
      if(!ambiguous.has(id))cache.set(id,candidate.html);
    });
  }
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
  const translated=inputs.map(input=>restore(cache.get(key(input))??null,input));
  const requested=translated.flatMap((text,index)=>text===null?[index]:[]);
  if(requested.length){const first=await batches(requested.map(i=>inputs[i]!.html));requested.forEach((i,k)=>{translated[i]=restore(first[k]??null,inputs[i]!);});}
  const missing=translated.flatMap((text,i)=>text===null?[i]:[]);
  if(missing.length){const again=await batches(missing.map(i=>inputs[i]!.html),true);missing.forEach((i,k)=>{translated[i]=restore(again[k]??null,inputs[i]!);});}
  let segments=0;chosen.forEach((segment,i)=>{if(translated[i]!==null){segment.write(translated[i]!);segments++;}});
  return {html:sanitizeBody($.html()),complete:segments===all.length&&all.length>0,segments,receiptIds};
}
