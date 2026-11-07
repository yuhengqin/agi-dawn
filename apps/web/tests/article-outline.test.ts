import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "./browser.ts";
import { fakeApi, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

function outlineApi(item:ReturnType<typeof itemDetail>){
  const engagement={id:item.id,views:0,likes:0,liked:false};
  return fakeApi(url=>{
    if(url.pathname===`/api/site/items/${item.id}`)return item;
    if(url.pathname==='/api/site/engagement')return {items:[engagement]};
    if(url.pathname===`/api/site/items/${item.id}/view`)return engagement;
  });
}

// Failure mode (#182 left half-fixed): between lg and 2xl the outline sits under the right rail's other
// blocks; on a 1366x657 laptop window only one entry was visible, and a little shorter the rail grew
// past the window again so the later entries could not be reached at all.
test("a short laptop window keeps several outline entries and can reach the last one", async () => {
  const outline = Array.from({ length: 40 }, (_, i) => ({ id: `section-${i}`, level: 2, text: `Section ${i}` }));
  const item = itemDetail({
    id: "outline-short", title: "目录可达检查", tags: ["标签甲", "标签乙", "标签丙"], outline,
    bodyHtml: outline.map((o) => `<h2 id="${o.id}">${o.text}</h2><p>${"固定正文。".repeat(100)}</p>`).join(""),
  });
  const api = outlineApi(item);
  const browser = await chromium.launch({ channel: "chromium" });
  let web: WebServer | undefined;
  try {
    web = await startWebServer(api);
    for (const height of [657, 560]) {
      const page = await browser.newPage({ viewport: { width: 1366, height }, reducedMotion: "reduce" });
      await page.goto(web.origin + "/items/outline-short");
      const nav = page.getByRole("navigation", { name: "本文目录" });
      await expect(nav).toBeVisible();
      await page.waitForTimeout(100);
      const entry = await nav.locator("a").first().evaluate((a) => a.getBoundingClientRect().height);
      assert.ok((await nav.evaluate((n) => n.clientHeight)) >= entry * 5, `${height}px: the outline shows at least five entries`);
      const last = nav.locator("a").last();
      await last.scrollIntoViewIfNeeded();
      const box = await last.evaluate((a) => { const r = a.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      assert.ok(box.top >= 0 && box.bottom <= height, `${height}px: the last entry can be brought into the window`);
      await page.close();
    }
  } finally {
    await browser.close();
    await web?.stop();
  }
});

// WebKit can send Home/End to the page even when an overflowing outline contains CSS overscroll.
test("outline keyboard scrolling stays inside its boundary in WebKit", async () => {
  const outline = Array.from({ length: 40 }, (_, i) => ({ id: `section-${i}`, level: 2, text: `Section ${i}` }));
  const item = itemDetail({ id: "outline-keys", title: "键盘目录检查", outline,
    bodyHtml: outline.map(o => `<h2 id="${o.id}">${o.text}</h2><p>${"固定正文。".repeat(100)}</p>`).join(""),
  });
  const web = await startWebServer(outlineApi(item));
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    await visit(page, web.origin + "/items/outline-keys");
    const nav = page.getByRole("navigation", { name: "本文目录" });
    await expect(nav).toBeVisible();
    for (const [boundary, keys] of [["end", ["End", "PageDown", "ArrowDown", "Space"]], ["start", ["Home", "PageUp", "ArrowUp", "Shift+Space"]]] as const) {
      for (const key of keys) {
        await page.evaluate(() => window.scrollTo(0, 800));
        await nav.evaluate((n, boundary) => {
          n.scrollTop = boundary === "end" ? n.scrollHeight : 0;
          n.querySelector<HTMLElement>(boundary === "end" ? "li:last-child a" : "li:first-child a")!.focus({ preventScroll: true });
        }, boundary);
        const before = await page.evaluate(() => scrollY);
        await page.keyboard.press(key);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => scrollY), before, `${key} stays inside the outline at its ${boundary}`);
      }
    }
    await expect(nav).toHaveAttribute("tabindex", "0");
    await nav.evaluate(n => { n.scrollTop = 0; n.focus({ preventScroll: true }); });
    await page.keyboard.press("PageDown");
    await expect.poll(() => nav.evaluate(n => n.scrollTop)).toBeGreaterThan(0);
  } finally {
    await browser.close();
    await web.stop();
  }
});

