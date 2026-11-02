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
      await expect(dialog).toHaveCount(0);
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
