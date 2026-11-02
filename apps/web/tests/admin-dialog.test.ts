import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "./browser.ts";
import type { AdminSettings, Timestamp } from "@agidawn/contracts/admin";
import { fakeApi, startWebServer, visit, type WebServer } from "./web-server.ts";

for (const engine of [chromium, webkit]) test(`reason dialog contains focus and preserves the budget submission contract (${engine.name()})`, async () => {
  const browser = await engine.launch();
  let web: WebServer | undefined, release: (() => void) | undefined;
  let fail = true;
  const commands: unknown[] = [];
  const settings: AdminSettings = {
    contact: { wechatQr: null, feishuQr: null },
    budgets: [{ service: "llm", per_minute: 10, per_hour: 100, per_day: 1000, note: null, updated_at: "2026-10-04T08:00:00.000Z" as Timestamp, used_day: 0, used_hour: 0 }],
  };
  try {
    web = await startWebServer(fakeApi(async (url, res, req) => {
      if (url.pathname === "/api/admin/me") return { name: "Fixture admin", csrf: "test-csrf", dev: false };
      if (url.pathname === "/api/admin/nav-counts") return {};
      if (url.pathname === "/api/admin/settings") return settings;
      if (url.pathname === "/api/admin/budgets/llm" && req.method === "PUT") {
        assert.equal(req.headers["x-csrf-token"], "test-csrf");
        assert(req.headers["idempotency-key"]);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        commands.push(JSON.parse(Buffer.concat(chunks).toString()));
        await new Promise<void>(resolve => { release = resolve; });
        if (fail) { res.statusCode = 409; return { detail: "预算已变化，请核对后重试" }; }
        return { ok: true };
      }
    }));
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // Record before navigation so failed dismissals can be diagnosed without pausing the interactions.
    await page.addInitScript(() => {
      const events: Array<Record<string, unknown>> = [];
      (globalThis as typeof globalThis & { __reasonDialogEvents?: typeof events }).__reasonDialogEvents = events;
      const describe = (target: EventTarget | null) => target instanceof Element
        ? { tag: target.tagName, role: target.getAttribute("role"), label: target.getAttribute("aria-label"), state: target.getAttribute("data-state"), classes: target.getAttribute("class") }
        : null;
      const record = (event: Record<string, unknown>) => {
        events.push({ at: performance.now(), ...event });
        if (events.length > 100) events.shift();
      };
      for (const type of ["keydown", "pointerdown", "click", "dismissableLayer.pointerDownOutside", "animationstart", "animationend", "animationcancel"]) {
        const capture = (event: Event) => {
          if (event instanceof KeyboardEvent && !["Escape", "Tab"].includes(event.key)) return;
          if (event instanceof AnimationEvent && !(event.target instanceof Element && event.target.matches('[role="dialog"], .reason-dialog-overlay'))) return;
          record({ type, phase: event.eventPhase, target: describe(event.target), prevented: event.defaultPrevented,
            ...(event instanceof KeyboardEvent ? { key: event.key } : {}),
            ...(event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : {}),
            ...(event instanceof AnimationEvent ? { animation: event.animationName } : {}),
          });
        };
        document.addEventListener(type, capture, true);
        window.addEventListener(type, capture);
      }
      new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.target instanceof Element && mutation.target.matches('[role="dialog"], .reason-dialog-overlay')) {
            record({ type: "state", target: describe(mutation.target), previous: mutation.oldValue });
          }
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-state"], attributeOldValue: true });
    });
    await visit(page, web.origin + "/admin/settings");
    await page.getByRole("spinbutton").first().fill("20");
    const opener = page.getByRole("button", { name: "保存", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog");
    const reason = dialog.getByRole("textbox");
    const save = dialog.getByRole("button", { name: "保存", exact: true });
    const cancel = dialog.getByRole("button", { name: "取消", exact: true });
    await expect(reason).toBeFocused();
    await reason.fill("   ");
    await expect(save).toBeDisabled();
    assert.equal(commands.length, 0);
    await reason.fill("  核实后调整预算  ");
    await save.focus();
    await page.keyboard.press("Tab");
    await expect(reason).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(save).toBeFocused();
    await expect(dialog).toHaveAccessibleName("调整 llm 的请求上限");
    await expect(dialog).toHaveAccessibleDescription(/超过后请求暂停/);
    await save.click();
    await expect.poll(() => commands.length).toBe(1);
    await expect(save).toBeDisabled();
    await expect(dialog).toBeVisible();
    assert.deepEqual(commands[0], { perMinute: 20, perHour: 100, perDay: 1000, reason: "核实后调整预算" });
    release!();
    await expect(save).toBeEnabled();
    await expect(dialog).toBeVisible();
    await expect(reason).toHaveValue("  核实后调整预算  ");
    fail = false;
    await save.click();
    await expect.poll(() => commands.length).toBe(2);
    release!();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    assert.deepEqual(commands[1], commands[0]);

    for (const dismiss of ["escape", "cancel", "outside"] as const) {
      await opener.click();
      await expect(reason).toHaveValue("");
      await expect(reason).toBeFocused();
      await reason.fill("取消的草稿");
      if (dismiss === "escape") await page.keyboard.press("Escape");
      else if (dismiss === "cancel") await cancel.click();
      else await page.mouse.click(1400, 40);
      try {
        await expect(dialog, `${engine.name()}: close via ${dismiss}`).toHaveCount(0);
      } catch (error) {
        const evidence = await page.evaluate(() => ({
          events: (globalThis as typeof globalThis & { __reasonDialogEvents?: unknown[] }).__reasonDialogEvents,
          targetAtOutsideClick: document.elementFromPoint(1400, 40)?.getAttribute("class"),
          nodes: [...document.querySelectorAll('[role="dialog"]')].flatMap(dialog => [dialog.parentElement, dialog]).filter((node): node is HTMLElement => node instanceof HTMLElement).map(node => ({
            role: node.getAttribute("role"), state: node.getAttribute("data-state"), rect: node.getBoundingClientRect().toJSON(),
            opacity: getComputedStyle(node).opacity, animation: getComputedStyle(node).animationName,
            animations: node.getAnimations().map(animation => ({ state: animation.playState, time: String(animation.currentTime) })),
          })),
        })).catch(evidenceError => ({ error: String(evidenceError) }));
        console.error("Reason dialog dismissal evidence", JSON.stringify({ engine: engine.name(), dismiss, evidence }));
        throw error;
      }
      await expect(opener).toBeFocused();
    }
    assert.equal(commands.length, 2, "dismissal never submits a command");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await opener.click();
    await expect(reason).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    assert.equal(web.logs(), "");
  } finally {
    release?.();
    await browser.close();
    await web?.stop();
  }
});
