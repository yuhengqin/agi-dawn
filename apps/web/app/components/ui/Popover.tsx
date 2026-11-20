import {useEffect,useRef,type ReactNode,type Ref} from "react";
import {useLocation} from "react-router";
import {IconChevronDown} from "../icons";

/** Native disclosure remains usable without JS; the panel overlays the list. */
export function ReaderPopover({label,triggerLabel,triggerRef,children,className='',panelClassName='',active=false,onOpen,fitHeight=false,closeOnPageScroll=false}:{label:ReactNode;triggerLabel?:string;triggerRef?:Ref<HTMLElement>;children:ReactNode|((close:()=>void)=>ReactNode);className?:string;panelClassName?:string;active?:boolean;onOpen?:()=>void;fitHeight?:boolean;closeOnPageScroll?:boolean}){
  const ref=useRef<HTMLDetailsElement>(null),location=useLocation();
  const close=()=>{if(ref.current){ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
  const fitPanel=()=>{
    if(!ref.current?.open)return;
    const panel=ref.current.querySelector<HTMLElement>('.reader-popover-panel')!;
    if(fitHeight){panel.style.top='';panel.style.bottom='';panel.style.maxHeight='';}
    panel.style.translate='none';const bounds=panel.getBoundingClientRect();
    const shift=Math.max(12-bounds.left,Math.min(0,window.innerWidth-12-bounds.right));
    panel.style.translate=`${shift}px 0`;
    const style=fitHeight?getComputedStyle(panel):null;
    if(style?.position==='absolute'){
      const below=window.innerHeight-bounds.top-12;
      const above=ref.current.getBoundingClientRect().top-16;
      const flip=bounds.height>below&&above>below;
      if(flip){panel.style.top='auto';panel.style.bottom='calc(100% + 4px)';}
      const available=`${Math.max(0,flip?above:below)}px`;
      panel.style.maxHeight=style.maxHeight==='none'?available:`min(${style.maxHeight}, ${available})`;
    }
  };
  useEffect(()=>{if(ref.current)ref.current.open=false;},[location.key]);
  useEffect(()=>{
    const details=ref.current!;
    const outside=(event:PointerEvent)=>{if(!details.contains(event.target as Node))details.open=false;};
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&details.open){event.preventDefault();event.stopPropagation();details.open=false;details.querySelector('summary')?.focus();}
    };
    const dismiss=()=>{if(details.open){const restore=details.contains(document.activeElement);details.open=false;if(restore)details.querySelector('summary')?.focus({preventScroll:true});}};
    const scroll=()=>{if(!details.querySelector('.reader-popover-panel')?.contains(document.activeElement))dismiss();};
    const wheel=(event:WheelEvent)=>{if(!details.contains(event.target as Node))dismiss();};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',fitPanel);
    if(closeOnPageScroll){window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('wheel',wheel,{passive:true});}
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',fitPanel);window.removeEventListener('scroll',scroll);window.removeEventListener('wheel',wheel);};
  },[fitHeight,closeOnPageScroll]);
  return <details ref={ref} name="reader-picker" className={`reader-popover ${className}`}
    onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}}>
    <summary ref={triggerRef} aria-label={triggerLabel} title={triggerLabel} className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 text-[13px] ${active?'text-accent':'text-ink-3'} hover:text-accent`} onClick={event=>{
      event.preventDefault();const details=ref.current!,opening=!details.open;
      if(opening)onOpen?.();details.open=opening;if(opening)fitPanel();
    }}
      onKeyDown={event=>{
        // WebKit can keep Tab on the summary after reopening an absolute overlay.
        // Enter its first control explicitly; subsequent controls keep native Tab order.
        if(event.key==='Tab'&&!event.shiftKey&&ref.current?.open){
          const first=Array.from(ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled])')).find(el=>el.getClientRects().length>0);
          if(first){event.preventDefault();first.focus();}
        }
      }}>
      <span>{label}</span><IconChevronDown size={16}/>
    </summary>
    <div className={`reader-popover-panel ${panelClassName}`} onClick={event=>{if((event.target as Element).closest('a'))ref.current!.open=false;}}>{typeof children==='function'?children(close):children}</div>
  </details>;
}
