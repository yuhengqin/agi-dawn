// Failure cases: a prompt's header-actions class makes Readability discard its text; a bar chart's
// CSS disappears and leaves unrelated labels/values; normalization exposes hidden content or scripts.
// The widgets are the source's to declare (config.detail.preserve), and a rule it cannot run is refused
// instead of silently changing nothing; the engine knows no site's classes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { pageRules, readable } from "@agidawn/backend/content/extract";
import { unsupportedConfig } from "@agidawn/backend/sources/config-keys";
import { bodyToMarkdown } from "@agidawn/backend/content/markdown";
import { sanitizeBody } from "@agidawn/backend/content/sanitize";

const prose = "The article explains how to maintain software, with practical examples and measurements. ".repeat(6);
const page = (content: string) => `<html><head><title>Maintenance</title></head><body><article><h1>Maintenance</h1><p>${prose}</p>${content}<p>${prose}</p></article></body></html>`;
const preserve = [
  { selector: ".not-prose:has(.prompt-scroll__content)", as: "pre" as const, code: ".prompt-scroll__content", caption: "[data-prompt-model]" },
  { selector: "figure .comparison-panels", as: "table" as const },
];
const extract = (content: string) => {
  const body = readable(page(content), "https://publisher.example/article", { preserve });
  assert.ok(body);
  return body;
};
const prompt = (attributes = "") => `<div class="not-prose" ${attributes}><div><div class="prompt-scroll-frame"><div class="prompt-scroll prompt-scroll--header-actions"><div class="prompt-scroll__content whitespace-pre-wrap">Review &lt;files&gt; &amp; preserve spelling.\n  Keep this indentation.</div></div></div><div class="prompt-actions"><span data-prompt-model="true">Model A</span><button>Copy prompt</button><script>untrusted()</script></div></div></div>`;

test("custom prompt blocks survive extraction and translation verbatim, without their controls", () => {
  const body = extract(prompt());
  const $ = cheerio.load(body.html);
  assert.equal($("pre code").text(), "Review <files> & preserve spelling.\n  Keep this indentation.");
  assert.ok(body.text.includes("Model A"));
  assert.doesNotMatch(body.html, /Copy prompt|untrusted|<script|<files>/);
  assert.match(bodyToMarkdown(body.html), /```[\s\S]*Review <files> & preserve spelling\.\n  Keep this indentation\.[\s\S]*```/);
});

test("hidden prompt components remain hidden", () => {
  for (const attributes of ['hidden', 'aria-hidden="true"', 'style="DISPLAY:NONE !important"']) {
    assert.doesNotMatch(extract(prompt(attributes)).html, /Review &lt;files&gt;/);
  }
});

test("comparison panels keep metric headings, model/value relationships and the source note", () => {
  const panel = (metric: string, values: string[]) => `<section class="comparison-panel"><p class="metric-label">${metric}</p><dl class="comparison-rows">${values.map((value, i) => `<div class="comparison-row"><dt>Model ${i + 1}</dt><dd><span aria-hidden="true">DECORATION</span><span class="result-value">${value}</span></dd></div>`).join("")}</dl><div class="axis" aria-hidden="true">AXIS</div></section>`;
  const body = extract(`<figure><figcaption>Cleanup comparison</figcaption><div class="comparison-panels">${panel("API cost", ["$109.06", "$15.12", "$5.27"])}${panel("Findings", ["142", "131", "86"])}</div><p>Costs include follow-up turns.</p></figure>`);
  const $ = cheerio.load(body.html);
  assert.deepEqual($("thead th").map((_, el) => $(el).text()).get(), ["", "API cost", "Findings"]);
  assert.deepEqual($("tbody tr").toArray().map(el => $(el).children().map((_, cell) => $(cell).text()).get()), [
    ["Model 1", "$109.06", "142"], ["Model 2", "$15.12", "131"], ["Model 3", "$5.27", "86"],
  ]);
  assert.match(body.html, /Cleanup comparison/);
  assert.match(body.html, /Costs include follow-up turns/);
  assert.doesNotMatch(body.html, /DECORATION|AXIS/);
  assert.match(bodyToMarkdown(body.html), /\| Model 1 \| \$109.06 \| 142 \|/);
  assert.equal(cheerio.load(extract('<dl><dt>Term</dt><dd>Ordinary definition</dd></dl>').html)("dl").length, 1);
});

test("a source declares only widget rules extraction can run", () => {
  assert.deepEqual(unsupportedConfig("web_list", { detail: { preserve } }), []);
  for (const rule of [{ as: "pre" }, { selector: " ", as: "pre" }, { selector: "figure", as: "chart" }, { selector: "figure", as: "table", code: "pre" },
    { selector: "div", as: "pre", caption: 3 }, { selector: "div", as: "pre", label: "span" }, "div"]) {
    assert.deepEqual(unsupportedConfig("web_list", { detail: { preserve: [rule] } }), ["detail.preserve"], JSON.stringify(rule));
  }
  assert.deepEqual(unsupportedConfig("rss", { detail: { preserve: { selector: "div", as: "pre" } } }), ["detail.preserve"]);
});

