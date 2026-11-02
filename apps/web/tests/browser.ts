// CI-only failure evidence for the node:test + Playwright suite. Pages and APIs in these tests are synthetic.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import {
  chromium as chromiumBase,
  webkit as webkitBase,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from "@playwright/test";

export { expect };

interface Capture {
  browser: string;
  url: string;
  title: string;
  png: Buffer;
}

interface TestArtifacts {
  captures: Capture[];
}

const contexts = new Set<BrowserContext>();
const trackedContexts = new WeakSet<BrowserContext>();
const capturedPages = new WeakSet<Page>();
let current: TestArtifacts | undefined;

async function captureContext(context: BrowserContext): Promise<void> {
  if (!current || !process.env.WEB_TEST_ARTIFACTS) return;
  for (const page of context.pages()) {
    if (page.isClosed() || capturedPages.has(page)) continue;
    try {
      const [png, title] = await Promise.all([
        page.screenshot({ timeout: 5_000 }),
        page.title().catch(() => ""),
      ]);
      current.captures.push({ browser: context.browser()?.browserType().name() ?? "unknown", url: page.url(), title, png });
      capturedPages.add(page);
    } catch (error) {
      // Evidence collection must not hide the test's original result or prevent the browser from closing.
      console.error(`Could not capture web test page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function trackContext(context: BrowserContext): BrowserContext {
  if (trackedContexts.has(context)) return context;
  trackedContexts.add(context);
  contexts.add(context);
  context.on("close", () => contexts.delete(context));
  const close = context.close.bind(context);
  context.close = async (...args: Parameters<BrowserContext["close"]>) => {
    await captureContext(context);
    return close(...args);
  };
  return context;
}

function trackBrowser(browser: Browser): Browser {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args: Parameters<Browser["newContext"]>) => trackContext(await newContext(...args));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args: Parameters<Browser["newPage"]>) => {
    const page = await newPage(...args);
    trackContext(page.context());
    return page;
  };
  const close = browser.close.bind(browser);
  browser.close = async (...args: Parameters<Browser["close"]>) => {
    for (const context of browser.contexts()) await captureContext(context);
    return close(...args);
  };
  return browser;
}

function launcher(type: BrowserType) {
  return {
    name: () => type.name(),
    launch: async (...args: Parameters<BrowserType["launch"]>) => trackBrowser(await type.launch(...args)),
  };
}

export const chromium = launcher(chromiumBase);
export const webkit = launcher(webkitBase);

beforeEach(() => {
  current = { captures: [] };
});

afterEach(async test => {
  const completed = current;
  const root = process.env.WEB_TEST_ARTIFACTS;
  if (!completed || test.passed || !root) {
    current = undefined;
    return;
  }

  // Most tests close their own browser in finally; shared-browser suites can still have an open page here.
  for (const context of [...contexts]) await captureContext(context);
  current = undefined;
  if (completed.captures.length === 0) return;

  const file = path.basename(test.filePath ?? "web-test", ".test.ts");
  const id = createHash("sha256").update(test.fullName).digest("hex").slice(0, 12);
  const directory = path.join(root, `${file}-${id}`);
  await mkdir(directory, { recursive: true });
  const pages: Array<Omit<Capture, "png"> & { file: string }> = [];
  for (const [index, capture] of completed.captures.entries()) {
    const filename = `${String(index + 1).padStart(2, "0")}.png`;
    await writeFile(path.join(directory, filename), capture.png);
    pages.push({ browser: capture.browser, url: capture.url, title: capture.title, file: filename });
  }
  await writeFile(path.join(directory, "pages.json"), JSON.stringify({ test: test.fullName, pages }, null, 2) + "\n");
  console.error(`Web failure artifacts: ${directory}`);
});
