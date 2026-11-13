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
import { bodyToMarkdown,markdownBody } from "@agidawn/backend/content/markdown";
import { sanitizeBody } from "@agidawn/backend/content/sanitize";
import katex from 'katex';
import {translateHtml} from '../modules/reader/translation/body.ts';

const prose = "The article explains how to maintain software, with practical examples and measurements. ".repeat(6);
test('Markdown round trips preserve the local targets and return links of restored footnotes',()=>{
  const url='https://example.com/article',html='<p>Claim<a href="#footnote-1"><sup>1</sup></a>.</p><p id="footnote-1">Explanation <a href="#footnote-anchor-1">↩</a></p>';
  const restored=cheerio.load(markdownBody(bodyToMarkdown(html,url),url));
  restored('a[href^="#"]').each((_,node)=>{const href=restored(node).attr('href')!;assert.equal(restored(href).length,1,'footnote destination survives Markdown');});
});
test('Markdown round trips validated structural formulas rather than flattening their layout',()=>{
  const clean=sanitizeBody(katex.renderToString('\\frac{a}{b}+\\sqrt{x}',{output:'html'}));
  const restored=markdownBody(bodyToMarkdown(clean),'https://example.com/article');
  const $=cheerio.load(restored);assert.equal($('[data-reader-math="katex"]').length,1);assert.equal($('.mfrac').length,1);assert.equal($('svg path').length,1);
  assert.doesNotMatch(markdownBody(bodyToMarkdown('<span data-reader-math="katex" style="background:url(https://evil.example/x)">fake</span>'),'https://example.com'),/evil|style=/);
});
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

const sourceRules=(id:string)=>pageRules(JSON.parse(readFileSync(new URL('../industry/sources.json',import.meta.url),'utf8')).sources.find((source:{id:string})=>source.id===id).config);

test('OpenAI numbered code keeps line boundaries and indentation without the source gutter',()=>{
  const content='<div class="flex flex-col overflow-hidden rounded-md"><div class="style-scrollbars"><code class="fixture_syntaxHighlight"><pre><div><span>1</span><div>{</div></div><div><span>2</span><div>  "enabled": true</div></div><div><span>3</span><div>}</div></div></pre></code></div></div>';
  const body=readable(page(content),'https://openai.com/index/example',sourceRules('openai-engineering'))!;
  assert.equal(cheerio.load(body.html)('pre code').text(),'{\n  "enabled": true\n}');
});

test('OpenAI source rules retain prompt cards and all bound article tab panels',()=>{
  const prompts='<div class="not-prose"><div class="prompt-scroll prompt-scroll--header-actions"><div class="prompt-scroll__content">Inspect the repository.\n  Preserve this indentation.</div></div><button>Copy</button></div>';
  const tabs='<div role="tablist"><button id="tab-a" role="tab" aria-controls="panel-a">First case</button><button id="tab-b" role="tab" aria-controls="panel-b">Second case</button></div>'+
    '<div id="panel-a" role="tabpanel" aria-labelledby="tab-a"><h2>First case</h2><p>The first public case explains the voice architecture.</p></div>'+
    '<div id="panel-b" role="tabpanel" aria-labelledby="tab-b" hidden><h2>Second case</h2><p>The second public case explains its evaluation process.</p><p hidden>UNRELATED_HIDDEN</p></div><p hidden>PRIVATE_UNBOUND</p>';
  const body=readable(page(prompts+tabs),'https://developers.openai.com/blog/example',sourceRules('openai-developer-blog'))!;
  const $=cheerio.load(body.html);
  assert.equal($('pre code').text(),'Inspect the repository.\n  Preserve this indentation.');
  assert.match(body.text,/second public case/);assert.doesNotMatch(body.text,/UNRELATED_HIDDEN|PRIVATE_UNBOUND|Copy/);
});

test('declared ARIA tables survive scroll containers without dropping cell links or relationships',()=>{
  const content='<div class="viewport base-ui-disable-scrollbar"><div role="table"><div role="row"><div role="columnheader">Harness</div><div role="columnheader">Cost</div></div><div role="row"><div role="cell">Solo</div><div role="cell"><a href="/cost">$9</a></div></div><div role="row"><div role="cell">Full</div><div role="cell">$200</div></div></div></div>';
  const body=readable(page(content),'https://www.anthropic.com/research/example',sourceRules('anthropic-engineering'))!;
  const $=cheerio.load(body.html);
  assert.deepEqual($('tr').toArray().map(row=>$(row).children().map((_,cell)=>$(cell).text()).get()),[['Harness','Cost'],['Solo','$9'],['Full','$200']]);
  assert.equal($('td a').attr('href'),'https://www.anthropic.com/cost');
});

