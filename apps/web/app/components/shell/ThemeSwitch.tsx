import { useEffect, useId, useState, type ReactNode } from "react";
import { IconMonitor, IconMoon, IconSun } from "../icons";
import { applyTheme, resolvedTheme, setThemePreference, useThemePreference, type ThemePreference } from "../../lib/local-state";
import { transitionAppearance } from "../../lib/motion";

type Choice = "dark" | "system" | "light";

const OPTIONS: Array<{ key: Choice; label: string; icon: ReactNode }> = [
  { key: "dark", label: "深色", icon: <IconMoon size={14} /> },
  { key: "system", label: "跟随系统", icon: <IconMonitor size={14} /> },
  { key: "light", label: "浅色", icon: <IconSun size={14} /> },
];

function changeTheme(nextPref: ThemePreference) {
  transitionAppearance(() => {
    setThemePreference(nextPref);
    applyTheme(resolvedTheme(nextPref), nextPref === null);
  });
}

/** One click changes the displayed theme; matching the system returns to following it. */
export function ThemeToggle() {
  const descriptionId = useId();
  return (
    <button type="button" className="floating-tool-button theme-toggle" aria-label="主题切换" aria-describedby={descriptionId} title="主题切换" onClick={() => {
      const next = resolvedTheme() === "dark" ? "light" : "dark";
      changeTheme(next === resolvedTheme(null) ? null : next);
    }}>
      <span className="theme-when-light"><IconSun size={21} /></span>
      <span className="theme-when-dark"><IconMoon size={21} /></span>
      <span id={descriptionId} className="sr-only">
        <span className="theme-when-light">当前为浅色，切换为深色主题</span>
        <span className="theme-when-dark">当前为深色，切换为浅色主题</span>
      </span>
    </button>
  );
}

/** Three-way appearance switch (dark / follow the system / light) with a sliding thumb. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const pref = useThemePreference();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current: Choice = !mounted ? "system" : (pref ?? "system");
  const index = OPTIONS.findIndex((o) => o.key === current);

  return (
    <div role="radiogroup" aria-label="外观" className={`relative grid h-[34px] grid-cols-3 rounded-full border border-line bg-bg-sunk p-[3px] ${className}`}>
      <span
        aria-hidden="true"
        className="absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/3)] rounded-full border border-line bg-surface shadow-[var(--shadow-card)] transition-transform duration-200 ease-[var(--ease-out-quart)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={current === o.key}
          title={o.label}
          onClick={() => changeTheme(o.key === "system" ? null : o.key)}
          className={`relative z-10 flex items-center justify-center rounded-full transition-colors duration-150 ${current === o.key ? "text-ink" : "text-ink-4 hover:text-ink-2"}`}
        >
          {o.icon}
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
