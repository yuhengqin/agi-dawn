import {useLayoutEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router';
import {matchRanges,searchWords} from '@agidawn/contracts/search';
import type {ReaderItemDetail} from '@agidawn/contracts/site';
import {IconChevronDown,IconChevronUp} from '../../components/icons';

const fields={title:'标题',summary:'摘要',source:'来源',topic:'主题',body:'正文'};
const blocks='address,article,aside,blockquote,br,caption,dd,details,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,summary,table,tbody,td,tfoot,th,thead,tr,ul';
const excluded='[hidden],[aria-hidden="true"],button,script,style,svg,.code-block-head,.code-block-lines';

/** Keep inline markup continuous, but never join words across block boundaries or toolbars. */
function textMatches(root:HTMLElement,words:string[]):Range[]{
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:node=>node instanceof Element&&node.matches(excluded)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  const nodes:Array<{node:Text;start:number;end:number}>=[];
  let text='',previousBlock:Element|null=null;
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(node instanceof Element){if(node.matches(blocks))text+=' ';continue;}
    const parent=node.parentElement;if(!parent)continue;
    const block=parent.closest(blocks);
    if(block!==previousBlock)text+=' ';
    previousBlock=block;
    const start=text.length;text+=node.textContent??'';nodes.push({node:node as Text,start,end:text.length});
  }
  return matchRanges(text,words).flatMap(match=>{
    const first=nodes.find(node=>node.end>match.start),last=nodes.find(node=>node.end>=match.end);
    if(!first||!last)return [];
    const range=document.createRange();range.setStart(first.node,match.start-first.start);range.setEnd(last.node,match.end-last.start);return [range];
  });
}

