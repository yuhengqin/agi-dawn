// Regressions: source layout becomes tall lists; chart versions duplicate values; malformed rows
// become convincing but incomplete tables; a source adapter runs without explicit configuration.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { readable, pageRules } from "@agidawn/backend/content/extract";
import { unsupportedConfig } from "@agidawn/backend/sources/config-keys";
import { bodyToMarkdown } from "@agidawn/backend/content/markdown";

const prose = "This article explains the benchmark methods, measurements and limitations with evidence. ".repeat(6);
const page = (content: string) => `<html><head><title>Benchmark</title></head><body><article><h1>Benchmark</h1><p>${prose}</p>${content}<p>${prose}</p></article></body></html>`;
const sources = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
const configured = pageRules(sources.sources.find((source: { id: string }) => source.id === "browser-use-engineering").config);
const extract = (content: string, rules = configured) => {
  const body = readable(page(content), "https://browser-use.com/posts/benchmark", rules);
  assert.ok(body);
  return body;
};
const rows = (html: string) => cheerio.load(html)("tbody tr").toArray().map(row => cheerio.load(row)("th,td").map((_, cell) => cheerio.load(cell).text()).get());
const figure = (title: string, drawing: string, legend = "") => `<figure class="odysseys2_root__fixture"><div><span><span>Fig. 1</span> ${title}</span>${legend}</div><p>Measurements for the benchmark.</p>${drawing}<figcaption>One attempt per task; same saved results.</figcaption></figure>`;
const rankRow = (name: string, mean: string, completed: string) => `<li><div><p>${name}</p><p>mean ${mean}</p></div><svg aria-hidden="true" class="bars" viewBox="0 0 100 40"><circle cx="5" cy="5" r="3"/></svg><span>${completed}</span></li>`;
const rankings = (mean = "71.2", desktopMean = mean) => `<div role="img" aria-label="Tasks fully completed, benchmark data"><div class="hidden md:block"><svg class="bars" viewBox="0 0 100 40"><text>DESKTOP_LABEL</text></svg><div style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><span>47</span><span>GPT-6<br>Astra</span><span><span>mean</span>84.6</span></div><div><span>18</span><span>Opus<br>5.5</span><span><span aria-hidden="true">mean</span>${desktopMean}<span>high</span></span></div></div></div><ol class="md:hidden" role="list">${rankRow("GPT-6 Astra", "84.6", "47")}${rankRow("Opus 5.5<span>high</span>", mean, "18")}</ol></div>`;
const judgeSvg = (second = "71.2") => `<svg class="chart" viewBox="0 0 860 382" aria-hidden="true"><g><g><text>0</text></g></g><g><text>GPT-6 Astra</text><g><circle cx="5" cy="5" r="3"/></g><text><tspan>95.6</tspan><tspan> → </tspan><tspan>84.6</tspan></text></g><g><text>Opus 5.5 <tspan>high</tspan></text><g/><text>91.6 → ${second}</text></g></svg>`;
const judges = (second = "71.2") => `<div role="img" aria-label="Mean score on the same attempts, two judges."><div class="hidden sm:block">${judgeSvg()}</div><div class="sm:hidden">${judgeSvg(second)}</div></div>`;
const legend = '<span><span><svg class="legend" width="9" height="9"><circle r="4"/></svg>Odysseys judge</span><span><svg class="legend" width="9" height="9"><circle r="4"/></svg>Odysseys2 judge</span></span>';

test('explicit desktop and light image variants are selected once without deleting unrelated pictures',()=>{
  const body=extract('<div class="not-prose"><img class="hidden h-auto w-full sm:block" src="/wide.png" alt="Flow"><img class="block h-auto w-full sm:hidden" src="/tall.png" alt="Flow"></div><div class="mdx"><img class="dark:hidden" src="/light.png" alt="Score"><img class="hidden dark:block" src="/dark.png" alt="Score"></div><p><img src="/ordinary.png" alt="Another diagram"></p>');
  assert.deepEqual(cheerio.load(body.html)('img').map((_,img)=>cheerio.load(img)('img').attr('src')).get(),['https://browser-use.com/wide.png','https://browser-use.com/light.png','https://browser-use.com/ordinary.png']);
  const different=extract('<figure><img class="hidden sm:block" src="/one.png" alt="First"><img class="sm:hidden" src="/two.png" alt="Different"></figure>');
  assert.equal(cheerio.load(different.html)('img').length,2);
});

