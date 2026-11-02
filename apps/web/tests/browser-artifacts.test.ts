// A child test fails on purpose; its parent verifies that closing the browser does not lose CI evidence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("a failed browser test retains a screenshot and page metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agidawn-browser-artifacts-"));
  try {
    const helper = pathToFileURL(path.resolve(import.meta.dirname, "browser.ts")).href;
    const fixture = path.join(directory, "intentional-failure.test.ts");
    await writeFile(fixture, `
      import assert from "node:assert/strict";
      import { test } from "node:test";
      import { chromium } from ${JSON.stringify(helper)};
      test("intentional failure", async () => {
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();
          await page.setContent("<title>Artifact probe</title><h1>Synthetic evidence</h1>");
          assert.fail("intentional failure");
        } finally { await browser.close(); }
      });
    `);
    const artifacts = path.join(directory, "artifacts");
    const env: NodeJS.ProcessEnv = { ...process.env, WEB_TEST_ARTIFACTS: artifacts };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--test", fixture], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 1, output);

    const [run] = await (await import("node:fs/promises")).readdir(artifacts);
    assert.ok(run, output);
    const manifest = JSON.parse(await readFile(path.join(artifacts, run!, "pages.json"), "utf8")) as {
      test: string;
      pages: Array<{ title: string; file: string }>;
    };
    assert.equal(manifest.test, "intentional failure");
    assert.equal(manifest.pages.length, 1);
    assert.equal(manifest.pages[0]!.title, "Artifact probe");
    const png = await readFile(path.join(artifacts, run!, manifest.pages[0]!.file));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(png.length > 100);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
