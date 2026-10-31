// Failure modes: startup overwrites the saved choice, malformed/unavailable storage breaks the
// document, denied writes prevent even an in-tab choice, or version-1 backups lose/replace a preference.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { APPEARANCE_BOOT_SCRIPT, getFontPreference, KEYS, setFontPreference } from "../apps/web/app/lib/local-state.ts";

class MemoryStorage {
  values = new Map<string, string>();
  denied = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.denied) throw new Error("full"); this.values.set(key, value); }
  removeItem(key: string) { if (this.denied) throw new Error("full"); this.values.delete(key); }
}
const store = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: store, sessionStorage: new MemoryStorage() } });

test("appearance startup preserves saved preferences, drafts and session history", () => {
  const local = new MemoryStorage(), session = new MemoryStorage();
  const saved = {
    "agidawn-theme": "dark", "agidawn-font": "browser",
    "agidawn-changelog-seen-version": "2026-10-31T12:00",
    "agidawn-feedback-draft-v1": '{"text":"keep my draft"}',
    "agidawn-recent-searches": '["agents"]',
  };
  for (const [key, value] of Object.entries(saved)) local.setItem(key, value);
  session.setItem("agidawn:last-page", "/items/saved");
  session.setItem("agidawn:screens", '{"0":{"name":"文章","key":"default"}}');
  session.setItem("agidawn-render-recovery-release", "release-A");
  const attributes: Record<string, string> = {};
  const boot = () => runInNewContext(APPEARANCE_BOOT_SCRIPT, {
    localStorage: local, sessionStorage: session, window: { matchMedia: () => ({ matches: false }) },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attributes[k] = v; } }, querySelectorAll: () => [] },
  });
  boot();
  for (const [key, value] of Object.entries(saved)) {
    assert.equal(local.getItem(key), value);
  }
  assert.equal(attributes["data-theme"], "dark");
  assert.equal(attributes["data-font"], "browser");
  assert.equal(session.getItem("agidawn:last-page"), "/items/saved");
  assert.equal(session.getItem("agidawn:screens"), '{"0":{"name":"文章","key":"default"}}');
  assert.equal(session.getItem("agidawn-render-recovery-release"), "release-A");
  assert.equal(session.values.size, 3);
  local.denied = true;
  assert.doesNotThrow(boot);
  assert.equal(local.getItem("agidawn-feedback-draft-v1"), saved["agidawn-feedback-draft-v1"]);
});

test("appearance startup applies a saved browser font before rendering and safely handles invalid storage", () => {
  for (const font of ["browser", "bad", null, "denied"]) {
    const attributes: Record<string, string> = {};
    runInNewContext(APPEARANCE_BOOT_SCRIPT, {
      localStorage: { getItem: (key: string) => { if (font === "denied") throw new Error("blocked"); return key === KEYS.font ? font : "dark"; } },
      window: { matchMedia: () => ({ matches: false }) },
      document: { documentElement: { setAttribute: (key: string, value: string) => { attributes[key] = value; } }, querySelectorAll: () => [] },
    });
    assert.equal(attributes["data-font"], font === "browser" ? "browser" : "system");
    assert.equal(attributes["data-theme"], font === "denied" ? "light" : "dark");
  }
});

test("font choices remain usable when browser persistence is denied", () => {
  setFontPreference("browser");
  assert.equal(getFontPreference(), "browser");
  assert.equal(store.getItem(KEYS.font),"browser");
  setFontPreference(null);
  store.denied = true;
  setFontPreference("browser");
  assert.equal(getFontPreference(), "browser", "a choice still works in this tab when persistence is blocked");
  setFontPreference(null);
  assert.equal(getFontPreference(), null);
  store.denied = false;
});

test('appearance startup validates reading settings before the first frame',()=>{
  const cases=[
    {raw:'{"size":"large","spacing":"loose","width":"wide"}',want:['large','loose','wide']},
    {raw:'{"size":"huge","spacing":"compact","width":"infinite"}',want:['default','compact','default']},
    {raw:'{',want:['default','default','default']},
    {raw:null,want:['default','default','default']},
    {raw:'denied',want:['default','default','default']},
  ];
  for(const {raw,want} of cases){
    const attributes:Record<string,string>={};
    runInNewContext(APPEARANCE_BOOT_SCRIPT,{localStorage:{getItem:(key:string)=>{if(raw==='denied')throw new Error('blocked');return key==='agi-dawn-reading-display-v1'?raw:null;}},window:{matchMedia:()=>({matches:false})},document:{documentElement:{setAttribute:(key:string,value:string)=>{attributes[key]=value;}},querySelectorAll:()=>[]}});
    assert.deepEqual(['size','spacing','width'].map(key=>attributes['data-reading-'+key]),want);
  }
});