test("Browser Use authors stay compact and retain every affiliation", () => {
  const body = extract('<div><ul aria-label="Authors"><li>Lawrence Jang <span>(CMU)</span></li><li>Alexander Yue <span>(Browser Use)</span></li></ul><p><time>Oct 27th, 2026</time><span aria-hidden="true">·</span><span>Research</span></p></div>');
  const $ = cheerio.load(body.html);
  assert.equal($("ul li").length, 0);
  assert.match($("p").filter((_, el) => $(el).text().includes("Lawrence Jang")).text(), /Lawrence Jang \(CMU\).*Alexander Yue \(Browser Use\)/);
  assert.match(body.text, /Oct 27th, 2026.*Research/);
  assert.doesNotMatch(body.text, /2026Research/);
});

test("completion charts become one table with model, score and completed tasks in each row", () => {
  const body = extract(figure("Tasks fully completed, out of 100", rankings()));
  const $ = cheerio.load(body.html);
  assert.deepEqual($("thead th").map((_, el) => $(el).text()).get(), ["Agent", "Mean rubric score", "Tasks fully completed"]);
  assert.deepEqual(rows(body.html), [["GPT-6 Astra", "84.6", "47"], ["Opus 5.5 high", "71.2", "18"]]);
  assert.equal($("figure img,figure ol").length, 0);
  assert.match($("figcaption").text(), /One attempt per task/);
  assert.doesNotMatch(body.text, /DESKTOP_LABEL/);
  assert.equal(body.quality, "ready");
  assert.match(bodyToMarkdown(body.html), /\| Opus 5.5 high \| 71.2 \| 18 \|/);
});

test("two-judge charts keep both score columns once and remove redundant legend dots", () => {
  const body = extract(figure("Same attempts, two judges", judges(), legend));
  const $ = cheerio.load(body.html);
  assert.deepEqual($("thead th").map((_, el) => $(el).text()).get(), ["Agent", "Odysseys judge", "Odysseys2 judge"]);
  assert.deepEqual(rows(body.html), [["GPT-6 Astra", "95.6", "84.6"], ["Opus 5.5 high", "91.6", "71.2"]]);
  assert.equal($("figure img").length, 0);
  assert.equal(body.quality, "ready");
});

