import * as cheerio from 'cheerio';
import type {AnyNode,Element} from 'domhandler';
import {sanitizeBody} from '@agidawn/backend/content/sanitize';
export {isChineseBody} from '@agidawn/backend/content/reading';

export type BodyRetry={retryReasons:string[];attemptTag?:'retry'};
type Request=(parts:string[],retry?:BodyRetry)=>Promise<{t:string[]|null;receiptId:number}>;
type CheckedSegment={html:string;reason?:never}|{reason:string;html?:never};
const blocks=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','figcaption','td','th','dt','dd','caption']);
const container=/^(p|h[1-6]|li|blockquote|figcaption|td|th|dt|dd|caption|ul|ol|dl|table|thead|tbody|tfoot|tr|pre|figure|div)$/;
const protectedElements='picture, video, img, code, math, svg, [data-reader-math="katex"]';

function shield(html:string){
  const $=cheerio.load(html,null,false),tokens:string[]=[],links:Array<Record<string,string>>=[];
  for(const node of $(protectedElements).toArray()){
    if($(node).parents(protectedElements).length)continue;
    tokens.push($.html(node));$(node).replaceWith(`⟦${tokens.length-1}⟧`);
  }
  $('a').each((i,node)=>{links.push({...node.attribs});node.attribs={id:`L${i}`};});
  return {html:$.html(),tokens,links};
}
function restore(text:string,input:ReturnType<typeof shield>):CheckedSegment{
  if(!text.trim())return {reason:'译文为空，请翻译此片段。'};
  const prose=(html:string)=>{const $=cheerio.load(html,null,false);$(protectedElements).remove();return $.root().text().replace(/⟦\d+⟧/g,'').replace(/https?:\/\/[^\s<>]+/g,'').replace(/\s+/g,' ').trim();};
  const before=prose(input.html),after=prose(text);
  if(!/[{}\[\]]/.test(before)&&/[{}\[\]]/.test(after))return {reason:'译文正文出现原文没有的 JSON 分隔符，请移除多余符号。'};
  const words=(value:string)=>value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)??[];
  const sourceWords=words(before),targetWords=words(after),han=(value:string)=>(value.match(/\p{Script=Han}/gu)??[]).length;
  const ordinaryHeading=/^(?:introduction|overview|background|conclusions?|summary|acknowledg(?:e)?ments?|results|discussion)$/i.test(before)
    ||/^(?:what|why|how|when|where)\b/i.test(before)||/\bwithout\b/i.test(before);
  if(han(before)===0&&(sourceWords.length>=8||ordinaryHeading)){
    if(han(after)===0)return {reason:'英文原文未译成中文，请翻译可读文字，保留专名。'};
    if(sourceWords.length>=8&&han(after)<4&&targetWords.join(' ').toLowerCase().includes(sourceWords.join(' ').toLowerCase()))return {reason:'译文仍整段照抄英文，请翻译整段可读文字。'};
  }
  const counts=new Map<number,number>();
  for(const match of text.matchAll(/⟦(\d+)⟧/g)){const n=Number(match[1]);counts.set(n,(counts.get(n)??0)+1);}
  for(let i=0;i<input.tokens.length;i++){
    const count=counts.get(i);
    if(count===undefined)return {reason:`缺少占位符 ⟦${i}⟧，请在对应位置原样保留一次。`};
    if(count>1)return {reason:`占位符 ⟦${i}⟧ 重复，请只保留一次。`};
  }
  if(counts.size!==input.tokens.length)return {reason:'译文多出了原文没有的占位符，请移除。'};
  const $=cheerio.load(text,null,false),seen=new Set<number>();
  for(const node of $('a').toArray()){
    const match=/^L(\d+)$/.exec(node.attribs.id??''),n=match?Number(match[1]):-1,attrs=input.links[n];
    if(!attrs)return {reason:'链接缺少原有 id 或包含未知链接，请逐一保留原文的链接和 id。'};
    if(seen.has(n))return {reason:`链接 L${n} 重复，请保留原标签一次。`};
    seen.add(n);node.attribs=attrs;
  }
  for(let i=0;i<input.links.length;i++){
    if(!seen.has(i))return {reason:`缺少链接 L${i}，请保留原标签和 id，只翻译链接文字。`};
  }
  return {html:$.html().replace(/⟦(\d+)⟧/g,(_,n:string)=>input.tokens[Number(n)]!)};
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
      if(JSON.stringify(input.tokens)!==JSON.stringify(candidate.tokens)||JSON.stringify(input.links)!==JSON.stringify(candidate.links))return;
      const {html}=restore(candidate.html,input);
      if(html===undefined)return;
      if(cache.has(id)&&cache.get(id)!==html){cache.delete(id);ambiguous.add(id);}
      if(!ambiguous.has(id))cache.set(id,html);
    });
  }
  let remaining=60_000;
  const chosen:typeof all=[];
  for(const segment of all){if(segment.html.length>remaining)break;remaining-=segment.html.length;chosen.push(segment);}
  type Segment={input:ReturnType<typeof shield>;result?:CheckedSegment};
  const parts:Segment[]=chosen.map(segment=>{
    const input=shield(segment.html),html=cache.get(key(input));
    return {input,result:html===undefined?undefined:{html}};
  });
  const receiptIds:number[]=[];
  const wrongCount='上一批译文条数与原文不符。请按顺序为每个片段返回一条译文。';
  async function send(batch:Segment[],attemptTag?:'retry',split=false):Promise<void>{
    let feedback:BodyRetry|undefined;
    if(attemptTag||split){
      const retryReasons=batch.map(({result})=>{
        const reason=result?.reason;
        if(!reason||reason===wrongCount)return wrongCount;
        return split?`${reason} ${wrongCount}`:reason;
      });
      feedback={attemptTag,retryReasons};
    }
    const {t,receiptId}=await request(batch.map(part=>part.input.html),feedback);
    receiptIds.push(receiptId);
    if(t?.length===batch.length){
      batch.forEach((part,i)=>{part.result=restore(t[i]!,part.input);});
    }else if(!split&&batch.length>1){
      const mid=Math.ceil(batch.length/2);
      await send(batch.slice(0,mid),attemptTag,true);
      await send(batch.slice(mid),attemptTag,true);
    }else{
      for(const part of batch)part.result={reason:wrongCount};
    }
  }
  async function batches(pending:Segment[],attemptTag?:'retry'){
    for(let start=0;start<pending.length;){
      let end=start,chars=0;
      while(end<pending.length&&(end===start||chars+pending[end]!.input.html.length<=3500))chars+=pending[end++]!.input.html.length;
      await send(pending.slice(start,end),attemptTag);
      start=end;
    }
  }
  await batches(parts.filter(part=>!part.result));
  await batches(parts.filter(part=>part.result?.reason),'retry');
  let segments=0;
  parts.forEach(({result},i)=>{if(result?.html!==undefined){chosen[i]!.write(result.html);segments++;}});
  return {html:sanitizeBody($.html()),complete:segments===all.length&&all.length>0,segments,receiptIds};
}