test('Anthropic article media columns retain their pictures and adjacent captions',()=>{
  const content='<div class="fixture_media-column"><figure><img src="/memory.png" alt="Memory layers"><figcaption>The memory hierarchy.</figcaption></figure></div>';
  const body=readable(page(content),'https://www.anthropic.com/research/example',sourceRules('anthropic-engineering'))!;
  assert.equal(cheerio.load(body.html)('img[alt="Memory layers"]').length,1);
  assert.match(body.text,/memory hierarchy/);
});

test('Anthropic tables without header roles and modern scrollable code retain every row and line',()=>{
  const content='<div class="fixture_Viewport base-ui-disable-scrollbar"><div role="table"><div role="row"><div role="cell">Phase</div><div role="cell">Duration</div></div><div role="row"><div role="cell">Review</div><div role="cell">20 min</div></div></div></div><div class="fixture_media-column"><div class="fixture_ScrollArea"><div class="base-ui-disable-scrollbar"><pre><code class="language-plaintext">Plan\n\n  Verify the result.\n</code></pre></div></div></div>';
  const body=readable(page(content),'https://www.anthropic.com/research/example',sourceRules('anthropic-engineering'))!,$=cheerio.load(body.html);
  assert.deepEqual($('tr').toArray().map(row=>$(row).children().map((_,cell)=>$(cell).text()).get()),[['Phase','Duration'],['Review','20 min']]);
  assert.equal($('pre code').text(),'Plan\n\n  Verify the result.\n');
});

test('Ghost bookmarks cannot replace the author commentary surrounding a large link card',()=>{
  const input=`<html><head><title>Commentary</title></head><body><article><header><h1>Commentary</h1></header><section class="gh-content gh-canvas"><p>I am introducing this recommendation because the author explains the feedback loop clearly.</p><figure class="kg-card kg-bookmark-card"><a class="kg-bookmark-container" href="https://example.org"><div class="kg-bookmark-content"><div class="kg-bookmark-title">Quoted article</div><div class="kg-bookmark-description">${prose}</div><div class="kg-bookmark-metadata"><span>Author Name</span></div></div><div class="kg-bookmark-thumbnail"><img src="https://example.org/thumb.png"></div></a><figcaption>External recommendation.</figcaption></figure><p>Read this and internalise this. Capture the feedback so that the next iteration improves.</p></section></article></body></html>`;
  const body=readable(input,'https://ghuntley.com/pressure/',sourceRules('geoffrey-huntley'))!;
  assert.match(body.text,/introducing this recommendation/);assert.match(body.text,/Read this and internalise/);assert.match(body.text,/Quoted article/);
});

test('a client-only newsletter shell is not accepted as its full article',()=>{
  const html=`<html><head><title>Architecture</title></head><body><main><nav class="breadcrumb">newsletter /</nav><h1>Architecture</h1><p class="dek">${prose}</p><hr><hr><section class="signup-cta"><h2>enjoyed this issue?</h2><p>Subscribe for more.</p></section></main></body></html>`;
  assert.equal(readable(html,'https://latentpatterns.com/newsletter/architecture',sourceRules('latent-patterns')),null);
  assert.ok(readable(html.replace('<hr><hr>',`<hr><article><p>${prose}</p></article><hr>`),'https://latentpatterns.com/newsletter/architecture',sourceRules('latent-patterns')));
});

test('HTML-only KaTeX preserves fractions radicals accents and limits through extraction and translation',async()=>{
  const expressions=[String.raw`\frac{\sigma^2}{n}`,String.raw`\sqrt{3}+\sqrt{5}`,String.raw`\sum_{i=1}^{n}x_i`,String.raw`\underbrace{\sigma^2_{agent}}_{\text{cannot fix}}+\frac{s_\Delta}{\sqrt n}`];
  const html=expressions.map(tex=>`<p>Formula: ${katex.renderToString(tex,{output:'html'})}</p>`).join('');
  const body=readable(page(html),'https://publisher.example/article')!,$=cheerio.load(body.html);
  assert.equal($('[data-reader-math="katex"]').length,expressions.length);
  assert.ok($('.katex .mfrac .frac-line').length);assert.ok($('.katex .sqrt svg path').length);
  assert.ok($('.katex .msupsub').length);assert.ok($('.katex [style*="top:"]').length);
  assert.equal(sanitizeBody(body.html),body.html,'repeated cleaning preserves validated formula layout');
  const translated=await translateHtml(body.html,async parts=>({t:parts.map(p=>p.replaceAll('Formula:','公式：').replaceAll('The article explains','文章解释')),receiptId:1}));
  assert.equal(cheerio.load(translated.html)('[data-reader-math="katex"]').length,expressions.length);
  assert.equal(cheerio.load(translated.html)('[data-reader-math="katex"]').toString(),$('[data-reader-math="katex"]').toString());
});

