import {useEffect,useLayoutEffect,useRef,useState,type MouseEvent} from 'react';
import type {OutlineEntry} from '@agidawn/contracts/site';
import {IconChevronDown} from '../../components/icons';
import {RailSection,useContainedScroll} from '../../components/ui/Page';
import {useCurrentSection} from '../../lib/motion';
import {READING_DISPLAY_CHANGE_EVENT} from '../../lib/local-state';
import {captureReadingPoint,restoreReadingPoint,type ReadingPoint} from '../../lib/reading-position';

export function useArticleReading(outline:OutlineEntry[],html:string|null,focus:boolean){
  const scope=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLDivElement>(null);
  const [progress,setProgress]=useState(0),[current,go]=useCurrentSection(outline.map(entry=>entry.id),!!html);
  const held=useRef<{point:ReadingPoint;bySection:boolean}|null>(null);
  const ids=useRef(outline.map(entry=>entry.id));ids.current=outline.map(entry=>entry.id);
  const stop=()=>{held.current=null;};
  const preserve=()=>{
    const root=body.current,point=root&&captureReadingPoint(root,ids.current);
    held.current=point?{point,bySection:!!ids.current.length}:null;
  };
  const adjust=()=>{if(body.current&&held.current)restoreReadingPoint(body.current,ids.current,held.current.point,held.current.bySection);};
  const measure=()=>scope.current?.style.setProperty('--article-toolbar-h',(toolbar.current?.getBoundingClientRect().height??0)+'px');
  useLayoutEffect(()=>{measure();adjust();},[html,focus]);
  useLayoutEffect(()=>{
    if(!body.current||!scope.current)return;
    const root=body.current,bar=toolbar.current,container=scope.current;
    let frame=0,layoutChanged=true;
    const update=()=>{
      frame=0;
      measure();
      if(layoutChanged){layoutChanged=false;adjust();}
      const box=root.getBoundingClientRect(),offset=parseFloat(getComputedStyle(root).scrollMarginTop)||0;
      const distance=box.height-window.innerHeight+offset;
      const value=distance>0?Math.min(1,Math.max(0,(offset-box.top)/distance)):(box.bottom<=window.innerHeight?1:0);
      container.style.setProperty('--article-progress',String(value));setProgress(Math.round(value*100));
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const layout=()=>{layoutChanged=true;schedule();};
    const display=()=>{const point=captureReadingPoint(root,ids.current);held.current=point?{point,bySection:!!ids.current.length}:null;layout();};
    const keydown=(event:KeyboardEvent)=>{if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable]'))return;if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))stop();};
    const pointer=(event:PointerEvent)=>{if(!(event.target instanceof Element&&container.contains(event.target)&&event.target.closest('[data-reading-controls]')))stop();};
    const observer=new ResizeObserver(layout);observer.observe(root);if(bar)observer.observe(bar);update();
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',layout);
    window.addEventListener(READING_DISPLAY_CHANGE_EVENT,display);window.addEventListener('wheel',stop,{passive:true});window.addEventListener('touchmove',stop,{passive:true});window.addEventListener('keydown',keydown);window.addEventListener('pointerdown',pointer);window.addEventListener('popstate',stop);
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',layout);window.removeEventListener(READING_DISPLAY_CHANGE_EVENT,display);window.removeEventListener('wheel',stop);window.removeEventListener('touchmove',stop);window.removeEventListener('keydown',keydown);window.removeEventListener('pointerdown',pointer);window.removeEventListener('popstate',stop);};
  },[!!html]);
  const navigate=(id:string)=>{stop();go(id);const target=document.getElementById(id);target?.setAttribute('tabindex','-1');target?.focus({preventScroll:true});};
  return {scope,body,toolbar,current,progress,preserve,navigate,stop};
}

type OutlineProps={outline:OutlineEntry[];current:string|null;navigate:(id:string)=>void};
function OutlineLinks({outline,current,navigate}:OutlineProps){
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const ancestors:string[][]=[];
  const stack:OutlineEntry[]=[];
  for(const entry of outline){while(stack.length&&stack.at(-1)!.level>=entry.level)stack.pop();ancestors.push(stack.map(parent=>parent.id));stack.push(entry);}
  const currentIndex=outline.findIndex(entry=>entry.id===current),activeParents=currentIndex<0?[]:ancestors[currentIndex]!;
  const open=(id:string)=>id===current||activeParents.includes(id)||!!expanded[id];
  const click=(event:MouseEvent<HTMLAnchorElement>,id:string)=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(id);};
  return <ol className="article-outline-list">{outline.map((entry,index)=>{
    const children=(outline[index+1]?.level??0)>entry.level,active=entry.id===current;
    return <li key={entry.id} hidden={ancestors[index]!.some(id=>!open(id))} style={{paddingInlineStart:ancestors[index]!.length*12}}>
      <a href={'#'+entry.id} aria-current={active?'location':undefined} onClick={event=>click(event,entry.id)}>{entry.text}</a>
      {children&&<button type="button" aria-expanded={open(entry.id)} aria-label={`${open(entry.id)?'收起':'展开'}：${entry.text}`} disabled={entry.id===current||activeParents.includes(entry.id)} onClick={()=>setExpanded(value=>({...value,[entry.id]:!open(entry.id)}))}><IconChevronDown size={14}/></button>}
    </li>;
  })}</ol>;
}

