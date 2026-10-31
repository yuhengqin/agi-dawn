import { useEffect, useRef, useState } from "react";
import { IconArrowUpToLine } from "../icons";
import { scrollBehavior } from "../../lib/motion";

/** A thin accent line while a navigation is in flight (shown only if it takes a moment). */
export function NavigationProgress({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (active) timer.current = setTimeout(() => setVisible(true), 150);
    else {
      if (timer.current) clearTimeout(timer.current);
      setVisible(false);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] overflow-hidden" aria-hidden="true">
      <div
        className="h-full origin-left bg-accent"
        style={{
          transform: `scaleX(${visible ? 0.85 : active ? 0 : 1})`,
          opacity: visible ? 1 : 0,
          transition: visible ? "transform 2.4s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 120ms" : "transform 200ms, opacity 300ms 120ms",
        }}
      />
    </div>
  );
}

/** Round "back to top" button in the floating tools once the reader has scrolled a screen or so. */
export function BackToTop({onActivate}:{onActivate?:()=>void}={}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 1.2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      aria-hidden={!shown}
      disabled={!shown}
      onClick={() => {onActivate?.();window.scrollTo({ top: 0, behavior: scrollBehavior() });}}
      className="floating-tool-button floating-back-to-top"
    >
      <IconArrowUpToLine size={20} />
    </button>
  );
}
