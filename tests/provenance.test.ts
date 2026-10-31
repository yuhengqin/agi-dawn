// Verified original publishers are independent of discovery channels and collection schedules.
// Attribution preserves material and existing judgements, and routes new work through one pipeline.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@agidawn/backend/db";
import { QUEUES, stopBoss } from "@agidawn/backend/jobs/queue";
import { upsertMaterial } from "@agidawn/backend/content/materials";
import { publisherOwnsUrl } from "@agidawn/backend/content/provenance";
import { publishArticle } from "@agidawn/backend/publication/publish";
import { ingestItems } from "@agidawn/backend/ingest/items";
import { collectSource } from "@agidawn/backend/sources/collect";
import { createSource, updateSource } from "@agidawn/backend/admin/sources";

after(async () => { await stopBoss(); await closeDb(); });

async function source(tier: string, config = {}, firstParty = tier === "T1", opts: { kind?: string; mode?: string; enabled?: boolean } = {}) {
  const id = `provenance-${tag()}`;
  await sql`INSERT INTO sources (id, name, kind, tier, first_party, config, participation_mode, site_fulltext, next_fetch_at, enabled)
    VALUES (${id}, ${id}, ${opts.kind ?? 'rss'}, ${tier}, ${firstParty}, ${sql.json(config)}, ${opts.mode ?? 'editorial'}, true, '2100-01-01', ${opts.enabled ?? true})`;
  return id;
}

const jobs = (articleId: string) => sql<{ name: string; data: Record<string, unknown> }[]>`
  SELECT name, data FROM pgboss.job WHERE data->>'articleId' = ${articleId} AND name = ${QUEUES.extractBody}`;

test("the first external discovery uses a paused verified publisher, keeps the real discovery and queues extraction once", async () => {
  const scope = `https://www.${tag()}.example/news`;
  const official = await source("T1", { publisherUrlPrefixes: [scope], fetchPublicContent: true }, true, { enabled: false });
  const media = await source("T2");
  const url = `${scope}/release`;
  const input = { sourceId: media, items: [{ url, title: "Release", author: "HN submitter", publishedAt: new Date().toISOString() }] };
  assert.equal((await ingestItems(input)).created, 1);
  const [a] = await sql`SELECT * FROM articles WHERE url = ${url}`;
  assert.deepEqual([a!.source_id, a!.author, a!.revision, a!.body_status], [official, null, 1, "pending"]);
  assert.deepEqual((await sql`SELECT source_id FROM article_discoveries WHERE article_id = ${a!.id}`).map((d) => d.source_id), [media]);
  await ingestItems(input);
  assert.deepEqual((await jobs(a!.id)).map((j) => j.name), [QUEUES.extractBody]);
  assert.equal((await collectSource(official)).error, "paused", "publisher identity does not start its collector");
});

test("a T1 channel linking another publisher is still a discovery, not that URL's publisher", async () => {
  const scope = `https://${tag()}.example/news`;
  const official = await source("T1", { publisherUrlPrefixes: [scope] });
  const linker = await source("T1", { publisherUrlPrefixes: [`https://${tag()}.example/blog`] });
  const { articleId } = await upsertMaterial({ sourceId: linker, url: `${scope}/release`, title: "Linked release", author: "Link submitter", via: "fetch" });
  const [a] = await sql`SELECT source_id, author FROM articles WHERE id = ${articleId}`;
  assert.deepEqual([a!.source_id, a!.author], [official, null]);
  assert.deepEqual((await sql`SELECT source_id FROM article_discoveries WHERE article_id = ${articleId}`).map((d) => d.source_id), [linker]);
});

test("only an observed web-list path supplies implicit ownership; non-T1 and RSS domains never do", async () => {
  const scope = `https://${tag()}.example/news`;
  const media = await source("T2");
  const web = await source("T1", { url: scope }, true, { kind: "web_list" });
  await source("T1", { feedUrl: `${scope}/rss` });
  await source("T1_5", { publisherUrlPrefixes: [scope] }, true);
  const url = `${scope}/release`;
  const { articleId } = await upsertMaterial({ sourceId: media, url, title: "Release", via: "fetch" });
  assert.equal((await sql`SELECT source_id FROM articles WHERE id = ${articleId}`)[0]!.source_id, media);
  await upsertMaterial({ sourceId: web, url, title: "Publisher listing", via: "fetch" });
  assert.equal((await sql`SELECT source_id FROM articles WHERE id = ${articleId}`)[0]!.source_id, web);
  const own = (prefix: string, target: string) => publisherOwnsUrl({ id: web, kind: "rss", config: { publisherUrlPrefixes: [prefix] } }, target);
  assert.equal(own(scope, `${scope}/child`), true);
  for (const target of [`${scope}room/child`, scope.replace("https:", "http:"), scope.replace("https://", "https://www."), scope.replace(".example", ".example.evil"), `${scope}%2Fchild`]) assert.equal(own(scope, target), false, target);
  for (const invalid of [`${scope}?utm_source=trusted`, `${scope}#release`, scope.replace("https://", "https://user@")]) assert.equal(own(invalid, url), false, invalid);
});

