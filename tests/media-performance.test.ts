import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { SITE } from "@agidawn/site";

const dir = await mkdtemp(path.join(tmpdir(), "agidawn-media-test-"));
process.env.AGIDawn_DATA_DIR = dir;
process.env.ALLOW_PRIVATE_NETWORK_FETCH = "true";
const { produceImage } = await import("@agidawn/backend/media/images");
const { renderOg } = await import("@agidawn/backend/media/og");

let imageHits = 0;
let failureHits = 0;
const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#176b75" } }).png().toBuffer();
const server = createServer(async (req, res) => {
  if (req.url === "/binary-image") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(png); }
  if (req.url === "/binary-alias") { res.writeHead(200, { "content-type": "binary/octet-stream" }); return res.end(png); }
  if (req.url === "/binary-alias-error") { res.writeHead(200, { "content-type": "binary/octet-stream" }); return res.end("<html>Not an image</html>"); }
  if (req.url === "/binary-error") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end("<html>Image not found</html>"); }
  if (req.url === "/fail") { failureHits++; res.writeHead(502); return res.end(); }
  imageHits++;
  await new Promise((resolve) => setTimeout(resolve, 60));
  res.writeHead(200, { "content-type": "image/png" });
  res.end(png);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const { closeDb } = await import("@agidawn/backend/db");
  const { stopBoss } = await import("@agidawn/backend/jobs/queue");
  await stopBoss();
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

test("simultaneous modes share original bytes, preserve dimensions and use their disk caches", async () => {
  const [thumb, full, avatar, card] = await Promise.all([produceImage(`${base}/image`, "thumb"), produceImage(`${base}/image`, "full"), produceImage(`${base}/image`, "avatar"), produceImage(`${base}/image`, "card")]);
  assert.equal(imageHits, 1);
  assert.deepEqual(await Promise.all([thumb, full, avatar, card].map(async (image) => (await sharp(image.body).metadata()).width)), [720, 800, 96, 336]);
  assert.deepEqual(await produceImage(`${base}/image`, "thumb"), thumb);
  assert.equal(imageHits, 1);
});

test("failed originals are not retried for every mode", async () => {
  await assert.rejects(produceImage(`${base}/fail`, "thumb"));
  await assert.rejects(produceImage(`${base}/fail`, "full"));
  assert.equal(failureHits, 1);
});

// A previous encoder's disk entry must not bypass today's rendition rules, refetch the source,
// rasterize a compact vector, or expose a mismatched MIME while body/type files are replaced.
test("cached oversized SVGs use current renditions without downloading them again", async () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#176b75"/><desc>${randomBytes(180000).toString("base64")}</desc></svg>`);
  const url = `${base}/cached-vector`;
  const key = createHash("sha256").update(`full|${url}`).digest("hex");
  const file = path.join(dir, "imgcache", key.slice(0, 2), key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, svg);
  await writeFile(`${file}.type`, "image/svg+xml");
  const before = imageHits;
  const first = await produceImage(url, "full");
  assert.equal(first.type, "image/webp");
  const meta = await sharp(first.body).metadata();
  assert.deepEqual([meta.width, meta.height], [1600, 900]);
  assert.ok(first.body.length < svg.length / 10);
  assert.deepEqual(await produceImage(url, "full"), first);
  // Another serving process can read the old MIME alongside the new body, or the reverse.
  await writeFile(`${file}.type`, "image/svg+xml");
  assert.deepEqual(await produceImage(url, "full"), first);
  await writeFile(file, svg);
  await writeFile(`${file}.type`, "image/webp");
  assert.deepEqual(await produceImage(url, "full"), first);
  const smallUrl = `${base}/compact-vector`;
  const smallKey = createHash("sha256").update(`full|${smallUrl}`).digest("hex");
  const smallFile = path.join(dir, "imgcache", smallKey.slice(0, 2), smallKey);
  const compact = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>');
  await mkdir(path.dirname(smallFile), { recursive: true });
  await writeFile(smallFile, compact);
  await writeFile(`${smallFile}.type`, "image/svg+xml");
  assert.deepEqual(await produceImage(smallUrl, "full"), { body: compact, type: "image/svg+xml" });
  assert.equal(imageHits, before);
});