export function ArticleSearch({item,onNavigate}:{item:ReaderItemDetail;onNavigate:()=>void}){
  const location=useLocation(),params=new URLSearchParams(location.search),raw=params.get('q')??'';
  const query=raw.length<=200&&!raw.includes('\0')?raw.trim():'';
  const originalFields=[...new Set(params.getAll('match').slice(0,10)
    .filter(hint=>/^(title|summary|body):original$/.test(hint)).map(hint=>hint.split(':')[0] as 'title'|'summary'|'body')
    .filter(field=>field==='body'?item.body?.language==='translation':!!item.metadataTranslation?.[field]))];
  const otherLanguage=originalFields.length>0;
  const panel=useRef<HTMLElement>(null),ranges=useRef<Range[]>([]),[count,setCount]=useState<number|null>(null);
  const [activeIndex,setActiveIndex]=useState<number|null>(null);
  const [allWordsVisible,setAllWordsVisible]=useState(false);
  const [revision,setRevision]=useState(0);
  useLayoutEffect(()=>{
    setActiveIndex(null);
    CSS.highlights?.delete('article-search-current');
  },[query,item.id]);
  // Mark mounted content before paint; the controls below reserve their space for history restoration.
  useLayoutEffect(()=>{
    const root=panel.current?.closest('article');if(!root)return;
    ranges.current=[];setCount(null);setAllWordsVisible(false);
    const words=searchWords(query).slice(0,6);
    if(!words.length)return;
    const contents=[...root.querySelectorAll<HTMLElement>('[data-search-content]')];
    const update=()=>{
      const nextRanges=contents.flatMap(content=>textMatches(content,words));
      ranges.current=nextRanges;
      setCount(nextRanges.length);
      const visible=nextRanges.filter(range=>range.getClientRects().length>0);
      setAllWordsVisible(nextRanges.length>0&&words.every(word=>visible.some(range=>matchRanges(range.toString(),[word]).length>0)));
      setRevision(value=>value+1);
      if(CSS.highlights&&typeof Highlight!=='undefined')CSS.highlights.set('article-search',new Highlight(...nextRanges));
    };
    update();
    // Lazy syntax colouring replaces text nodes. Collapsing code also changes what can be located.
    const observer=new MutationObserver(update);
    for(const content of contents)observer.observe(content,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
    return()=>{observer.disconnect();ranges.current=[];CSS.highlights?.delete('article-search');CSS.highlights?.delete('article-search-current');};
  },[query,item]);
  useLayoutEffect(()=>{
    if(activeIndex===null){CSS.highlights?.delete('article-search-current');return;}
    const visible=ranges.current.filter(range=>range.getClientRects().length>0);
    if(!visible.length){setActiveIndex(null);CSS.highlights?.delete('article-search-current');return;}
    if(activeIndex>=visible.length){setActiveIndex(visible.length-1);return;}
    if(CSS.highlights&&typeof Highlight!=='undefined')CSS.highlights.set('article-search-current',new Highlight(visible[activeIndex]!));
  },[activeIndex,revision,query,item]);
  if(!query)return null;
  const locateAt=(index:number)=>{
    const visible=ranges.current.filter(range=>range.getClientRects().length>0);if(!visible.length)return;
    const next=((index%visible.length)+visible.length)%visible.length;
    const range=visible[next]!;
    setActiveIndex(next);
    if(CSS.highlights&&typeof Highlight!=='undefined')CSS.highlights.set('article-search-current',new Highlight(range));
    onNavigate();
    const target=range.startContainer.parentElement;
    if(target&&target.tabIndex<0&&!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');
    target?.focus({preventScroll:true});
    // A text range can exist outside a code block or table's horizontal viewport.
    const root=panel.current?.closest('article');
    for(let parent=target;parent&&parent!==root;parent=parent.parentElement){
      if(parent.scrollWidth<=parent.clientWidth||!['auto','scroll','hidden'].includes(getComputedStyle(parent).overflowX))continue;
      const match=range.getBoundingClientRect(),box=parent.getBoundingClientRect(),left=box.left+parent.clientLeft;
      if(match.left<left||match.right>left+parent.clientWidth)parent.scrollLeft+=match.left-left-Math.max(0,(parent.clientWidth-match.width)/2);
    }
    window.scrollTo({top:Math.max(0,window.scrollY+range.getBoundingClientRect().top-window.innerHeight/4),behavior:'instant'});
  };
  return <section ref={panel} className="article-search-context" aria-label="搜索定位" data-reading-controls>
    <div className="article-search-row flex flex-wrap items-center gap-x-4 gap-y-1"><span>搜索：<strong>{query}</strong></span>
      <span role="status" className="min-w-[12em]">{count===null?'正在查找…':count?`当前页面 ${count} 处匹配`:'当前页面未找到关键词'}</span>
      {!!count&&<span className="article-search-controls inline-flex flex-wrap items-center gap-2">
        {(activeIndex===null||count===1)&&<button type="button" onClick={()=>locateAt(0)}>定位到首处匹配</button>}
        {count>1&&<span className="article-search-stepper inline-flex items-center gap-1">
          <button type="button" className="article-search-step" aria-label="上一处匹配" title="上一处匹配" onClick={()=>locateAt((activeIndex??0)-1)}><IconChevronUp size={15}/></button>
          {activeIndex!==null&&<span className="article-search-counter tabular-nums">{activeIndex+1} / {count}</span>}
          <button type="button" className="article-search-step" aria-label="下一处匹配" title="下一处匹配" onClick={()=>locateAt((activeIndex??-1)+1)}><IconChevronDown size={15}/></button>
        </span>}
      </span>}
      <Link to={location.pathname} replace className="article-search-clear">清除高亮</Link>
    </div>
    {otherLanguage&&!allWordsVisible&&<>
      <p>搜索结果命中{originalFields.map(field=>fields[field]+'原文').join('、')}；当前显示中文译文。</p>
      <p><a href={item.links.original} target="_blank" rel="noreferrer" aria-label="打开搜索命中的原文">打开原文查找“{query}”</a></p>
    </>}
  </section>;
}
