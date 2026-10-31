import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {Link,useLocation} from "react-router";
import {ARTICLE_NAVIGATION} from "@agidawn/site";
import {IconChevronDown} from "../../components/icons";
import type {ReaderPageData} from "./reader.server";

export function readerLink(query:Record<string,string>,changes:Record<string,string|null>){
  const next=new URLSearchParams(query);next.delete('page');
  for(const [key,value] of Object.entries(changes)){if(value)next.set(key,value);else next.delete(key);}
  return next.size?`/?${next}`:'/';
}

/** Native disclosure remains usable without JS; the panel overlays the list. */
export function ReaderPopover({label,triggerLabel,children,className='',panelClassName='',active=false,onOpen}:{label:ReactNode;triggerLabel?:string;children:ReactNode|((close:()=>void)=>ReactNode);className?:string;panelClassName?:string;active?:boolean;onOpen?:()=>void}){
  const ref=useRef<HTMLDetailsElement>(null),location=useLocation();
  const close=()=>{if(ref.current){ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
  const fitPanel=()=>{
    if(!ref.current?.open)return;
    const panel=ref.current.querySelector<HTMLElement>('.reader-popover-panel')!;
    panel.style.translate='none';const bounds=panel.getBoundingClientRect();
    const shift=Math.max(12-bounds.left,Math.min(0,window.innerWidth-12-bounds.right));
    panel.style.translate=`${shift}px 0`;
  };
  useEffect(()=>{if(ref.current)ref.current.open=false;},[location.key]);
  useEffect(()=>{
    const details=ref.current!;
    const outside=(event:PointerEvent)=>{if(!details.contains(event.target as Node))details.open=false;};
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&details.open){details.open=false;details.querySelector('summary')?.focus();}
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',fitPanel);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',fitPanel);};
  },[]);
  return <details ref={ref} name="reader-picker" className={`reader-popover ${className}`}
    onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}}>
    <summary aria-label={triggerLabel} title={triggerLabel} className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 text-[13px] ${active?'text-accent':'text-ink-3'} hover:text-accent`} onClick={event=>{
      event.preventDefault();const details=ref.current!,opening=!details.open;
      if(opening)onOpen?.();details.open=opening;if(opening)fitPanel();
    }}
      onKeyDown={event=>{
        // WebKit can keep Tab on the summary after reopening an absolute overlay.
        // Enter its first control explicitly; subsequent controls keep native Tab order.
        if(event.key==='Tab'&&!event.shiftKey&&ref.current?.open){
          const first=ref.current.querySelector<HTMLElement>('a[href],button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled])');
          if(first){event.preventDefault();first.focus();}
        }
      }}>
      <span>{label}</span><IconChevronDown size={16}/>
    </summary>
    <div className={`reader-popover-panel ${panelClassName}`} onClick={event=>{if((event.target as Element).closest('a'))ref.current!.open=false;}}>{typeof children==='function'?children(close):children}</div>
  </details>;
}

const navLink="flex min-h-10 items-center rounded-mark px-3 py-2 text-[13px] text-ink-3 hover:bg-bg-sunk hover:text-ink aria-[current=page]:bg-accent/10 aria-[current=page]:font-semibold aria-[current=page]:text-accent";
export function CategoryNavigation({categories,query,currentCategory=query.category??''}:Pick<ReaderPageData,'categories'|'query'>&{currentCategory?:string|null}){
  const rank=(name:string)=>{const index=ARTICLE_NAVIGATION.categoryOrder.indexOf(name);return index<0?ARTICLE_NAVIGATION.categoryOrder.length:index;};
  const ordered=[...categories].sort((a,b)=>rank(a.name)-rank(b.name));
  return <nav aria-label="文章类别" className="flex flex-col gap-0.5">
    {[{id:'',name:'全部类别'},...ordered].map(c=><Link key={c.id} to={readerLink(query,{category:c.id})} aria-current={currentCategory===c.id?'page':undefined} className={navLink}>{c.name}</Link>)}
  </nav>;
}

export function ReaderNavigation({categories,topics,query}:Pick<ReaderPageData,'categories'|'topics'|'query'>){
  const selected=topics.find(t=>t.slug===query.topic);
  const shortcuts=ARTICLE_NAVIGATION.topicShortcuts.flatMap(slug=>topics.filter(t=>t.slug===slug));
  const primary=[...shortcuts,...topics.filter(t=>!shortcuts.includes(t))].slice(0,5);
  const container=useRef<HTMLDivElement>(null),measure=useRef<HTMLDivElement>(null),[visibleCount,setVisibleCount]=useState(0);
  const labels=primary.map(t=>t.name).join('\0');
  useLayoutEffect(()=>{
    const update=()=>{
      const widths=Array.from(measure.current!.children,child=>child.getBoundingClientRect().width);
      // Reserve room for the overflow entry, including a selected long topic name.
      let used=(widths[0]??0)+180,count=0;
      for(const width of widths.slice(1)){if(used+20+width>container.current!.clientWidth)break;used+=20+width;count++;}
      setVisibleCount(count);
    };
    const observer=new ResizeObserver(update);observer.observe(container.current!);observer.observe(measure.current!);update();return()=>observer.disconnect();
  },[labels]);
  const visible=primary.slice(0,visibleCount),extraSelected=selected&&!visible.includes(selected);
  const topicLinks=<nav aria-label="全部技术主题" className="grid grid-cols-2 gap-1">
    <Link className={navLink} to={readerLink(query,{topic:null})} aria-current={!query.topic?'page':undefined}>全部主题</Link>
    {topics.map(t=><Link key={t.slug} className={navLink} to={readerLink(query,{topic:t.slug})} aria-current={query.topic===t.slug?'page':undefined}>{t.name}</Link>)}
  </nav>;
  const tab="flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 border-transparent py-2 text-[13px] text-ink-3 hover:text-accent aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent";
  return <div ref={container} className="reader-navigation relative mt-5 grid grid-cols-2 gap-4 border-b border-line lg:flex lg:gap-5">
    <div ref={measure} aria-hidden="true" className="pointer-events-none invisible absolute flex w-full gap-5 overflow-hidden font-semibold"><span className={tab}>全部主题</span>{primary.map(t=><span key={t.slug} className={tab}>{t.name}</span>)}</div>
    <ReaderPopover label={`类别：${categories.find(c=>c.id===query.category)?.name??'全部类别'}`} className="min-w-0 lg:hidden" panelClassName="reader-mobile-options"><CategoryNavigation {...{categories,query}}/></ReaderPopover>
    <nav aria-label="文章主题" className="-mb-px hidden min-w-0 gap-5 lg:flex">
      <Link className={tab} to={readerLink(query,{topic:null})} aria-current={!query.topic?'page':undefined}>全部主题</Link>
      {visible.map(t=><Link key={t.slug} className={tab} to={readerLink(query,{topic:t.slug})} aria-current={query.topic===t.slug?'page':undefined}>{t.name}</Link>)}
    </nav>
    <ReaderPopover label={<><span className="lg:hidden">主题：{selected?.name??'全部主题'}</span><span className="hidden max-w-40 truncate lg:block">{extraSelected?selected.name:'更多主题'}</span></>}
      className="min-w-0 lg:relative lg:shrink-0" panelClassName="reader-mobile-options reader-topic-options" active={!!extraSelected}>
      {topicLinks}
    </ReaderPopover>
  </div>;
}