test("effort comparison charts preserve column labels and unavailable measurements", () => {
  const svg = '<svg class="chart" viewBox="0 0 860 400"><g><text>0</text><text>25</text></g><text>low</text><text>medium</text><text>high</text><text>xhigh</text><text>max</text><g><text>Python library</text><text>30.2</text><text>27.9</text><text>33.0</text><text>33.5</text><text>n/a</text></g><g><text>BrowserCode</text><text>29.8</text><text>42.0</text><text>59.7</text><text>61.6</text><text>63.0</text></g></svg>';
  const body = extract(figure("Same model, three harnesses", `<div role="img" aria-label="Mean score by effort">${svg}</div>`));
  const $ = cheerio.load(body.html);
  assert.deepEqual($("thead th").map((_, el) => $(el).text()).get(), ["Harness", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(rows(body.html), [["Python library", "30.2", "27.9", "33.0", "33.5", "n/a"], ["BrowserCode", "29.8", "42.0", "59.7", "61.6", "63.0"]]);
  assert.equal(body.quality, "ready");
});

test("effort display versions agree when the source abbreviates Python library as Python", () => {
  const svg = (name: string) => `<svg class="chart" viewBox="0 0 860 400"><text>low</text><text>medium</text><text>high</text><text>xhigh</text><text>max</text><g><text>${name}</text><text>30.2</text><text>27.9</text><text>33.0</text><text>33.5</text><text>n/a</text></g></svg>`;
  const body = extract(figure("Same model, three harnesses", `<div role="img" aria-label="Mean score by effort"><div>${svg("Python library")}</div><div>${svg("Python")}</div></div>`));
  assert.deepEqual(rows(body.html), [["Python library", "30.2", "27.9", "33.0", "33.5", "n/a"]]);
});

test("source conversion does not expose authors or chart rows explicitly hidden by the publisher", () => {
  const authors = '<ul aria-label="Authors"><li>Visible author</li><li hidden>PRIVATE_AUTHOR</li><li><span style="display:none">PRIVATE_AFFILIATION</span>Another author</li></ul>';
  const chart = rankings().replace('</ol>', rankRow("PRIVATE_MODEL", "90", "30").replace('<li>', '<li hidden>') + '</ol>');
  const body = extract(authors + figure("Tasks fully completed, out of 100", chart));
  assert.doesNotMatch(body.text, /PRIVATE_/);
  assert.deepEqual(rows(body.html), [["GPT-6 Astra", "84.6", "47"], ["Opus 5.5 high", "71.2", "18"]]);
});

test("hidden SVG data groups do not become visible score rows", () => {
  const drawing = judges().replaceAll('<g><text>Opus 5.5 ', '<g hidden><text>PRIVATE_MODEL ');
  const body = extract(figure("Same attempts, two judges", drawing, legend));
  assert.doesNotMatch(body.text, /PRIVATE_MODEL/);
  assert.deepEqual(rows(body.html), [["GPT-6 Astra", "95.6", "84.6"]]);
});

test("table labels retain literal angle brackets without creating source HTML", () => {
  const body = extract(figure("Tasks fully completed, out of 100", rankings().replaceAll('GPT-6 Astra', 'Model &lt;img src=x onerror=alert(1)&gt;').replace('GPT-6<br>Astra', 'Model &lt;img src=x onerror=alert(1)&gt;')));
  assert.equal(cheerio.load(body.html)("img,script").length, 0);
  assert.equal(rows(body.html)[0]?.[0], "Model <img src=x onerror=alert(1)>");
});

test("completion data is not chosen when the desktop and alternate rows disagree", () => {
  const body = extract(figure("Tasks fully completed, out of 100", rankings("71.2", "70.0")));
  assert.equal(cheerio.load(body.html)("table").length, 0);
  assert.equal(body.quality, "partial");
});

test("unconfigured extraction leaves source widgets to the existing generic rules", () => {
  const content = figure("Tasks fully completed, out of 100", rankings());
  const body = extract(content, {});
  assert.equal(cheerio.load(body.html)("table").length, 0);
  assert.equal(cheerio.load(body.html)("ol li").length, 2);
});

test("bad chart rows and conflicting display versions retain explicit partial results", () => {
  for (const content of [figure("Tasks fully completed, out of 100", rankings("missing")), figure("Same attempts, two judges", judges("70.0"), legend)]) {
    const body = extract(content);
    assert.equal(cheerio.load(body.html)("table").length, 0);
    assert.equal(body.quality, "partial");
    assert.ok(body.issues.some(issue => issue.kind === "missing-figure"));
    assert.match(body.text, /One attempt per task/);
  }
});

test("body adapter configuration is explicit and rejects unknown adapter names", () => {
  for (const kind of ["rss", "web_list", "json_list"] as const) {
    assert.deepEqual(unsupportedConfig(kind, { detail: { bodyAdapter: "browser-use" } }), []);
    for (const value of ["unknown", "__proto__", "constructor", "", null, 3, ["browser-use"]]) {
      assert.deepEqual(unsupportedConfig(kind, { detail: { bodyAdapter: value } }), ["detail.bodyAdapter"]);
    }
  }
});