test('a forged KaTeX class cannot smuggle scripts external SVG resources or arbitrary layout styles',()=>{
  for(const inner of ['<script>alert(1)</script>','<span style="position:fixed;inset:0">overlay</span>','<svg><foreignObject>unsafe</foreignObject></svg>','<svg><path fill="url(https://evil.example/x)" d="M0 0"/></svg>']){
    const body=readable(page(`<span class="katex">${inner}</span>`),'https://publisher.example/article')!;
    assert.doesNotMatch(body.html,/<script|foreignObject|position:fixed|url\(https/);
    assert.equal(body.quality,'partial');assert.ok(body.issues.some(issue=>issue.kind==='missing-formula'));
  }
});

test('OpenAI prose headings survive slug words that Readability mistakes for chrome or bylines',()=>{
  const content='<h2 id="9-the-hidden-command-palette">9. The hidden command palette</h2><p>'+prose+'</p>'+
    '<h2 id="weekend-how-two-characters-share-a-scene">Weekend: two characters share a scene</h2><p>'+prose+'</p>'+
    '<h3 id="about-the-author-and-company">About the author and company</h3><p>'+prose+'</p>'+
    '<h2 hidden id="hidden-control">PRIVATE_HEADING</h2>';
  const body=readable(page(content).replace('<article>','<article id="mainContent">'),'https://developers.openai.com/blog/example',sourceRules('openai-developer-blog'))!;
  const $=cheerio.load(body.html);
  assert.ok($('h2').toArray().some(x=>$(x).text()==='9. The hidden command palette'));
  assert.ok($('h2').toArray().some(x=>$(x).text().startsWith('Weekend:')));
  assert.match($('h3').text(),/About the author/);assert.notEqual(body.author,'About the author and company');
  assert.doesNotMatch(body.html,/PRIVATE_HEADING/);
});

test('Uber heading decorators keep images and captions outside the real section title',()=>{
  for(const tag of ['h2','h3','h4'])for(const textTag of ['span','strong']){
    const content=`<${tag} class="rich-heading" id="section"><div data-lexical-decorator="true"><div class="rich-float-clear"></div><div class="rich-image-wrapper"><img src="/diagram.png" alt="Architecture"><p class="rich-image-caption">Figure 1: Complete architecture.</p></div></div><${textTag} data-lexical-text="true">Actual section</${textTag}></${tag}><p>${prose}</p>`;
    const body=readable(page(content),'https://www.uber.com/us/en/blog/example/',sourceRules('uber-ai'))!,$=cheerio.load(body.html);
    assert.equal($(tag).text(),'Actual section');assert.equal($('figcaption').text(),'Figure 1: Complete architecture.');
    assert.equal($('figure img').length,1);assert.ok(body.html.indexOf('<figure')<body.html.indexOf(`<${tag}`));
  }
});

test('Uber author cards provide a real byline instead of a heading containing author',()=>{
  const cards=['Sean Tout','Max Zhurovich'].map(name=>`<div><div data-baseweb="avatar" aria-label="${name}">ST</div><div><div data-baseweb="typo-labelmedium">${name}</div><p data-baseweb="typo-paragraphsmall">Engineer</p></div></div>`).join('');
  const html=page('<h3 id="beyond-authorization">Beyond Authorization: Governing Agent Behavior</h3><p>'+prose+'</p>').replace('<body>','<body><main>'+cards).replace('</body>','</main></body>');
  const body=readable(html,'https://www.uber.com/us/en/blog/example/',sourceRules('uber-ai'))!;
  assert.equal(body.author,'Sean Tout, Max Zhurovich');
  assert.match(body.html,/Beyond Authorization/);
});
