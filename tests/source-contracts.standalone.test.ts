// The report distinguishes actionable parser/filter drift from an incomplete network check without live services.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSourceContracts, renderSourceContractReport, type ContractSource } from "../scripts/check-source-contracts.ts";
import { HttpStatusError } from "@agidawn/backend/lib/http-fetch";
import { FetchError, type Candidate } from "@agidawn/backend/sources/types";

const source = (id: string, kind: ContractSource["kind"], config: Record<string, unknown>): ContractSource => ({
  id,
  name: `Source ${id}`,
  kind,
  config,
  participation_mode: "editorial",
});
const candidate = (url: string, categories?: string[]): Candidate => ({
  url,
  title: "Public fixture",
  author: null,
  publishedAt: null,
  publicationTime: null,
  excerpt: null,
  bodyHtml: null,
  bodyText: null,
  bodyStatus: "pending",
  media: [],
  raw: {},
  ...(categories ? { categories } : {}),
});

test("production admission filters decide whether a readable listing still satisfies the source contract", async () => {
  const sources = [
    source("engineering", "rss", { feedUrl: "https://example.org/feed", allowCategories: ["Engineering"] }),
    source("blog", "web_list", { url: "https://example.org/blog", allowUrlPrefixes: ["https://example.org/blog/"] }),
  ];
  const first = await checkSourceContracts(sources, {
    now: new Date("2026-11-01T00:00:00Z"),
    probe: async row => row.id === "engineering"
      ? [candidate("https://example.org/news", ["News"]), candidate("https://example.org/engineering", ["Engineering"])]
      : [candidate("https://example.org/blog/post")],
  });
  assert.equal(first.status, "unchanged");
  assert.equal(first.checkedAt, "2026-11-01T00:00:00.000Z");
  assert.deepEqual(first.results.map(result => [result.id, result.parsed, result.admitted]), [["blog", 1, 1], ["engineering", 2, 1]]);

  // New articles and counts do not repeatedly update an unchanged semantic Issue.
  const second = await checkSourceContracts(sources, {
    probe: async row => row.id === "engineering"
      ? [candidate("https://example.org/another", ["Engineering"])]
      : [candidate("https://example.org/blog/new"), candidate("https://example.org/blog/next")],
  });
  assert.equal(second.fingerprint, first.fingerprint);
  assert.match(renderSourceContractReport(first), /只读公开列表检查/);
});

test("parser and filter drift request review while transport failures never look like recovery", async () => {
  const sources = [
    source("changed", "rss", { feedUrl: "https://example.org/changed" }),
    source("filtered", "web_list", { url: "https://example.org/blog", allowUrlPrefixes: ["https://example.org/expected/"] }),
    source("missing", "json_list", { url: "https://example.org/missing", titlePaths: ["title"] }),
    source("offline", "rss", { feedUrl: "https://example.org/offline" }),
  ];
  const report = await checkSourceContracts(sources, {
    probe: async row => {
      if (row.id === "changed") throw new FetchError("no items matched (html)");
      if (row.id === "filtered") return [candidate("https://example.org/other/post")];
      if (row.id === "missing") throw new HttpStatusError(404, "HTTP 404");
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }) });
    },
  });
  assert.equal(report.status, "review-required");
  assert.deepEqual(report.results.map(result => [result.id, result.status]), [
    ["changed", "review-required"],
    ["filtered", "review-required"],
    ["missing", "check-failed"],
    ["offline", "check-failed"],
  ]);
  assert.match(report.results.find(result => result.id === "missing")!.reason, /404/);
  assert.equal(report.results.find(result => result.id === "offline")!.reason, "network-econnreset");
  assert.match(renderSourceContractReport(report), /网络、HTTP 或检查器错误属于检查未完成/);
});

test("credentialed, paid, non-GET and non-public probe configurations are refused before any request", async () => {
  let calls = 0;
  const sources = [
    source("private", "rss", { feedUrl: "http://127.0.0.1/feed" }),
    source("paid", "web_list", { url: "https://r.jina.ai/https://example.org/blog" }),
    source("headers", "json_list", { url: "https://api.github.com/repos/example/example/contents", headers: { authorization: "secret" } }),
    source("write", "json_list", { url: "https://example.org/items", method: "POST" }),
  ];
  const report = await checkSourceContracts(sources, { probe: async () => { calls++; return []; } });
  assert.equal(calls, 0);
  assert.equal(report.status, "check-failed");
  assert.ok(report.results.every(result => result.status === "check-failed"));
  assert.ok(report.results.every(result => !/secret/.test(result.reason)));
});
