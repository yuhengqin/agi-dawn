// Reading page long titles, URLs and code must not stretch phone or desktop layouts.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, webkit, expect, type Browser, type Page } from "@playwright/test";
import { fakeApi, feedItem, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

const longText = "查看完整说明 https://example.org/announcements/" + "a".repeat(100) + "。";
const longTitle = "一条很长的标题".repeat(30);
const item = feedItem({ id: "width-fixture", title: longTitle, summary: longText });
const detail = itemDetail({ ...item, bodyHtml: "<p>" + longText + "</p><pre><code>" + ("longword".repeat(60)) + "</code></pre>" });

const api = fakeApi(url => {
  const p = url.pathname;
  if (p === "/api/site/articles") return { items: [item], total: 1, page: 1, limit: 25, pageCount: 1 };
  if (p === "/api/site/sources") return { items: [] };
  if (p === "/api/site/topics") return { groups: [], topics: [] };
  if (p === "/api/site/categories") return { items: [{ id: "uncategorized", name: "待分类" }] };
  if (p === "/api/site/items/width-fixture") return detail;
});
let web: WebServer;
let chrome: Browser;
let safari: Browser;
before(async () => {
  web = await startWebServer(api);
  chrome = await chromium.launch({ channel: "chromium" });
  safari = await webkit.launch();
});
after(async () => { await chrome?.close(); await safari?.close(); await web?.stop(); });

/** Pages whose long titles, URLs and code need to stay within the screen. */
const PAGES: Array<{ path: string; ready: (page: Page, width: number) => Promise<void> }> = [
  { path: "/", ready: (page: Page) => expect(page.getByRole("link", { name: longTitle, exact: true })).toBeVisible() },
  { path: "/items/width-fixture", ready: (page: Page) => expect(page.getByRole("heading", { name: longTitle, exact: true })).toBeVisible() },
];

/**
 * What reaches past the screen's right edge: the page's own scrolling width (overflowing text), and boxes
 * drawn past it outside the ones that scroll or clip their content sideways.
 */
function pastEdge(width: number): string[] {
  const clipped = (el: Element) => {
    for (let box = el.parentElement; box; box = box.parentElement) if (getComputedStyle(box).overflowX !== "visible") return true;
    return false;
  };
  const page = document.documentElement.scrollWidth;
  return [
    ...(page > width + 1 ? [`the page scrolls to ${page}px`] : []),
    ...[...document.body.querySelectorAll("*")].flatMap((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.right > width + 1 && !clipped(el) ? [`${el.tagName.toLowerCase()} "${el.textContent!.slice(0, 20)}" ends at ${Math.round(box.right)}px`] : [];
    }),
  ];
}

for (const engine of ["Chromium", "WebKit"] as const) test(`${engine}: pages stay within the screen at 320, 393 and 1024 pixels`, async () => {
  for (const width of [393, 320, 1024]) {
    const context = await (engine === "Chromium" ? chrome : safari).newContext({ viewport: { width, height: 873 }, isMobile: width < 961, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      for (const { path, ready } of PAGES) {
        await visit(page, web.origin + path);
        await ready(page, width);
        assert.deepEqual(await page.evaluate(pastEdge, width), [], `${path} at ${width}px`);
      }
    } finally { await context.close(); }
  }
});