test("a later verified publisher repairs source and author, preserving content and time", async () => {
  const media = await source("T2");
  const scope = `https://${tag()}.example/news`;
  const url = `${scope}/release`;
  const at = new Date("2026-09-20T00:00:00Z");
  const { articleId } = await upsertMaterial({ sourceId: media, url, title: "Original release", author: "HN submitter", bodyText: "Release body", via: "fetch", discoveredAt: at, publishedAt: at });
  await publishArticle(articleId);
  const [before] = await sql`SELECT * FROM publications WHERE article_id = ${articleId}`;
  const official = await source("T1", { publisherUrlPrefixes: [scope] });
  const correction = await upsertMaterial({ sourceId: official, url, title: "Publisher listing title", author: "Publisher team", via: "fetch" });
  const [a] = await sql`SELECT * FROM articles WHERE id = ${articleId}`;
  const [p] = await sql`SELECT * FROM publications WHERE article_id = ${articleId}`;
  assert.deepEqual([correction.articleId, correction.created, correction.revised], [articleId, false, false]);
  assert.deepEqual([a!.source_id, a!.author, a!.revision, a!.body_text], [official, "Publisher team", 1, "Release body"]);
  assert.deepEqual([p!.source_id, p!.first_party, p!.body_mode], [official, true, before!.body_mode]);
  assert.equal(p!.sort_at.toISOString(), before!.sort_at.toISOString());
  assert.equal(p!.revision, before!.revision + 1);
  assert.equal((await sql`SELECT 1 FROM article_discoveries WHERE article_id = ${articleId}`).length, 2);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE action = 'article.attribution' AND subject = ${`article:${articleId}`}`).length, 1);
  await upsertMaterial({ sourceId: media, url, title: "Aggregator changed title", author: "Another submitter", via: "fetch" });
  assert.equal((await sql`SELECT source_id FROM articles WHERE id = ${articleId}`)[0]!.source_id, official);
});

test("publisher-first discovery remains the publisher, and an unrelated T1 URL cannot take ownership", async () => {
  const scope = `https://${tag()}.example/news`;
  const official = await source("T1", { publisherUrlPrefixes: [scope] });
  const media = await source("T2");
  const url = `${scope}/release`;
  const first = await upsertMaterial({ sourceId: official, url, title: "Official", author: "Team", via: "fetch" });
  await upsertMaterial({ sourceId: media, url, title: "Aggregator", via: "fetch" });
  assert.equal((await sql`SELECT source_id FROM articles WHERE id = ${first.articleId}`)[0]!.source_id, official);
  const otherUrl = `${scope}room/release`;
  const other = await upsertMaterial({ sourceId: media, url: otherUrl, title: "Different publication", via: "fetch" });
  await upsertMaterial({ sourceId: official, url: otherUrl, title: "Link from official feed", via: "fetch" });
  assert.equal((await sql`SELECT source_id FROM articles WHERE id = ${other.articleId}`)[0]!.source_id, media);
  assert.equal(publisherOwnsUrl({ id: official, kind: "rss", config: { feedUrl: "https://shared.example/feed" } }, "https://shared.example/other-author/post"), false);
  assert.equal(publisherOwnsUrl({ id: official, kind: "web_list", config: { url: "https://shared.example/one-author" } }, "https://shared.example/other-author/post"), false);
});

test("ambiguous registered publishers do not silently choose a source", async () => {
  const media = await source("T2");
  const scope = `https://${tag()}.example/news`;
  const config = { publisherUrlPrefixes: [scope] };
  const one = await source("T1", config);
  const two = await source("T1", config);
  const url = `${scope}/release`;
  const { articleId } = await upsertMaterial({ sourceId: media, url, title: "Release", via: "fetch" });
  await sql`INSERT INTO article_discoveries (article_id, source_id, via) VALUES (${articleId}, ${one}, 'fetch')`;
  await upsertMaterial({ sourceId: two, url, title: "Release", via: "fetch" });
  assert.equal((await sql`SELECT source_id FROM articles WHERE id = ${articleId}`)[0]!.source_id, media);
});

test("source edits derive the first-party flag from tier", async () => {
  const id = await source("T1_5", {}, true);
  const { articleId } = await upsertMaterial({ sourceId: id, url: `https://example.com/${tag()}`, title: "Official social announcement", via: "fetch" });
  await publishArticle(articleId);
  assert.equal((await sql`SELECT first_party FROM publications WHERE article_id = ${articleId}`)[0]!.first_party, false);
  const [s] = await sql`SELECT updated_at FROM sources WHERE id = ${id}`;
  const updated = await updateSource(id, { version: s!.updated_at.toISOString(), patch: { tier: "T1", first_party: false } }, "test");
  assert.equal(updated!.first_party, true);
  const created = await createSource({ id: `provenance-create-${tag()}`, name: "Official person", kind: "external", config: {}, tier: "T1_5", first_party: true }, "test");
  assert.equal(created.created && created.source!.first_party, false);
});
