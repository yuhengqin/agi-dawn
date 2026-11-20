// Article links cross-fade; other opted-in phone links retain their directional transition.
// Browser history keeps its own motion and restores keyboard context without moving the scroll position.
import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";
import { isPhone } from "./screens";

let goingBack = false;

/** Called just before navigating back from the app's own controls (the bar's back button, a tab tapped deeper in). */
export function markBack() {
  goingBack = true;
}

type HistoryStateLike = { idx?: unknown; key?: string; usr?: unknown } | null;
const HISTORY_SYNC_KEY = "__agidawnHistorySync";

/** Keep React Router's history.state.idx aligned when native same-document hash jumps (#main, footnotes) push state=null. */
function installHistorySync() {
  if (typeof window === "undefined") return;
  const host = window as unknown as Record<string, unknown>;
  if (host[HISTORY_SYNC_KEY]) return;
  const initial = window.history.state as HistoryStateLike;
  const tracker = {
    idx: initial && typeof initial.idx === "number" ? initial.idx : 0,
    pathname: window.location.pathname,
    usr: initial?.usr ?? null,
  };
  const nativePushState = window.history.pushState.bind(window.history);
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  const record = (state: unknown) => {
    const raw = state as HistoryStateLike;
    if (raw && typeof raw.idx === "number") {
      tracker.idx = raw.idx;
      tracker.pathname = window.location.pathname;
      tracker.usr = raw.usr ?? null;
    }
  };
  const repairIfMissing = () => {
    const raw = window.history.state as HistoryStateLike;
    if (raw && typeof raw.idx === "number") {
      record(raw);
      return;
    }
    const nextIdx = tracker.idx + 1;
    const preservedUsr = tracker.pathname === window.location.pathname ? tracker.usr : null;
    nativeReplaceState({ ...(raw ?? {}), usr: preservedUsr, key: raw?.key ?? "default", idx: nextIdx }, "");
    tracker.idx = nextIdx;
    tracker.pathname = window.location.pathname;
    tracker.usr = preservedUsr;
  };
  window.history.pushState = function pushState(state, unused, url) {
    nativePushState(state, unused, url);
    record(state);
  };
  window.history.replaceState = function replaceState(state, unused, url) {
    nativeReplaceState(state, unused, url);
    record(state);
  };
  window.addEventListener("popstate", repairIfMissing);
  window.addEventListener("hashchange", repairIfMissing);
  host[HISTORY_SYNC_KEY] = { repairIfMissing };
}

installHistorySync();

/** In the root: marks the direction of each page change while it is committed, before the transition animates. */
export function usePageTransition() {
  const { key, pathname, hash } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    installHistorySync();
    const sync = (window as unknown as Record<string, { repairIfMissing?: () => void }>)[HISTORY_SYNC_KEY];
    sync?.repairIfMissing?.();
    const from = previous.current;
    const articleFromList = from === "/" && pathname.startsWith("/items/");
    document.documentElement.dataset.vt = articleFromList && type !== "POP" ? "article" : !isPhone() ? "none" : goingBack ? "back" : type === "POP" ? "none" : "push";
    if (articleFromList) document.querySelector<HTMLHeadingElement>("#main h1")?.focus({ preventScroll: true });
    if (type === "POP" && pathname === "/" && from.startsWith("/items/")) {
      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("#main a[href]")).find(link => link.pathname === from);
      link?.focus({ preventScroll: true });
    }
    previous.current = pathname;
    goingBack = false;
  }, [key, pathname, hash, type]);
}
