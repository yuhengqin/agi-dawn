import {useEffectEvent,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {annotationColors,type Passage,type PassageAnnotation} from '../contracts.ts';
import {indexPassages,paintRanges,passageRanges,selectedPassage} from './passage-text.ts';
import {revealRangeHorizontally} from '../../../apps/web/app/lib/reading-position.ts';

export interface PassagePick {passage:Passage; ranges:Range[]; pinned:boolean; mark?:PassageAnnotation}

export function usePassageSelection(body:RefObject<HTMLDivElement|null>,bodyKey:string,marks:PassageAnnotation[],locked:boolean){
  const [pick,setPick]=useState<PassagePick|null>(null);
  const [linkMessage,setLinkMessage]=useState('');
  const [noteAnchors,setNoteAnchors]=useState<Array<{id:string;host:Element}>>([]);
  const toolbar=useRef<HTMLDivElement>(null);
  const index=useRef<ReturnType<typeof indexPassages>|null>(null);
  const painted=useRef<Array<{mark:PassageAnnotation;ranges:Range[]}>>([]);
  const readIndex=()=>index.current??=indexPassages(body.current!);
  const clear=()=>{
    const selection=document.getSelection();
    if(selection?.rangeCount&&body.current?.contains(selection.getRangeAt(0).commonAncestorContainer))selection.removeAllRanges();
    setPick(null);
  };
  const paint=useEffectEvent(()=>{
    painted.current=marks.filter(mark=>mark.bodyKey===bodyKey).map(mark=>({mark,ranges:passageRanges(readIndex(),mark.start,mark.end,mark.quote)}));
    const anchors=painted.current.flatMap(({mark,ranges})=>{
      if(!mark.note)return [];
      const end=ranges.at(-1)?.endContainer.parentElement;
      const host=end?.closest('.code-block')?.querySelector('.code-block-actions')??end?.closest('p,li,dd,dt,td,th,figcaption,blockquote,h1,h2,h3,h4,h5,h6');
      return host?[{id:mark.id,host}]:[];
    });
    setNoteAnchors(previous=>previous.length===anchors.length&&anchors.every((a,i)=>a.id===previous[i]!.id&&a.host===previous[i]!.host)?previous:anchors);
    for(const color of annotationColors){
      paintRanges('passage-'+color,painted.current.filter(entry=>entry.mark.color===color).flatMap(entry=>entry.ranges));
    }
  });
  const shared=useEffectEvent((scroll:boolean)=>{
    const match=/^#passage-([0-9a-f]{64})-(\d{1,10})-(\d{1,10})$/.exec(location.hash);
    const ranges=match&&match[1]===bodyKey?passageRanges(readIndex(),Number(match[2]),Number(match[3])):[];
    paintRanges('passage-shared',ranges);
    setLinkMessage(match&&!ranges.length?'正文已更新或选段已折叠，暂时无法定位这段摘录。':'');
    if(scroll&&ranges[0]){
      revealRangeHorizontally(ranges[0],body.current);
      const top=ranges[0].getBoundingClientRect().top;
      window.scrollBy({top:top-innerHeight/3,behavior:'instant'});
    }
  });
  const readSelection=useEffectEvent(()=>{
    if(locked||!body.current||toolbar.current?.contains(document.activeElement))return;
    const selection=document.getSelection();
    const range=selection?.rangeCount?selection.getRangeAt(0):null;
    if(!range||range.collapsed||!body.current.contains(range.commonAncestorContainer)){
      setPick(previous=>previous?.pinned?previous:null);return;
    }
    const passage=selectedPassage(body.current,readIndex(),range);
    if(!passage){setPick(null);return;}
    const mark=marks.find(m=>m.bodyKey===bodyKey&&m.start===passage.start&&m.end===passage.end&&m.quote===passage.quote);
    setPick({passage,ranges:[range.cloneRange()],pinned:false,mark});
  });
  const press=useEffectEvent((event:KeyboardEvent)=>{
    if(locked||!pick)return;
    if(event.key==='Escape'){
      event.preventDefault();if(toolbar.current?.contains(document.activeElement))body.current?.focus({preventScroll:true});clear();
    }else if(event.key==='Tab'&&!event.shiftKey&&!toolbar.current?.contains(document.activeElement)){
      const button=toolbar.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if(button){event.preventDefault();button.focus({preventScroll:true});}
    }
  });
  const markClick=useEffectEvent((event:MouseEvent)=>{
    if(locked||event.button||!document.getSelection()?.isCollapsed||!(event.target instanceof Element)||event.target.closest('a,button,[role="button"]'))return;
    const hit=painted.current.find(({ranges})=>ranges.some(range=>[...range.getClientRects()].some(box=>
      event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)));
    if(hit)setPick({passage:hit.mark,mark:hit.mark,ranges:hit.ranges,pinned:true});
  });
  useLayoutEffect(()=>{
    const root=body.current;
    if(!root)return;
    let dragging=false;
    const change=()=>{if(!dragging)readSelection();};
    const down=(event:PointerEvent)=>{
      if(!(event.target instanceof Element)||event.target.closest('dialog')||toolbar.current?.contains(event.target))return;
      dragging=root.contains(event.target);setPick(null);
    };
    const up=()=>{if(dragging){dragging=false;readSelection();}};
    const locate=()=>shared(true);
    const observer=new MutationObserver(()=>{index.current=null;paint();shared(false);change();});
    observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
    locate();change();
    document.addEventListener('selectionchange',change);document.addEventListener('pointerdown',down);
    document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);
    document.addEventListener('keydown',press);root.addEventListener('click',markClick);window.addEventListener('hashchange',locate);
    return ()=>{
      observer.disconnect();index.current=null;document.removeEventListener('selectionchange',change);document.removeEventListener('pointerdown',down);
      document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);
      document.removeEventListener('keydown',press);root.removeEventListener('click',markClick);window.removeEventListener('hashchange',locate);
      CSS.highlights?.delete('passage-shared');
    };
  },[body,bodyKey]);
  useLayoutEffect(()=>{
    if(body.current)paint();
    return ()=>{painted.current=[];for(const color of annotationColors)CSS.highlights?.delete('passage-'+color);};
  },[body,bodyKey,marks]);
  return {pick,clear,toolbar,linkMessage,noteAnchors};
}

/** Follow the selected line while scrolling, including inside a wide code block. */
export function usePassageToolbar(toolbar:RefObject<HTMLDivElement|null>,pick:PassagePick|null,visible:boolean){
  useLayoutEffect(()=>{
    const bar=toolbar.current;
    if(!bar||!pick||!visible)return;
    const position=()=>{
      const line=pick.ranges.flatMap(range=>[...range.getClientRects()]).find(box=>
        box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth);
      if(!line){bar.style.visibility='hidden';return;}
      bar.style.visibility='visible';
      const {width,height}=bar.getBoundingClientRect();
      bar.style.left=Math.max(8,Math.min(innerWidth-width-8,line.left+(line.width-width)/2))+'px';
      bar.style.top=Math.max(8,Math.min(innerHeight-height-8,line.top>=height+12?line.top-height-8:line.bottom+8))+'px';
    };
    position();
    const observer=new ResizeObserver(position);observer.observe(bar);
    window.addEventListener('scroll',position,true);window.addEventListener('resize',position);
    return ()=>{observer.disconnect();window.removeEventListener('scroll',position,true);window.removeEventListener('resize',position);};
  },[toolbar,pick,visible]);
}
