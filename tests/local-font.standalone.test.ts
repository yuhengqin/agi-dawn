// Failure modes: startup fails to remove the retired font key, failed cleanup breaks appearance,
// or version-1 backups lose/replace an unrelated preference.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { APPEARANCE_BOOT_SCRIPT, KEYS } from "../apps/web/app/lib/local-state.ts";

class MemoryStorage {
  values = new Map<string, string>();
  denied = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.denied) throw new Error("full"); this.values.set(key, value); }
  removeItem(key: string) { if (this.denied) throw new Error("full"); this.values.delete(key); }
}
test("appearance startup removes the legacy font key and preserves other preferences and session history", () => {
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
    assert.equal(local.getItem(key), key === "agidawn-font" ? null : value);
  }
  assert.equal(attributes["data-theme"], "dark");
  assert.equal(attributes["data-font"], undefined);
  assert.equal(session.getItem("agidawn:last-page"), "/items/saved");
  assert.equal(session.getItem("agidawn:screens"), '{"0":{"name":"文章","key":"default"}}');
  assert.equal(session.getItem("agidawn-render-recovery-release"), "release-A");
  assert.equal(session.values.size, 3);
  local.denied = true;
  assert.doesNotThrow(boot);
  assert.equal(attributes["data-theme"], "dark");
  assert.equal(attributes["data-font"], undefined);
  assert.equal(local.getItem("agidawn-feedback-draft-v1"), saved["agidawn-feedback-draft-v1"]);
});

test("legacy font cleanup touches only its key and does not block theme or reading display", () => {
  for (const denied of [false, true]) {
    const local = new MemoryStorage();
    local.setItem("agidawn-font", "browser");
    local.setItem(KEYS.theme, "dark");
    local.setItem(KEYS.readingDisplay, '{"size":"large","spacing":"loose","width":"wide"}');
    local.setItem("agidawn-feedback-draft-v1", '{"text":"keep"}');
    const originalRemove = local.removeItem.bind(local);
    const removed: string[] = [];
    const read: string[] = [];
    const originalGet = local.getItem.bind(local);
    local.getItem = (key: string) => { read.push(key); return originalGet(key); };
    local.removeItem = (key: string) => {
      removed.push(key);
      if (denied && key === "agidawn-font") throw new Error("blocked");
      originalRemove(key);
    };
    const attributes: Record<string, string> = {};
    runInNewContext(APPEARANCE_BOOT_SCRIPT, {
      localStorage: local,
      window: { matchMedia: () => ({ matches: false }) },
      document: { documentElement: { setAttribute: (key: string, value: string) => { attributes[key] = value; } }, querySelectorAll: () => [] },
    });
    assert.deepEqual(removed, ["agidawn-font"]);
    assert.deepEqual(read, [KEYS.theme, KEYS.readingDisplay]);
    assert.equal(local.getItem("agidawn-font"), denied ? "browser" : null);
    assert.equal(local.getItem("agidawn-feedback-draft-v1"), '{"text":"keep"}');
    assert.equal(attributes["data-font"], undefined);
    assert.equal(attributes["data-theme"], "dark");
    assert.deepEqual(["size", "spacing", "width"].map((key) => attributes[`data-reading-${key}`]), ["large", "loose", "wide"]);
  }
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
