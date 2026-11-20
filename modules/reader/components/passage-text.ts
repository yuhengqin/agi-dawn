import type {Passage} from '../contracts.ts';

// KaTeX hides the visible glyphs from assistive technology and supplies a separate MathML copy.
const controls='[aria-hidden="true"]:not(.katex-html),.katex-mathml,button,script,style,svg,textarea,select,.code-block-head,.code-block-lines';
const blocks='p,div,li,dt,dd,td,th,pre,blockquote,figcaption,h1,h2,h3,h4,h5,h6,section';
type Run={node:Text;start:number;end:number};
type Index={text:string;runs:Run[]};

/** Offsets include paragraph breaks but exclude reader controls. Folded code keeps its offsets. */
export function indexPassages(root:HTMLElement):Index {
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
    acceptNode:node=>node instanceof Element&&node.matches(controls)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT,
  });
  let text='',lastBlock:Element|null=null;
  const runs:Run[]=[];
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(node instanceof HTMLBRElement){text+='\n';continue;}
    if(!(node instanceof Text)||!node.length)continue;
    const block=node.parentElement?.closest(blocks)??null;
    if(block!==lastBlock&&text&&!text.endsWith('\n'))text+='\n';
    lastBlock=block;
    const start=text.length;text+=node.data;runs.push({node,start,end:text.length});
  }
  return {text,runs};
}

export function selectedPassage(root:HTMLElement,index:Index,range:Range):Passage|null {
  if(range.collapsed||!root.contains(range.commonAncestorContainer))return null;
  const touched=index.runs.filter(run=>range.intersectsNode(run.node));
  const first=touched[0],last=touched.at(-1);
  if(!first||!last||touched.some(run=>run.node.parentElement?.closest('[hidden]')))return null;
  const start=first.start+(range.startContainer===first.node?range.startOffset:0);
  const end=last.start+(range.endContainer===last.node?range.endOffset:last.node.length);
  const quote=index.text.slice(start,end);
  return quote.trim()?{start,end,quote}:null;
}

export function passageRanges(index:Index,start:number,end:number,quote?:string):Range[]{
  if(start<0||end<=start||end>index.text.length||(quote!==undefined&&quote!==index.text.slice(start,end)))return [];
  const ranges:Range[]=[];
  for(const run of index.runs){
    if(run.start>=end)break;
    if(run.end<=start||run.node.parentElement?.closest('[hidden]'))continue;
    const range=new Range();
    range.setStart(run.node,Math.max(0,start-run.start));
    range.setEnd(run.node,Math.min(run.node.length,end-run.start));
    ranges.push(range);
  }
  return ranges;
}

export function passageUrl(bodyKey:string,{start,end}:Passage){
  const url=new URL(location.pathname,location.origin);
  url.hash=`passage-${bodyKey}-${start}-${end}`;
  return url.href;
}

export function paintRanges(name:string,ranges:Range[]){
  if(typeof Highlight==='undefined'||!CSS.highlights)return;
  if(ranges.length){
    const highlight=new Highlight();
    for(const range of ranges)highlight.add(range);
    CSS.highlights.set(name,highlight);
  }else CSS.highlights.delete(name);
}
