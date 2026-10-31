import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** A small dropdown anchored to a trigger; closes on outside click, Escape or choosing an entry. */
export function Menu({ trigger, label, children }: { trigger: ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),first=useRef(0),id=useId();
  const entries=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')??[]);
  const close=()=>{button.current?.focus();setOpen(false);};
  useLayoutEffect(()=>{
    if(!open)return;
    const fit=()=>{
      const menu=panel.current!;menu.style.translate='none';menu.style.top='calc(100% + 4px)';menu.style.bottom='auto';menu.style.maxHeight='calc(100dvh - 24px)';
      const bounds=menu.getBoundingClientRect(),trigger=button.current!.getBoundingClientRect();
      menu.style.translate=`${Math.max(12-bounds.left,Math.min(0,innerWidth-12-bounds.right))}px 0`;
      const below=innerHeight-trigger.bottom-16,above=trigger.top-16;
      if(bounds.height>below&&above>below){menu.style.top='auto';menu.style.bottom='calc(100% + 4px)';menu.style.maxHeight=`${Math.max(0,above)}px`;}
      else menu.style.maxHeight=`${Math.max(0,below)}px`;
    };
    fit();entries().at(first.current)?.focus();window.addEventListener('resize',fit);
    return()=>window.removeEventListener('resize',fit);
  },[open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {if(e.key === "Escape"){e.preventDefault();close();}};
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={button}
        id={id}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open?id+'-menu':undefined}
        onPointerDown={event=>{if(open)event.preventDefault();}}
        onClick={() => {first.current=0;setOpen(!open);}}
        onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();first.current=event.key==='ArrowUp'?-1:0;if(open)entries().at(first.current)?.focus();else setOpen(true);}}}
        className={`inline-flex size-11 items-center justify-center rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-accent ${open ? "bg-bg-sunk text-ink" : "text-ink-3 hover:bg-bg-sunk hover:text-ink"}`}
      >
        {trigger}
      </button>
      {open&&<div
          ref={panel}
          id={id+'-menu'}
          role="menu"
          aria-labelledby={id}
          onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}
          onKeyDown={event=>{
            const items=entries(),index=items.indexOf(document.activeElement as HTMLElement);
            const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index-1+items.length)%items.length:null;
            if(next!==null){event.preventDefault();items[next]?.focus();}
            if(event.key===' '&&event.target instanceof HTMLAnchorElement){event.preventDefault();event.target.click();}
          }}
          className="absolute top-full right-0 z-50 w-max min-w-[168px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-control border border-line bg-raised py-1 shadow-[var(--shadow-pop)]"
        >
          {children(close)}
        </div>}
    </div>
  );
}

/** One entry of a Menu (a button or a link). */
export function MenuItem({ icon, children, onSelect, href, download, target, rel }: { icon?: ReactNode; children: ReactNode; onSelect?: () => void; href?: string; download?: boolean;target?:string;rel?:string }) {
  const cls = "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-bg-sunk hover:text-ink focus-visible:bg-bg-sunk focus-visible:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
  const inner = (
    <>
      {icon && <span className="text-ink-4">{icon}</span>}
      {children}
    </>
  );
  if (href) {
    return (
      <a role="menuitem" tabIndex={-1} href={href} download={download} target={target} rel={rel} onClick={onSelect} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button role="menuitem" tabIndex={-1} type="button" onClick={onSelect} className={cls}>
      {inner}
    </button>
  );
}
