import assert from "node:assert/strict";
import { test } from "node:test";
import { isChineseText, stripTags } from "@agidawn/backend/lib/text";
import {textToHtml} from "@agidawn/backend/content/sanitize";

test('language inference requires predominantly Chinese text and honours declared languages',()=>{
  for(const [text,language,expected] of [
    ['People often ask me about open-source models. 互动内容请访问原文查看。',null,false],
    ['What 通义千问 teaches us about building better coding agents',null,false],
    ['这是介绍 AI 和 API 的中文技术文章，正文仍以中文为主。',null,true],
    ['这是中文。','en',false],
    ['An explicitly declared Chinese article.','zh-CN',true],
    ['這是中文文章。','und',true],
    ['日本語の技術記事です。',null,false],
    ['한국어 기술 문서 漢字',null,false],
    ['1234 --',null,false],
  ] as const)assert.equal(isChineseText(text,language),expected,`${language??'unknown'}: ${text}`);
});

test("bare addresses in post text become safe links",()=>{
  const html=textToHtml("see https://arxiv.org/abs/2502.11089. <b>x</b>\n\n1. one\n2. two");
  assert.match(html,/<a href="https:\/\/arxiv\.org\/abs\/2502\.11089" target="_blank" rel="noopener noreferrer nofollow">/);
  assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);assert.match(html,/<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

// Regression coverage for HTML attributes that contain `>` in real source pages.
test("stripTags ignores > inside quoted HTML attributes", () => {
  assert.equal(
    stripTags('<a title="Platforms > Xbox [11,780 articles]" href="/xbox">Xbox</a>'),
    "Xbox",
  );
  assert.equal(stripTags("<a title='Platforms > Xbox' href='/xbox'>A > B</a>"), "A > B");
  assert.equal(stripTags(`<a title = "don't > do" href = '/xbox'>Xbox</a>`), "Xbox");
  assert.equal(stripTags(`<a\ttitle\n=\f"Platforms > Xbox" href='/xbox'>Xbox</a>`), "Xbox");
});

test("stripTags does not pair quotes inside unquoted attribute values", () => {
  assert.equal(stripTags("<a title=don't>Xbox</a><p>next paragraph</p>"), "Xbox next paragraph");
  assert.equal(stripTags("<a title=don't>Xbox</a><p title=it's>next paragraph</p>"), "Xbox next paragraph");
  assert.equal(stripTags(`<a data-note=a='b title="Platforms > Xbox">Xbox</a>`), "Xbox");
});

test("stripTags keeps existing comment handling without swallowing following text", () => {
  for (const comment of ["<!-- note -->", "<!-->", "<!--->", "<!-- note --!>", "<!-- don't -->"]) {
    assert.equal(stripTags(`${comment}<p>visible article</p>`), "visible article");
  }
});

test("stripTags preserves existing spacing, entities, and hidden-content handling", () => {
  assert.equal(stripTags("<p>one</p><p>two</p>"), "one two");
  assert.equal(stripTags("a<br>b"), "a b");
  assert.equal(stripTags("<script>hidden</script><style>hidden</style><noscript>hidden</noscript>visible"), "visible");
  assert.equal(stripTags("&nbsp;&amp; &lt;code&gt; &quot;text&quot; &#39;one&apos;"), '& <code> "text" \'one\'');
});

test("stripTags keeps existing handling of incomplete tags and unclosed attribute quotes", () => {
  assert.equal(stripTags('text <a title="unfinished'), 'text <a title="unfinished');
  assert.equal(stripTags('text <a title="unfinished>visible'), "text");
  assert.equal(stripTags('<a ="unfinished>y">tail'), 'y">tail');
});

// Feeds escape text twice, so a title arrives as "AI&#8217;s leaders" and code as "mtime:&amp;lt;7d":
// character references are text too, and the text meant is what a reader expects.
test("stripTags decodes character references, also when a feed escaped them twice", () => {
  assert.equal(stripTags("AI&#8217;s leaders, AT&#038;T &#x2014; done&#8230;"), "AI’s leaders, AT&T — done…");
  assert.equal(stripTags("AI&amp;#8217;s &amp;lt;7d&gt;"), "AI’s <7d>");
  assert.equal(stripTags("Gemini &mdash; &ldquo;fast&rdquo; &amp;hellip; caf&eacute; 5&times;"), "Gemini — “fast” … café 5×");
  // Only references that end in a semicolon: an address keeps "&copy=" and an unknown name stays as written.
  assert.equal(stripTags("?a=1&copy=2 &unknown; AT&T"), "?a=1&copy=2 &unknown; AT&T");
});
