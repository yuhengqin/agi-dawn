import { useEffect,useLayoutEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";
import { createImageZoom } from "./image-zoom";
import { useModal } from "./modal";
import { IconArrowLeft, IconArrowRight, IconClose } from "../icons";

export interface LightboxImage {
  src: string;
  alt?: string | null;
  source: HTMLImageElement;
}

/**
 * Pictures shown full size over the page. While open, keyboard focus stays in the viewer (Tab moves
 * between its buttons), the page behind does not scroll, Escape closes it and the arrow keys move
 * between pictures; closing puts focus back where it was. On touch screens a picture follows the finger:
 * sideways to the next or previous one, down to close; two fingers zoom as the browser does.
 */
export function Lightbox({ images, index, onIndex, onClose }: { images: LightboxImage[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const open = index !== null && !!images[index];
  const [phase,setPhase]=useState<'opening'|'open'|'closing'>('opening');
  const motion=useRef<ReturnType<typeof createImageZoom>|null>(null),layer=useRef<HTMLDivElement>(null),closing=useRef(false),generation=useRef(0);
  const [zoom,setZoom]=useState<number|null>(null),[dimensions,setDimensions]=useState({width:0,height:0}),[viewport,setViewport]=useState({width:0,height:0});
  const stage=useRef<HTMLDivElement>(null),img=useRef<HTMLImageElement>(null),backdrop=useRef<HTMLDivElement>(null),pan=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const center=useRef<{x:number;y:number}|null>(null);
  const fit=dimensions.width&&viewport.width?Math.min(1,viewport.width/dimensions.width,viewport.height/dimensions.height):0;
  const scale=zoom===null?fit:Math.max(fit,zoom),enlarged=scale>fit+0.001;
  useLayoutEffect(()=>{
    setZoom(null);center.current=null;pan.current=null;
    const picture=img.current;
    // A repeated source or a quick reopen can reuse an already-loaded image without another load event.
    setDimensions(open&&picture?.complete?{width:picture.naturalWidth,height:picture.naturalHeight}:{width:0,height:0});
    if(stage.current){stage.current.scrollTop=0;stage.current.scrollLeft=0;}
  },[index,open]);
  useLayoutEffect(()=>{
    const box=stage.current;if(!open||!box)return;
    const measure=()=>setViewport({width:box.clientWidth,height:box.clientHeight});
    measure();const observer=new ResizeObserver(measure);observer.observe(box);return()=>observer.disconnect();
  },[open]);
  useLayoutEffect(()=>{
    const point=center.current,box=stage.current,picture=img.current;if(!point||!box||!picture)return;
    const outer=box.getBoundingClientRect(),inner=picture.getBoundingClientRect();
    box.scrollLeft+=inner.left-outer.left+point.x*inner.width-box.clientWidth/2;
    box.scrollTop+=inner.top-outer.top+point.y*inner.height-box.clientHeight/2;
    center.current=null;
  },[scale,zoom]);
  const resize=(next:number|null)=>{
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
    if(!open||closing.current)return;
    closing.current=true;pan.current=null;
    closeButton.current?.focus({preventScroll:true});
    setPhase('closing');
    const at=generation.current;
    const finished=img.current?motion.current?.close(images[index!]!.source,img.current):undefined;
    void Promise.resolve(finished).finally(()=>{if(generation.current===at)state.current.onClose();});
  };
  useLayoutEffect(()=>{if(open){closing.current=false;setPhase('opening');}},[open]);

  useModal({
    open,
    panel: dialog,
    initialFocus: closeButton,
    onClose:close,
    onKeyDown: (e) => {
      if(enlarged||phase!=='open')return;
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

  const current = open ? images[index!]! : null;
  const many = images.length > 1;
  const nav = "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20";
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
        className="lightbox fixed inset-0 z-[80] grid cursor-zoom-out touch-pinch-zoom place-items-center p-4 sm:p-10"
      >
        <div ref={backdrop} className="lightbox-backdrop absolute inset-0 bg-black/85" />
        <div ref={stage} role="region" aria-label="可滚动图片" tabIndex={enlarged?0:-1} className={`lightbox-stage${enlarged?' is-enlarged':''}`}
          onClick={event=>{if(enlarged){event.stopPropagation();tappedAfterDrag();}}}
          onPointerDown={event=>{if(phase!=='open'||!enlarged||event.pointerType!=='mouse'||event.button!==0)return;const box=event.currentTarget;pan.current={x:event.clientX,y:event.clientY,left:box.scrollLeft,top:box.scrollTop};box.setPointerCapture(event.pointerId);event.preventDefault();}}
          onPointerMove={event=>{const held=pan.current;if(!held)return;const dx=event.clientX-held.x,dy=event.clientY-held.y;if(Math.hypot(dx,dy)>3)suppressTap.current=true;event.currentTarget.scrollLeft=held.left-dx;event.currentTarget.scrollTop=held.top-dy;}}
          onPointerUp={event=>{pan.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
          onPointerCancel={()=>{pan.current=null;}}>
          {current&&<img ref={img} key={current.src} src={current.src} decoding="async" alt={current.alt??''} draggable={false}
            onLoad={event=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}
            style={scale?{width:dimensions.width*scale,height:dimensions.height*scale,maxWidth:'none',maxHeight:'none'}:undefined}
            className="lightbox-img rounded-control object-contain shadow-2xl"/>}
        </div>
        <div ref={layer} className="lightbox-transition-layer pointer-events-none fixed inset-0" aria-hidden="true" />
        <div className="lightbox-tools absolute left-5 top-5 flex gap-1 rounded-control bg-black/60 text-sm text-white" onClick={event=>event.stopPropagation()}>
          <button type="button" className="min-h-11 px-3 hover:bg-white/10" aria-pressed={zoom===null} disabled={phase!=='open'} onClick={()=>resize(null)}>适应窗口</button>
          <button type="button" className="min-h-11 px-3 hover:bg-white/10" aria-pressed={zoom!==null&&scale===1} disabled={phase!=='open'||!fit} onClick={()=>resize(1)}>原尺寸</button>
          <button type="button" className="min-h-11 px-3 hover:bg-white/10 disabled:opacity-40" aria-label="缩小图片" disabled={phase!=='open'||!enlarged} onClick={()=>resize(scale/1.25<=fit+0.001?null:scale/1.25)}>－</button>
          <span role="status" aria-label="图片缩放比例" className="grid min-w-12 place-items-center tabular-nums">{fit?`${Math.round(scale*100)}%`:'—'}</span>
          <button type="button" className="min-h-11 px-3 hover:bg-white/10 disabled:opacity-40" aria-label="放大图片" disabled={phase!=='open'||!fit||scale>=4} onClick={()=>resize(scale*1.25)}>＋</button>
        </div>
        <button ref={closeButton} type="button" aria-label="关闭" onClick={(e) => { e.stopPropagation(); close(); }} className="lightbox-tools absolute right-[max(16px,env(safe-area-inset-right))] top-[max(16px,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
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
            <span className="lightbox-tools num pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2.5 py-0.5 text-[12px] text-white/85">
              {index + 1} / {images.length}
            </span>
          </>
        )}
      </div>, document.body
  );
}