// SVG can be much smaller over HTTP than its disk size, and its intrinsic display width is
// independent of a bitmap's pixel count. Neither may regress just to change the image format.
test("SVG preparation retains compact transfer and intrinsic display size", async () => {
  const { resizeImage } = await import("@agidawn/backend/media/images");
  const compactTransfer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#176b75"/><desc>${"compressible metadata ".repeat(10000)}</desc></svg>`);
  const smallDisplay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="34"><rect width="180" height="34" fill="#176b75"/><desc>${randomBytes(180000).toString("base64")}</desc></svg>`);
  for (const [name, body] of [["compact-transfer", compactTransfer], ["small-display", smallDisplay]] as const) {
    assert.deepEqual(await resizeImage(body, "image/svg+xml", "full"), { body, type: "image/svg+xml" });
    const url = `${base}/${name}`;
    const key = createHash("sha256").update(`full|${url}`).digest("hex");
    const file = path.join(dir, "imgcache", key.slice(0, 2), key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.type`, "image/svg+xml");
    assert.deepEqual(await produceImage(url, "full"), { body, type: "image/svg+xml" });
    assert.equal(await readFile(`${file}.prepared`, "utf8"), "original");
    assert.deepEqual(await produceImage(url, "full"), { body, type: "image/svg+xml" });
  }
});

test("concurrent cold OG requests all succeed with identical cached bytes", async () => {
  const card = { kicker: SITE.name, title: "并发渲染验证", subtitle: "同一图片只生成一次" };
  const cards = await Promise.all(Array.from({ length: 3 }, () => renderOg(card)));
  for (const result of cards) assert.deepEqual(result, cards[0]);
  assert.equal((await sharp(cards[0]!.png).metadata()).width, 1200);
});

test("successive responsive candidates reuse the completed original download", async () => {
  const before = imageHits;
  const url = `${base}/successive`;
  const small = await produceImage(url, "card");
  const large = await produceImage(url, "image-1200");
  const avatar = await produceImage(url, "avatar-48");
  assert.equal(imageHits - before, 1);
  assert.deepEqual(await Promise.all([small, large, avatar].map(async (image) => (await sharp(image.body).metadata()).width)), [336, 800, 48]);
});

test("tracking pixels are omitted from old and new bodies without removing article illustrations", async () => {
  const { sanitizeBody } = await import("@agidawn/backend/content/sanitize");
  const html = '<p>Article</p><img src="https://ids4.ad.gt/api/v1/ip_match?id=example"><img src="https://secure.adnxs.com/getuid?x=1"><img src="https://example.org/pixel" width="1" height="1"><img src="https://example.org/chart.png" width="800" height="400">';
  for (const body of [sanitizeBody(html)]) {
    assert.doesNotMatch(body, /ids4|adnxs|example.org\/pixel/);
    assert.equal((body.match(/<img\b/g) ?? []).length, 1);
    assert.match(decodeURIComponent(body), /example.org\/chart.png/);
  }
});

// Extracted Markdown can mislabel a video page as an image. Ingestion and previously saved bodies
// must exclude those images while preserving real thumbnails, icons and video links or elements.
test("video pages mislabeled as images are excluded from sanitized bodies and Markdown", async () => {
  const { sanitizeBody } = await import("@agidawn/backend/content/sanitize");
  const { markdownBody, bodyToMarkdown } = await import("@agidawn/backend/content/markdown");
  const pages = [
    "https://www.youtube.com/watch?v=example&t=1",
    "https://youtube.com/shorts/example",
    "https://m.youtube.com/watch?v=example",
    "https://www.youtube.com/shorts/example",
  ];
  const pictures = [
    "https://www.youtube.com/s/desktop/example/favicon_32x32.png",
    "https://i.ytimg.com/vi/example/hqdefault.jpg",
    "https://example.org/watch.png",
    "https://youtube.com.example.org/watch?v=example",
  ];
  const stored = [...pages, ...pictures].map((url) => `<img src="${url.replaceAll("&", "&amp;")}" alt="Image" width="800" height="400">`).join("");
  const markdown = [...pages, ...pictures].map((url) => `![Image](${url})`).join("\n\n");
  for (const html of [sanitizeBody(stored), markdownBody(markdown, "https://example.org/post")]) {
    assert.equal((html.match(/<img\b/g) ?? []).length, pictures.length, html);
    assert.doesNotMatch(decodeURIComponent(html), /https:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch|shorts)/);
  }
  assert.equal((bodyToMarkdown(stored).match(/!\[/g) ?? []).length, pictures.length);
  const video = `<a href="${pages[0]!.replaceAll("&", "&amp;")}">Watch video</a><video src="https://example.org/video.mp4" poster="${pictures[1]}"></video>`;
  for (const html of [sanitizeBody(video)]) {
    assert.match(html, /<a href="https:\/\/www\.youtube\.com\/watch/);
    assert.match(html, /<video src="https:\/\/example\.org\/video\.mp4"/);
    assert.match(decodeURIComponent(html), /i\.ytimg\.com\/vi\/example\/hqdefault\.jpg/);
  }
});