for (const engine of [chromium, webkit]) test(`the desktop outline collapses without losing the reading point or nested state (${engine.name()})`, async () => {
  const outline = [
    { id: "start", level: 2, text: "Start" },
    { id: "detail", level: 3, text: "Detail" },
    { id: "middle", level: 2, text: "Middle" },
    { id: "end", level: 2, text: "End" },
  ];
  const item = itemDetail({ id: "outline-toggle", title: "可折叠目录", outline,
    bodyHtml: outline.map(o => `<h${o.level} id="${o.id}">${o.text}</h${o.level}>` + `<p>${"Readable section content. ".repeat(100)}</p>`.repeat(4)).join(""),
  });
  const web = await startWebServer(outlineApi(item));
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
    await visit(page, web.origin + "/items/" + item.id);
    const nav = page.getByRole("navigation", { name: "本文目录", exact: true });
    const collapse = page.getByRole("button", { name: "收起本文目录", exact: true });
    const expand = page.getByRole("button", { name: "展开本文目录", exact: true });
    const body = page.getByRole("region", { name: "文章正文", exact: true });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    assert.equal(await collapse.getAttribute("aria-controls"), await nav.getAttribute("id"));
    await nav.getByRole("button", { name: "收起：Start", exact: true }).click();
    await page.evaluate(() => {
      const from = document.getElementById("middle")!, to = document.getElementById("end")!;
      scrollTo(0, scrollY + from.getBoundingClientRect().top + (to.getBoundingClientRect().top - from.getBoundingClientRect().top) * .35 - parseFloat(getComputedStyle(from).scrollMarginTop));
    });
    const ratio = () => page.evaluate(() => {
      const from = document.getElementById("middle")!, to = document.getElementById("end")!;
      return (parseFloat(getComputedStyle(from).scrollMarginTop) - from.getBoundingClientRect().top) / (to.getBoundingClientRect().top - from.getBoundingClientRect().top);
    });
    const before = await body.boundingBox();
    assert.ok(before);
    await collapse.focus();
    await page.keyboard.press("Enter");
    await expect(nav).toBeHidden();
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(before.x, 1);
    await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(before.width);
    await expect.poll(ratio).toBeCloseTo(.35, 2);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator('nav[aria-label="本文目录"]').evaluate(el => el.contains(document.activeElement)), false, "collapsed links leave the tab order");
    await expand.focus();
    await page.keyboard.press("Space");
    await expect(nav).toBeVisible();
    await expect(collapse).toBeFocused();
    await expect(nav.getByRole("link", { name: "Detail", exact: true })).toBeHidden();
    await expect(nav.getByRole("link", { name: "Middle", exact: true })).toHaveAttribute("aria-current", "location");
    await expect.poll(ratio).toBeCloseTo(.35, 2);
    await collapse.click();
    await page.getByRole("button", { name: "开启专注模式", exact: true }).click();
    await expect(expand).toBeHidden();
    const focusedBox = await body.boundingBox();
    await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
    await expect(expand).toBeVisible();
    assert.deepEqual(await body.boundingBox(), focusedBox, "focus mode retains the collapsed layout and reading point");
    await page.setViewportSize({ width: 1100, height: 768 });
    await expect(expand).toBeHidden();
    await page.getByLabel("展开文章目录", { exact: true }).click();
    await expect(page.getByRole("navigation", { name: "手机文章目录", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(expand).toBeVisible();
    await expand.click();
    await nav.getByRole("link", { name: "End", exact: true }).click();
    await expect(page.getByRole("heading", { name: "End", exact: true })).toBeFocused();
    await collapse.click();
    await page.reload();
    await expect(collapse).toBeVisible();
    await expect(nav).toBeVisible();
    for (const width of [1920, 1440, 1280]) {
      await page.setViewportSize({ width, height: 768 });
      let defaultGain = 0;
      for (const preference of ["默认", "窄", "宽"]) {
        await page.getByLabel("阅读显示设置", { exact: true }).click();
        await page.getByRole("group", { name: "正文宽度", exact: true }).getByRole("radio", { name: preference, exact: true }).check();
        await page.keyboard.press("Escape");
        const expanded = await body.boundingBox();
        assert.ok(expanded);
        await collapse.click();
        await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(expanded.x, 1);
        await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(expanded.width);
        const gain = await body.evaluate(el => el.getBoundingClientRect().width) - expanded.width;
        if (preference === "默认") defaultGain = gain;
        else if (preference === "窄") expect(gain).toBeCloseTo(defaultGain, 1);
        else if (width === 1920) expect(gain - defaultGain).toBeCloseTo(100, 1);
        else assert.ok(gain > defaultGain && gain <= defaultGain + 100, "wide text uses the extra space available in a smaller window");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await expand.click();
        await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(expanded.x, 1);
        await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(expanded.width, 1);
      }
    }
  } finally {
    await browser.close();
    await web.stop();
  }
});
