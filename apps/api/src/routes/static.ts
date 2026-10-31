// Discovery and static files: sitemap, the site's public files (robots.txt, security.txt, the web
// manifest), icons, the IndexNow key and the about page's contact codes.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SITE } from "@agidawn/site";
import { CONTACT_ALIASES } from "@agidawn/contracts/http-policy";
import { REPO_ROOT, config } from "@agidawn/backend/config";
import { applyPublicHeaders, sendTextWithEtag } from "../http/respond.ts";
import { loadSitemap } from "@agidawn/backend/publication/sitemap";
import { loadContact } from "@agidawn/backend/site/contact";

const PUBLIC = path.join(REPO_ROOT, "site/public");
/** The site's brand files (site/brand/), and how long its icons are cached. */
const BRAND = path.join(REPO_ROOT, "site/brand");
const ICON_CACHE = "public, max-age=2592000, stale-while-revalidate=604800";

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=UTF-8",
  ".txt": "text/plain; charset=UTF-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

/**
 * A public file's `{{…}}` placeholders: the site's name, address, description, tagline and locale, the
 * locale (JSON-escaped in JSON files).
 */
function fillPlaceholders(text: string, json: boolean): string {
  const values: Record<string, string> = {
    siteName: SITE.name,
    siteUrl: config.siteUrl,
    description: SITE.description,
    tagline: SITE.tagline,
    locale: SITE.locale,
  };
  const filled = text.replace(/\{\{(\w+)\}\}/g, (all, key: string) => {
    const value = values[key];
    if (value === undefined) return all;
    return json ? JSON.stringify(value).slice(1, -1) : value;
  });
  return filled;
}

interface Entry {
  body: Buffer;
  etag: string;
}

const etagOf = (body: Buffer) => `W/"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;

const fileCache = new Map<string, Entry & { mtime: number }>();

/** A file's bytes and ETag, read again when it changes; `fill` fills in a public file's placeholders. */
async function loadFile(file: string, fill = false, cache=true): Promise<Entry> {
  const s = await stat(file);
  const cached = cache?fileCache.get(file):undefined;
  if (cached && cached.mtime === s.mtimeMs) return cached;
  let body = await readFile(file);
  if (fill && body.includes("{{")) body = Buffer.from(fillPlaceholders(body.toString("utf8"), /\.(json|webmanifest)$/.test(file)));
  const entry = { body, etag: etagOf(body), mtime: s.mtimeMs };
  if(cache)fileCache.set(file, entry);
  return entry;
}

function sendEntry(req: FastifyRequest, reply: FastifyReply, entry: Entry, opts: { type: string; cacheControl: string; publicApi?: boolean }) {
  if (opts.publicApi) applyPublicHeaders(reply);
  reply.header("Content-Type", opts.type);
  reply.header("Cache-Control", opts.cacheControl);
  reply.header("ETag", entry.etag);
  if (req.headers["if-none-match"] === entry.etag) return reply.code(304).send();
  return reply.send(entry.body);
}

/** A file's bytes with an ETag (304 when it matches), its type from the extension unless given; a missing one is a 404. Modules serve their own files with it. */
export async function sendFile(req: FastifyRequest, reply: FastifyReply, file: string, opts: { type?: string; cacheControl: string; publicApi?: boolean; fill?: boolean; cache?:boolean }) {
  let entry;
  try {
    entry = await loadFile(file, opts.fill,opts.cache);
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  }
  return sendEntry(req, reply, entry, { type: opts.type ?? TYPES[path.extname(file)] ?? "application/octet-stream", cacheControl: opts.cacheControl, publicApi: opts.publicApi });
}

export function registerStatic(app: FastifyInstance) {
  app.get("/sitemap.xml", async (req, reply) => {
    try {
      const { xml, expiresAt } = await loadSitemap();
      const seconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      return sendTextWithEtag(req, reply, xml, { etagPrefix: "sitemap", cacheControl: seconds > 0 ? `public, max-age=0, s-maxage=${seconds}, must-revalidate` : "no-store", contentType: "application/xml" });
    } catch (error) {
      req.log.error({ err: error }, "sitemap unavailable");
      return reply.code(503).header("Retry-After", "300").header("Cache-Control", "no-store").send("Sitemap temporarily unavailable");
    }
  });


  // The site's public files (site/public/), placeholders filled in; one the site does not have is a 404.
  app.get("/robots.txt", (req, reply) => sendFile(req, reply, path.join(PUBLIC, "robots.txt"), { cacheControl: "public, max-age=3600", fill: true }));
  app.get("/.well-known/security.txt", (req, reply) => sendFile(req, reply, path.join(PUBLIC, ".well-known/security.txt"), { cacheControl: "public, max-age=86400", fill: true }));
  app.get("/manifest.webmanifest", (req, reply) => sendFile(req, reply, path.join(PUBLIC, "manifest.webmanifest"), { cacheControl: "public, max-age=86400, stale-while-revalidate=604800", fill: true }));

  // IndexNow proves the key by a file at the site root named after it (INDEXNOW_KEY).
  if (config.indexNowKey) {
    const key: Entry = { body: Buffer.from(config.indexNowKey), etag: etagOf(Buffer.from(config.indexNowKey)) };
    app.get(`/${config.indexNowKey}.txt`, (req, reply) => sendEntry(req, reply, key, { type: TYPES[".txt"]!, cacheControl: "public, max-age=3600" }));
  }

  // The site's icons (site/brand/): the standard ones, then any others it keeps at the root.
  for (const icon of ["favicon.ico", "icon.png", "icon-192.png", "apple-icon.png", "logo.svg", ...SITE.rootIcons]) {
    app.get(`/${icon}`, (req, reply) => sendFile(req, reply, path.join(BRAND, icon), { cacheControl: ICON_CACHE }));
  }

  // Contact codes' root addresses linked from outside lead to the codes the about page shows now
  // (replacing a code changes its file name).
  for (const { slot, file } of CONTACT_ALIASES) {
    app.get(`/${file}`, async (_req, reply) => {
      const contact = await loadContact();
      return reply.code(302).header("Location", contact[`${slot}Qr`]).header("Cache-Control", "public, max-age=3600").send();
    });
  }

  // Contact codes on the about page: uploaded in the admin (content-hashed names), or shipped in the pack.
  app.get("/contact/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^[\w.-]+\.(png|jpg|jpeg|webp)$/.test(file)) return reply.code(404).send();
    const hashed = /-[0-9a-f]{8}\./.test(file);
    const cacheControl = hashed ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    const uploaded = path.join(config.dataDir, "uploads", file);
    const target = (await stat(uploaded).then(() => true, () => false)) ? uploaded : path.join(BRAND, "contact", file);
    return sendFile(req, reply, target, { cacheControl });
  });
}
