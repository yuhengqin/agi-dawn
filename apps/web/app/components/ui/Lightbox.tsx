import { useEffect,useLayoutEffect,useRef,useState,type RefObject } from "react";
import { createPortal } from "react-dom";
import { createImageZoom } from "./image-zoom";
import { useModal } from "./modal";
import { IconArrowLeft, IconArrowRight, IconClose } from "../icons";

export interface LightboxImage {
  src: string;
  alt?: string | null;
  caption?: string | null;
  source: HTMLImageElement;
}

/**
 * Pictures shown full size over the page. While open, keyboard focus stays in the viewer (Tab moves
 * between its buttons), the page behind does not scroll, Escape closes it and the arrow keys move
 * between pictures; closing puts focus back where it was. On touch screens a picture follows the finger:
 * sideways to the next or previous one, down to close; two fingers zoom as the browser does.
 */
export function Lightbox({ images, index, onIndex, onClose, returnFocus }: { images: LightboxImage[]; index: number | null; onIndex: (i: number) => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const open = index !== null && !!images[index];
  const current = open ? images[index!]! : null;
  const many = images.length > 1;
  const fallbackOpener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) fallbackOpener.current = current?.source ?? null;
  wasOpen.current = open;
  const [phase,setPhase]=useState<'opening'|'open'|'closing'>('opening');
  const motion=useRef<ReturnType<typeof createImageZoom>|null>(null),layer=useRef<HTMLDivElement>(null),closing=useRef(false),generation=useRef(0);
  const [zoom,setZoom]=useState<number|null>(null),[dimensions,setDimensions]=useState({width:0,height:0}),[viewport,setViewport]=useState({width:0,height:0});
  const stage=useRef<HTMLDivElement>(null),img=useRef<HTMLImageElement>(null),backdrop=useRef<HTMLDivElement>(null),pan=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const center=useRef<{x:number;y:number}|null>(null);
  const clickTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const clearClickTimer=()=>{if(clickTimer.current!==null){clearTimeout(clickTimer.current);clickTimer.current=null;}};
  const fit=dimensions.width&&viewport.width?Math.min(1,viewport.width/dimensions.width,viewport.height/dimensions.height):0;
  const scale=zoom===null?fit:Math.max(fit,zoom),enlarged=scale>fit+0.001;
  useLayoutEffect(()=>{
    clearClickTimer();
    setZoom(null);center.current=null;pan.current=null;
    const picture=img.current;
    // A repeated source or a quick reopen can reuse an already-loaded image without another load event.
    setDimensions(open&&picture?.complete?{width:picture.naturalWidth,height:picture.naturalHeight}:{width:0,height:0});
    if(stage.current){stage.current.scrollTop=0;stage.current.scrollLeft=0;}
  },[index,open]);
  useLayoutEffect(()=>{
    const box=stage.current;if(!open||!box)return;
    const measure=()=>{
      const style=getComputedStyle(box);
      setViewport({
        width:Math.max(0,box.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0)),
        height:Math.max(0,box.clientHeight-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0)),
      });
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(box);return()=>observer.disconnect();
  },[open,many]);
  useLayoutEffect(()=>{
    const point=center.current,box=stage.current,picture=img.current;if(!point||!box||!picture)return;
    const outer=box.getBoundingClientRect(),inner=picture.getBoundingClientRect();
    box.scrollLeft+=inner.left-outer.left+point.x*inner.width-box.clientWidth/2;
    box.scrollTop+=inner.top-outer.top+point.y*inner.height-box.clientHeight/2;
    center.current=null;
  },[scale,zoom]);
  const resize=(next:number|null)=>{
    clearClickTimer();
    const box=stage.current,picture=img.current;if(!box||!picture||!fit)return;
    const outer=box.getBoundingClientRect(),inner=picture.getBoundingClientRect();
    center.current={x:(outer.left+box.clientWidth/2-inner.left)/inner.width,y:(outer.top+box.clientHeight/2-inner.top)/inner.height};
    setZoom(next===null?null:Math.max(fit,Math.min(4,next)));
  };
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const state = useRef({ index, count: images.length, onIndex, onClose });
  state.current = { index, count: images.length, onIndex, onClose };
  const close=()=>{
    clearClickTimer();
    if(!open||closing.current)return;
    closing.current=true;pan.current=null;
    closeButton.current?.focus({preventScroll:true});
    setPhase('closing');
    const at=generation.current;
    const finished=img.current?motion.current?.close(images[index!]!.source,img.current):undefined;
    void Promise.resolve(finished).finally(()=>{if(generation.current===at)state.current.onClose();});
  };
  useLayoutEffect(()=>{if(open){closing.current=false;setPhase('opening');}},[open]);
  useEffect(()=>clearClickTimer,[]);

  const wheelState=useRef({phase,fit,scale,enlarged,resize});
  wheelState.current={phase,fit,scale,enlarged,resize};
  useEffect(()=>{
    const box=stage.current;if(!open||!box)return;
    const onWheel=(event:WheelEvent)=>{
      const currentState=wheelState.current;
      if(currentState.phase!=='open'||!currentState.fit||event.deltaY===0)return;
      if(!event.ctrlKey&&!event.metaKey&&Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
      event.preventDefault();
      if(event.deltaY<0){
        if(currentState.scale<4)currentState.resize(currentState.scale*1.25);
      }else if(currentState.enlarged){
        currentState.resize(currentState.scale/1.25<=currentState.fit+0.001?null:currentState.scale/1.25);
      }
    };
    box.addEventListener('wheel',onWheel,{passive:false});
    return()=>box.removeEventListener('wheel',onWheel);
  },[open]);

  useModal({
    open,
    panel: dialog,
    initialFocus: closeButton,
    returnFocus: returnFocus ?? fallbackOpener,
    onClose:close,
    onKeyDown: (e) => {
      if(phase!=='open')return;
      if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
        if(e.key==='+'||e.key==='='){e.preventDefault();if(fit)resize(Math.min(4,scale*1.25));return;}
        if(e.key==='-'||e.key==='_'){e.preventDefault();if(enlarged)resize(scale/1.25<=fit+0.001?null:scale/1.25);return;}
        if(e.key==='0'){e.preventDefault();resize(null);return;}
      }
      if(enlarged)return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const { index: at, count, onIndex: go } = state.current;
      if (at !== null && count > 1) go((at + (e.key === "ArrowRight" ? 1 : -1) + count) % count);
      e.preventDefault();
    },
  });
  useEffect(()=>{
    if(!open)return;
    const picture=img.current!,origin=images[index!]!.source;
    let stopped=false;
    const start=()=>{
      if(stopped||closing.current)return;
      motion.current=createImageZoom(origin,picture,stage.current!,layer.current!,()=>{if(!stopped&&!closing.current)setPhase('open');});
    };
    if(picture.complete&&picture.naturalWidth)start();else void picture.decode().then(start,()=>{if(!stopped)setPhase('open');});
    return()=>{stopped=true;generation.current++;motion.current?.dispose();motion.current=null;};
  },[open]);

  // Touch: follow one finger, then step, close or snap back. A drag is not also a tap that closes.
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; axis: "x" | "y" | null; moved: boolean } | null>(null);
  const suppressTap = useRef(false);
  const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.01;
  const place = (dx: number, dy: number, animate: boolean) => {
    const el = img.current;
    const shade = backdrop.current;
    if (!el || !shade) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
    shade.style.backgroundColor = dy > 0 ? `rgba(0, 0, 0, ${Math.max(0.3, 0.85 - dy / 600)})` : "";
  };
  const cancelDrag = () => {
    suppressTap.current = true;
    drag.current = null;
    place(0, 0, true);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || zoomed()) return cancelDrag();
    suppressTap.current = false;
    drag.current = e.target instanceof Element && e.target.closest("button") ? null : { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, dx: 0, dy: 0, axis: null, moved: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || zoomed()) return cancelDrag();
    const d = drag.current;
    if (!d) return;
    d.dx = e.touches[0]!.clientX - d.x;
    d.dy = e.touches[0]!.clientY - d.y;
    if (!d.axis && Math.hypot(d.dx, d.dy) > 8) d.axis = Math.abs(d.dx) > Math.abs(d.dy) ? "x" : "y";
    if (!d.axis) return;
    d.moved = true;
    if (d.axis === "x" && images.length > 1) place(d.dx, 0, false);
    else if (d.axis === "y") place(0, Math.max(0, d.dy), false);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length || zoomed()) return cancelDrag();
    const d = drag.current;
    if (!d?.moved) return;
    suppressTap.current = true;
    drag.current = null;
    const { index: at, count, onIndex: go } = state.current;
    if (d.axis === "x" && count > 1 && at !== null && Math.abs(d.dx) > 60) {
      place(0, 0, false);
      go((at + (d.dx < 0 ? 1 : -1) + count) % count);
    } else if (d.axis === "y" && d.dy > 110) {
      close();
    } else {
      place(0, 0, true);
    }
  };
  const tappedAfterDrag = () => {
    const moved = suppressTap.current;
    suppressTap.current = false;
    drag.current = null;
    return moved;
  };

  const nav = "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/25 backdrop-blur-sm shadow-lg transition-colors hover:bg-black/85";
  if (typeof document === "undefined"||!open) return null;
  return createPortal(
      <div
        ref={dialog}
        data-phase={phase}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={many && index !== null ? `图片 ${index + 1} / ${images.length}` : "图片"}
        onClick={() => {
          if (!tappedAfterDrag()) close();
        }}
        // Closing is coordinated on keydown; the library's keyup must not interrupt the prepared return frame.
        onKeyUp={event=>{if(event.key==='Escape')event.stopPropagation();}}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={cancelDrag}
        className={`lightbox fixed inset-0 z-[80] grid cursor-zoom-out touch-pinch-zoom place-items-center ${many ? "py-4 px-14 sm:py-10 sm:px-16" : "p-4 sm:p-10"}`}
      >
        <div ref={backdrop} className="lightbox-backdrop absolute inset-0 bg-black/85" />
        <div ref={stage} role="region" aria-label="可滚动图片" tabIndex={enlarged?0:-1} className={`lightbox-stage${enlarged?' is-enlarged':''}`}
          onClick={event=>{
            if(enlarged){event.stopPropagation();tappedAfterDrag();return;}
            if(event.target===img.current){
              event.stopPropagation();
              if(tappedAfterDrag())return;
              if(event.detail>1){clearClickTimer();return;}
              clearClickTimer();
              clickTimer.current=setTimeout(()=>{clickTimer.current=null;close();},240);
            }
          }}
          onDoubleClick={event=>{
            event.stopPropagation();clearClickTimer();
            if(phase!=='open'||!fit)return;
            if(enlarged)resize(null);else resize(fit<0.9?1:Math.min(4,fit*1.5));
          }}
          onPointerDown={event=>{if(phase!=='open'||!enlarged||event.pointerType!=='mouse'||event.button!==0)return;const box=event.currentTarget;pan.current={x:event.clientX,y:event.clientY,left:box.scrollLeft,top:box.scrollTop};box.setPointerCapture(event.pointerId);event.preventDefault();}}
          onPointerMove={event=>{const held=pan.current;if(!held)return;const dx=event.clientX-held.x,dy=event.clientY-held.y;if(Math.hypot(dx,dy)>3)suppressTap.current=true;event.currentTarget.scrollLeft=held.left-dx;event.currentTarget.scrollTop=held.top-dy;}}
          onPointerUp={event=>{pan.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
          onPointerCancel={()=>{pan.current=null;}}>
          {current&&<img ref={img} key={current.src} src={current.src} decoding="async" alt={current.alt??''} draggable={false} data-reader-image-surface={current.source.dataset.readerImageSurface}
            onLoad={event=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}
            style={scale?{width:dimensions.width*scale,height:dimensions.height*scale,maxWidth:'none',maxHeight:'none'}:undefined}
            className="lightbox-img rounded-control object-contain shadow-2xl"/>}
        </div>
        <div ref={layer} className="lightbox-transition-layer pointer-events-none fixed inset-0" aria-hidden="true" />
        <div className="lightbox-tools absolute left-5 top-5 flex gap-1 rounded-control bg-black/60 p-1 text-sm text-white ring-1 ring-white/15 backdrop-blur-sm" onClick={event=>event.stopPropagation()}>
          <button type="button" className="min-h-11 rounded-mark px-3 hover:bg-white/10 aria-pressed:bg-white/25 aria-pressed:font-semibold" aria-pressed={zoom===null} disabled={phase!=='open'} onClick={()=>resize(null)}>适应窗口</button>
          <button type="button" className="min-h-11 rounded-mark px-3 hover:bg-white/10 aria-pressed:bg-white/25 aria-pressed:font-semibold" aria-pressed={zoom!==null&&Math.abs(scale-1)<0.005} disabled={phase!=='open'||!fit} onClick={()=>resize(1)}>原尺寸</button>
          <button type="button" className="min-h-11 rounded-mark px-3 hover:bg-white/10 disabled:opacity-40" aria-label="缩小图片" disabled={phase!=='open'||!enlarged} onClick={()=>resize(scale/1.25<=fit+0.001?null:scale/1.25)}>－</button>
          <span role="status" aria-label="图片缩放比例" className="grid min-w-12 place-items-center tabular-nums">{fit?`${Math.round(scale*100)}%`:'—'}</span>
          <button type="button" className="min-h-11 rounded-mark px-3 hover:bg-white/10 disabled:opacity-40" aria-label="放大图片" disabled={phase!=='open'||!fit||scale>=4} onClick={()=>resize(scale*1.25)}>＋</button>
        </div>
        <button ref={closeButton} type="button" aria-label="关闭" onClick={(e) => { e.stopPropagation(); close(); }} className="lightbox-tools absolute right-[max(16px,env(safe-area-inset-right))] top-[max(16px,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur-sm shadow-lg transition-colors hover:bg-black/80">
          <IconClose size={18} />
        </button>
        {many && index !== null && (
          <>
            <button type="button" aria-label="上一张" disabled={phase!=='open'} onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }} className={`${nav} lightbox-tools left-[max(12px,env(safe-area-inset-left))] sm:left-5`}>
              <IconArrowLeft size={18} />
            </button>
            <button type="button" aria-label="下一张" disabled={phase!=='open'} onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }} className={`${nav} lightbox-tools right-[max(12px,env(safe-area-inset-right))] sm:right-5`}>
              <IconArrowRight size={18} />
            </button>
          </>
        )}
        {(current?.caption || (many && index !== null)) && (
          <div className="lightbox-footer lightbox-tools pointer-events-none absolute inset-x-4 bottom-4 flex flex-col items-center gap-1.5">
            {current?.caption && (
              <p className="lightbox-caption line-clamp-2 max-w-2xl rounded-control bg-black/65 px-3.5 py-1.5 text-center text-[13px] leading-snug text-white/95 ring-1 ring-white/15 backdrop-blur-sm shadow-lg">
                {current.caption}
              </p>
            )}
            {many && index !== null && (
              <span className="num rounded-full bg-black/65 px-2.5 py-0.5 text-[12px] text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                {index + 1} / {images.length}
              </span>
            )}
          </div>
        )}
      </div>, document.body
  );
}