export function ArticleOutline(props:OutlineProps&{progress:number}){
  const [nav,overscroll]=useContainedScroll<HTMLElement>();
  useEffect(()=>{
    const box=nav.current,active=box?.querySelector<HTMLElement>('[aria-current="location"]');if(!box||!active)return;
    const outer=box.getBoundingClientRect(),inner=active.getBoundingClientRect();
    if(inner.top<outer.top)box.scrollTop-=outer.top-inner.top;else if(inner.bottom>outer.bottom)box.scrollTop+=inner.bottom-outer.bottom;
  },[props.current]);
  return <RailSection title={<span className="flex justify-between gap-3"><span>本文目录</span><span className="font-normal tabular-nums" aria-hidden="true">{props.progress}%</span></span>} shrink>
    <nav ref={nav} aria-label="本文目录" tabIndex={overscroll?0:undefined} className={`article-outline scrollbar-thin overflow-y-auto ${overscroll}`}
      onKeyDown={event=>{const box=event.currentTarget;if(box.scrollHeight<=box.clientHeight||event.altKey||event.ctrlKey||event.metaKey)return;
        const up=['ArrowUp','PageUp','Home'].includes(event.key)||(event.key===' '&&event.shiftKey),down=['ArrowDown','PageDown','End'].includes(event.key)||(event.key===' '&&!event.shiftKey);
        if((up&&box.scrollTop<=0)||(down&&box.scrollTop+box.clientHeight>=box.scrollHeight-1))event.preventDefault();}}><OutlineLinks {...props}/></nav>
  </RailSection>;
}

export function MobileArticleOutline(props:OutlineProps&{progress:number}){
  const details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(details.current&&!details.current.contains(event.target as Node))details.current.open=false;};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&details.current?.open){details.current.open=false;details.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  return <details ref={details} className="article-mobile-outline lg:hidden" onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}}>
    <summary aria-label="展开文章目录" className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px]"><span className="shrink-0 font-medium">本文目录</span><span className="min-w-0 flex-1 truncate text-ink-3">{props.outline.find(entry=>entry.id===props.current)?.text??'文章开头'}</span><span className="tabular-nums text-ink-3" aria-hidden="true">{props.progress}%</span><IconChevronDown size={14}/></summary>
    <nav aria-label="手机文章目录" className="article-mobile-outline-panel scrollbar-thin"><OutlineLinks {...props} navigate={id=>{if(details.current)details.current.open=false;props.navigate(id);}}/></nav>
  </details>;
}

export function ArticleProgress({progress}:{progress:number}){
  return <div className="article-progress" role="progressbar" aria-label="正文阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div/></div>;
}
