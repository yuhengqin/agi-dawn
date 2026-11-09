import { useId } from "react";
import { IconMoon, IconSun } from "../icons";
import { applyTheme, resolvedTheme, setThemePreference, type ThemePreference } from "../../lib/local-state";
import { transitionAppearance } from "../../lib/motion";

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