test("technical diagrams and MathML survive while unsupported figures are reported",()=>{
  const body=extract('<figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><title>Agent flow</title><rect x="1" y="1" width="180" height="60" fill="#ddd"/><text x="12" y="30">Agent memory</text><script>unsafe()</script></svg><figcaption>Memory flow</figcaption></figure><p><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></p><pre data-language="typescript"><code>const memory = 1;</code></pre>');
  const $=cheerio.load(body.html);
  assert.match($('figure img').attr('src')??'',/^data:image\/svg\+xml;base64,/);
  const svg=Buffer.from(($('figure img').attr('src')??'').split(',')[1]??'',"base64").toString();
  assert.match(svg,/Agent memory/);
  assert.doesNotMatch(svg,/<script|unsafe\(\)/);
  assert.equal($("math mfrac").length,1);
  assert.equal($("pre code").attr("class"),"language-typescript");
  const unsupported=extract('<figure><svg><foreignObject><p>Interactive chart</p></foreignObject></svg></figure>');
  assert.equal(unsupported.quality,"partial");
  assert.ok(unsupported.issues.some(issue=>issue.kind==="missing-figure"));
});

test("heading permalink icons do not make an article partial",()=>{
  const icon='<svg viewBox="0 0 24 24" class="section-link" fill="none" stroke="currentColor"><path d="M10 13L14 9"/></svg>';
  const body=extract(`<h2 id="results">Results<a href="#results" aria-label="Link to results">${icon}</a></h2><h3 id="details"><a href="https://publisher.example/article#details">${icon}Details</a></h3>`);
  const $=cheerio.load(body.html);
  assert.equal($("h2").text(),"Results");
  assert.equal($("h3").text(),"Details");
  assert.equal($("img").length,0);
  assert.equal(body.quality,"ready");
  assert.deepEqual(body.issues,[]);
});

test("heading diagrams and styled figure legends still report lost styling",()=>{
  const body=extract('<h2 id="results">Results<a href="#results"><svg role="img" aria-label="Score trend" viewBox="0 0 120 40" class="chart"><path d="M0 40L120 0"/></svg></a></h2><figure><p><svg aria-hidden="true" class="legend" viewBox="0 0 10 10"><circle class="series" cx="5" cy="5" r="4"/></svg>Completed tasks</p></figure>');
  const $=cheerio.load(body.html);
  assert.equal($('h2 img[alt="Score trend"]').length,1);
  assert.equal($("figure img").length,1);
  assert.match(body.text,/Completed tasks/);
  assert.equal(body.quality,"partial");
  assert.ok(body.issues.some(issue=>issue.kind==="missing-figure"));
});

test('declared source code components preserve indentation and the declared language',()=>{
  const body=readable(page('<div class="publisher-code"><button>Copy</button><pre><code class="language-typescript">  const result = await call();\n  return result;\n</code></pre></div>'),'https://publisher.example/article',{preserve:[{selector:'.publisher-code',as:'pre',code:'pre code'}]});
  const $=cheerio.load(body!.html);
  assert.equal($('pre code').text(),'  const result = await call();\n  return result;\n');
  assert.equal($('pre code').attr('class'),'language-typescript');
  assert.doesNotMatch(body!.html,/Copy/);
});

test("source cleanup removes declared controls without deleting article words or images", () => {
  const content = '<p>Previous examples used Python. Copied values remain part of this explanation.</p>' +
    '<figure><img src="https://publisher.example/diagram.png" alt="Actual diagram"><figcaption>Actual diagram</figcaption></figure>' +
    `<div class="publisher-tools"><p>Previous article control. ${prose}</p><span>Next article control</span><svg viewBox="0 0 24 24"><use href="#arrow"></use></svg></div>`;
  const body = readable(page(content), "https://publisher.example/article", pageRules({ detail: { removeSelector: ".publisher-tools" } }));
  assert.ok(body);
  assert.doesNotMatch(body.html, /Previous article control|Next article control|data:image\/svg/);
  assert.match(body.text, /Previous examples used Python\. Copied values remain part of this explanation\./);
  assert.equal(cheerio.load(body.html)('img[src="https://publisher.example/diagram.png"]').length, 1);
  assert.match(readable(page(content), "https://publisher.example/article")!.text, /Previous article control/);
});

