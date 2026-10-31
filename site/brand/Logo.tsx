// 站点的字标和圆环标记：页面用 Wordmark 画站名（size 是高度，单位像素），RingMark 是小标记，转起来就是加载动画。
// 这里用站名排字；有自己的 Logo 时，把 Wordmark 换成你的 SVG（保持同样的参数）。
import { SITE } from "../site.ts";

export function Wordmark({ size = 24, className = "", title = SITE.name }: { size?: number; className?: string; title?: string }) {
  return (
    <span className={`inline-flex items-center font-black leading-none tracking-[-0.03em] ${className}`} style={{ fontSize: Math.round(size * 0.92) }} aria-label={title} role="img">
      <RingMark className="mr-[0.3em] size-[0.9em] text-accent" />
      <span aria-hidden="true">{SITE.name}</span>
    </span>
  );
}

/** The reader's dawn mark; the same geometry is used in the app icon. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g style={spinning ? { transformOrigin: "12px 12px", animation: "spin-slow 1.1s linear infinite" } : undefined}>
        <path d="M5 14a7 7 0 0 1 14 0M3 14h18M6 19h12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}
