// Browser appearance preferences, recent searches and feedback drafts. Private reading data lives on the server.
import { useEffect, useSyncExternalStore } from "react";

export const KEYS = {
  theme: "agidawn-theme",
  font: "agidawn-font",
  readingDisplay: "agi-dawn-reading-display-v1",
  figureNotices: "agi-dawn-figure-notices-v1",
  changelogSeen: "agidawn-changelog-seen-version",
  feedbackDraft: "agidawn-feedback-draft-v1",
  recentSearches: "agidawn-recent-searches",
} as const;

const RECENT_SEARCH_LIMIT = 10;
const RECENT_SEARCH_MAX_CHARS = 200;

type StorageKind = "local" | "session";

// Reading the storage property itself throws where the browser blocks storage.
function storage(kind: StorageKind): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A stored string; null when it is missing or storage is unavailable. */
export function readRaw(key: string, kind: StorageKind = "local"): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** A stored JSON value; null when it is missing, unreadable or not JSON. */
export function readJson(key: string, kind: StorageKind = "local"): unknown {
  const raw = readRaw(key, kind);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Stores a string, or removes the key for null; false when nothing was saved (storage full or unavailable). */
export function writeRaw(key: string, value: string | null, kind: StorageKind = "local"): boolean {
  try {
    const s = storage(kind);
    if (!s) return false;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// change notification (same tab via events, other tabs via the storage event)
const listeners = new Map<string, Set<() => void>>();
let subscribers = 0;
function emit(key?: string) {
  for (const [subscribedKey, callbacks] of listeners) {
    if (key === undefined || key === subscribedKey) for (const callback of callbacks) callback();
  }
}
function onStorage(event: StorageEvent) {
  if (event.storageArea && event.storageArea !== storage("local")) return;
  const key=event.key;
  if (key === null || key === KEYS.theme) unsavedTheme = undefined;
  if (key === null || key === KEYS.font) unsavedFont = undefined;
  if (key === null || key === KEYS.readingDisplay) unsavedReadingDisplay = undefined;
  if (key === null || key === KEYS.figureNotices) unsavedFigureNotices = undefined;
  if (key === null) cache.clear();
  else cache.delete(key);
  // Clear the snapshot once, before notifying all cards. Each key is parsed at most once.
  emit(key ?? undefined);
}
function subscribeKey(key: string) {
  return (listener: () => void) => {
    let callbacks = listeners.get(key);
    if (!callbacks) listeners.set(key, callbacks = new Set());
    callbacks.add(listener);
    if (subscribers++ === 0) window.addEventListener("storage", onStorage);
    return () => {
      callbacks.delete(listener);
      if (callbacks.size === 0) listeners.delete(key);
      if (--subscribers === 0) window.removeEventListener("storage", onStorage);
    };
  };
}
const subscribeTheme = subscribeKey(KEYS.theme);
const subscribeFont = subscribeKey(KEYS.font);
const subscribeReadingDisplay = subscribeKey(KEYS.readingDisplay);
const subscribeFigureNotices = subscribeKey(KEYS.figureNotices);
const subscribeChangelog = subscribeKey(KEYS.changelogSeen);
const subscribeRecentSearches = subscribeKey(KEYS.recentSearches);

// Snapshot cache so useSyncExternalStore gets stable references between changes.
const cache = new Map<string, unknown>();
function cached<T>(key: string, compute: () => T): T {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as T;
}
function invalidate(key: string) {
  cache.delete(key);
  emit(key);
}

// appearance
export type FontPreference = "browser" | null;
let unsavedFont: FontPreference | undefined;

export function getFontPreference(): FontPreference {
  return unsavedFont !== undefined ? unsavedFont : readRaw(KEYS.font) === "browser" ? "browser" : null;
}

export function setFontPreference(pref: FontPreference) {
  // A denied write still leaves the choice usable in this tab, like an unsaved preference.
  unsavedFont = writeRaw(KEYS.font, pref) ? undefined : pref;
  emit(KEYS.font);
}

export interface ReadingDisplay {size:"default"|"large"|"larger";spacing:"compact"|"default"|"loose";width:"narrow"|"default"|"wide"}
export const DEFAULT_READING_DISPLAY:ReadingDisplay={size:"default",spacing:"default",width:"default"};
const readingValues={size:["default","large","larger"],spacing:["compact","default","loose"],width:["narrow","default","wide"]} as const;
export const READING_DISPLAY_CHANGE_EVENT="agi-reading-display-change";
let unsavedReadingDisplay:ReadingDisplay|undefined;
function parseReadingDisplay(input:unknown):ReadingDisplay{
  const value=input&&typeof input==="object"&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const choose=<K extends keyof ReadingDisplay>(key:K):ReadingDisplay[K]=>(readingValues[key] as readonly unknown[]).includes(value[key])?value[key] as ReadingDisplay[K]:DEFAULT_READING_DISPLAY[key];
  return {size:choose("size"),spacing:choose("spacing"),width:choose("width")};
}
export function getReadingDisplay():ReadingDisplay{return unsavedReadingDisplay??cached(KEYS.readingDisplay,()=>parseReadingDisplay(readJson(KEYS.readingDisplay)));}
export function setReadingDisplay(input:ReadingDisplay):boolean{
  const value=parseReadingDisplay(input),saved=writeRaw(KEYS.readingDisplay,JSON.stringify(value));
  unsavedReadingDisplay=saved?undefined:value;invalidate(KEYS.readingDisplay);return saved;
}
function applyReadingDisplay(value:ReadingDisplay){
  const keys=Object.keys(readingValues) as Array<keyof ReadingDisplay>;
  if(keys.every(key=>document.documentElement.getAttribute("data-reading-"+key)===value[key]))return;
  // Private readers capture their section before these attributes reflow the text.
  window.dispatchEvent(new Event(READING_DISPLAY_CHANGE_EVENT));
  for(const key of keys)document.documentElement.setAttribute("data-reading-"+key,value[key]);
}
export function useReadingDisplay():ReadingDisplay{return useSyncExternalStore(subscribeReadingDisplay,getReadingDisplay,()=>DEFAULT_READING_DISPLAY);}
const readingBootScript=`(function(){var v;try{v=JSON.parse(localStorage.getItem('${KEYS.readingDisplay}'))}catch(e){}v=v&&typeof v==='object'?v:{};${Object.entries(readingValues).map(([key,values])=>`document.documentElement.setAttribute('data-reading-${key}',${JSON.stringify(values)}.includes(v.${key})?v.${key}:'default');`).join("")}})();`;

interface FigureNotices {hidden:boolean}
const DEFAULT_FIGURE_NOTICES:FigureNotices={hidden:false};
let unsavedFigureNotices:FigureNotices|undefined;
function readFigureNotices():FigureNotices{return {hidden:readRaw(KEYS.figureNotices)==='hidden'};}
function getFigureNotices():FigureNotices{return unsavedFigureNotices??cached(KEYS.figureNotices,readFigureNotices);}
function updateFigureNotices(value:FigureNotices,saved:boolean):boolean{
  unsavedFigureNotices=saved?undefined:value;invalidate(KEYS.figureNotices);return saved;
}
export function hideFigureNotices():boolean{return updateFigureNotices({...getFigureNotices(),hidden:true},writeRaw(KEYS.figureNotices,'hidden'));}
export function restoreFigureNotices():boolean{
  return updateFigureNotices(DEFAULT_FIGURE_NOTICES,writeRaw(KEYS.figureNotices,null));
}
export function useFigureNotices():FigureNotices{return useSyncExternalStore(subscribeFigureNotices,getFigureNotices,()=>DEFAULT_FIGURE_NOTICES);}

export type ThemePreference = "light" | "dark" | null;
let unsavedTheme: ThemePreference | undefined;

export function getThemePreference(): ThemePreference {
  if (unsavedTheme !== undefined) return unsavedTheme;
  const v = readRaw(KEYS.theme);
  return v === "light" || v === "dark" ? v : null;
}

export function setThemePreference(pref: ThemePreference) {
  unsavedTheme = writeRaw(KEYS.theme, pref) ? undefined : pref;
  invalidate(KEYS.theme);
}

export function resolvedTheme(pref: ThemePreference = getThemePreference()): "light" | "dark" {
  if (pref) return pref;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

const THEME_COLOR = { light: "#faf9f6", dark: "#13191c" } as const;

/** Puts a theme on the page: the document's data-theme and the browser's theme colour. */
export function applyTheme(theme: "light" | "dark", followsSystem: boolean) {
  document.documentElement.setAttribute("data-theme", theme);
  // The two theme-color tags answer the system scheme; a chosen theme sets both to its own colour.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = followsSystem ? THEME_COLOR[scheme] : THEME_COLOR[theme];
  }
}

/**
 * Keeps the page on the reader's theme after the first paint: a choice made in another tab or by an
 * import, and the system switching between light and dark while the page follows it.
 */
export function useAppearanceSync() {
  useEffect(()=>{
    // Per-article permanent dismissals were replaced by visit-only component state.
    try{const s=storage('local');for(let i=(s?.length??0)-1;i>=0;i--){const key=s!.key(i);if(key?.startsWith(KEYS.figureNotices+':'))s!.removeItem(key);}}catch{}
  },[]);
  const pref = useThemePreference();
  const font = useFontPreference();
  const reading = useReadingDisplay();
  useEffect(() => {applyReadingDisplay(getReadingDisplay());}, [reading]);
  useEffect(() => {
    document.documentElement.setAttribute("data-font", getFontPreference() ?? "system");
  }, [font]);
  useEffect(() => {
    // Read the stored choice itself: during hydration the hook still reports the server's "none".
    const current = getThemePreference();
    applyTheme(resolvedTheme(current), current === null);
    if (current !== null) return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => applyTheme(query.matches ? "dark" : "light", true);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [pref]);
}

/** Inline script run before paint so the first frame already has the reader's appearance. */
export const APPEARANCE_BOOT_SCRIPT = `(function(){var f='system';try{f=localStorage.getItem('${KEYS.font}')==='browser'?'browser':'system'}catch(e){}document.documentElement.setAttribute('data-font',f);try{var t=localStorage.getItem('${KEYS.theme}');if(t==='light'||t==='dark'){var c=t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}';document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c})}else{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`+readingBootScript;

// changelog red dot
function getChangelogSeen(): string | null {
  const v = readRaw(KEYS.changelogSeen);
  return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null;
}

export function setChangelogSeen(version: string) {
  writeRaw(KEYS.changelogSeen, version);
  invalidate(KEYS.changelogSeen);
}

// recent searches (newest first, at most RECENT_SEARCH_LIMIT; this browser only)
function getRecentSearches(): string[] {
  return cached(KEYS.recentSearches, () => {
    const parsed = readJson(KEYS.recentSearches);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, RECENT_SEARCH_LIMIT) : [];
  });
}

/** Puts a search first (the same words in another case replace the older entry). */
export function addRecentSearch(query: string) {
  const q = query.trim().slice(0, RECENT_SEARCH_MAX_CHARS);
  if (!q) return;
  const rest = getRecentSearches().filter((v) => v.toLowerCase() !== q.toLowerCase());
  writeRaw(KEYS.recentSearches, JSON.stringify([q, ...rest].slice(0, RECENT_SEARCH_LIMIT)));
  invalidate(KEYS.recentSearches);
}

export function clearRecentSearches() {
  writeRaw(KEYS.recentSearches, null);
  invalidate(KEYS.recentSearches);
}

// the page the reader was on (feedback records where a problem was seen)
const LAST_PAGE_KEY = "agidawn:last-page";
const NOT_A_PLACE = /^\/(feedback|more)(\/|$)|^\/admin(\/|$)/;

/** Called on every in-site navigation: remembers the latest real page, never feedback, "更多" or the admin. */
export function rememberPage(path: string) {
  if (!NOT_A_PLACE.test(path)) writeRaw(LAST_PAGE_KEY, path, "session");
}

export function lastPage(): string | null {
  const v = readRaw(LAST_PAGE_KEY, "session");
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
}

// React hooks
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getThemePreference, () => null);
}

export function useFontPreference(): FontPreference {
  return useSyncExternalStore(subscribeFont, getFontPreference, () => null);
}

export function useChangelogSeen(): string | null {
  return useSyncExternalStore(subscribeChangelog, getChangelogSeen, () => null);
}

const NO_SEARCHES: string[] = [];
export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribeRecentSearches, getRecentSearches, () => NO_SEARCHES);
}