test("source cleanup accepts only a nonempty selector", () => {
  assert.deepEqual(unsupportedConfig("web_list", { detail: { removeSelector: ".article-pagination" } }), []);
  for (const removeSelector of ["", " ", null, 3, [".article-pagination"]]) {
    assert.deepEqual(unsupportedConfig("web_list", { detail: { removeSelector } }), ["detail.removeSelector"]);
  }
});

test("Google source rules keep code and article media without publisher controls", () => {
  const sources = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
  const source = sources.sources.find((entry: { id: string }) => entry.id === "google-developers-ai");
  assert.ok(source);
  const content = '<div class="inner-block-content code-block line-numbers"><pre><code class="language-python">print("Copied")\n  preserve_indentation()</code></pre>' +
    '<div class="language-block">Python</div><div class="copy-code-block"><span class="hidden">Copied</span><button>Copy</button></div></div>' +
    '<figure><img src="https://publisher.example/architecture.png" alt="Architecture"></figure>' +
    '<section class="navigation-container"><a href="/previous"><svg viewBox="0 0 24 24"><use href="#arrow"></use></svg></a><span>Previous</span><span>Next</span></section>';
  const body = readable(page(content), "https://developers.googleblog.com/example/", pageRules(source.config));
  assert.ok(body);
  const $ = cheerio.load(body.html);
  assert.equal($("pre code").text(), 'print("Copied")\n  preserve_indentation()');
  assert.equal($("pre code").attr("class"), "language-python");
  assert.doesNotMatch($("p").text(), /Python|Copied|Previous|Next/);
  assert.equal($("img").length, 1);
  assert.equal($("img").attr("alt"), "Architecture");
});

test("Claude code components keep their kind and language without a separate publisher header", () => {
  const sources = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
  const source = sources.sources.find((entry: { id: string }) => entry.id === "claude-dev");
  const body = readable(page('<div class="art-code art-prompt"><div class="ch"><span>PROMPT</span><button>Copy</button></div><pre><span>/claude-api onboard</span></pre></div>' +
    '<div class="art-code"><div class="ch"><span>CODE<span class="lang">Text</span></span><button>Copy</button></div><pre><span>folder/\n  child.txt</span></pre></div>' +
    '<div class="art-code"><div class="ch"><span>CODE<span class="lang">Shell</span></span><button>Copy</button></div><pre><span>echo hello</span></pre></div>'),
    "https://claude.dev/blog/example/", pageRules(source.config));
  assert.ok(body);
  const $ = cheerio.load(body.html);
  assert.equal($("pre").eq(0).attr("data-code-kind"), "prompt");
  assert.equal($("pre").eq(1).attr("data-language"), "text");
  assert.equal($("pre").eq(2).attr("data-language"), "shell");
  assert.deepEqual($("pre code").toArray().map(node => $(node).text()), ["/claude-api onboard", "folder/\n  child.txt", "echo hello"]);
  assert.doesNotMatch($("p").text(), /PROMPT|CODE|Text|Shell|Copy/);
  assert.equal(sanitizeBody(body.html), body.html, "code metadata survives repeated cleaning");
  assert.match(bodyToMarkdown(body.html), /```shell\necho hello/);
});

test("ordinary code language declarations survive extraction and unsafe metadata is discarded", () => {
  const body = readable(page('<pre data-code-kind="prompt"><code class="language-text">  keep this indentation\n</code></pre>'), "https://publisher.example/article");
  assert.ok(body);
  const $ = cheerio.load(body.html);
  assert.equal($("pre").attr("data-code-kind"), "prompt");
  assert.equal($("pre").attr("data-language"), "text");
  assert.equal($("pre code").attr("class"), "language-text");
  assert.equal($("pre code").text(), "  keep this indentation\n");
  const fallback = readable(page('<pre class="language-shell"><code class="source">echo hello</code></pre>'), "https://publisher.example/article");
  assert.equal(cheerio.load(fallback!.html)("pre").attr("data-language"), "shell", "a non-language code class does not mask the pre language");
  const unsafe = cheerio.load(sanitizeBody('<pre data-code-kind="invalid" data-language="bad <script>"><code>x</code></pre>'));
  assert.equal(unsafe("pre").attr("data-code-kind"), undefined);
  assert.equal(unsafe("pre").attr("data-language"), undefined);
});

test("source code metadata rules reject unsupported kinds and invalid language selectors", () => {
  assert.deepEqual(unsupportedConfig("rss", { detail: { preserve: [{ selector: ".prompt", as: "pre", code: "pre", kind: "prompt", language: ".lang" }] } }), []);
  for (const fields of [{ kind: "arbitrary" }, { language: " " }, { language: 3 }]) {
    assert.deepEqual(unsupportedConfig("rss", { detail: { preserve: [{ selector: ".code", as: "pre", ...fields }] } }), ["detail.preserve"]);
  }
});
