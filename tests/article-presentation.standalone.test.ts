import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanArticlePresentation} from '@agidawn/backend/content/presentation';
import {sanitizeBody} from '@agidawn/backend/content/sanitize';
import {withOutline} from '@agidawn/backend/content/outline';

test('only the matching Google header date is removed, retaining dates in article prose',()=>{
  const context={url:'https://developers.googleblog.com/article/',publishedAt:'2026-10-29T00:00:00Z'};
  for(const date of ['OCT. 29, 2026','2026年10月29日']){
    const result=cleanArticlePresentation(`<p>${date}</p><p>On OCT. 29, 2026 we released a tool.</p>`,context);
    assert.equal(result,'<p>On OCT. 29, 2026 we released a tool.</p>');
  }
  assert.equal(cleanArticlePresentation('<p>OCT. 28, 2026</p><p>Actual words.</p>',context),'<p>OCT. 28, 2026</p><p>Actual words.</p>');
  assert.equal(cleanArticlePresentation('<p>OCT. 29, 2026</p>',{...context,url:'https://other.example/article'}),'<p>OCT. 29, 2026</p>');
});

test('OpenAI link suffixes are removed without deleting article explanations',()=>{
  const html='<p><a href="https://example.org/docs">Docs<span>(opens in a new window)</span></a> and <a href="https://example.org/zh">文档<span>（在新窗口中打开）</span></a>.</p><p>The words (opens in a new window) explain the link.</p>';
  const result=cleanArticlePresentation(html,{url:'https://openai.com/index/git/'});
  assert.equal(result,'<p><a href="https://example.org/docs">Docs</a> and <a href="https://example.org/zh">文档</a>.</p><p>The words (opens in a new window) explain the link.</p>');
  assert.equal(cleanArticlePresentation(html,{url:'https://other.example/article'}),html);
});

test('Ghost bookmark descriptions deduplicate only an identical title in the same card',()=>{
  const html='<figure><a href="https://example.org"><p>Repeated title</p><p>Repeated title</p></a></figure><p>Repeated title</p><p>Repeated title</p>';
  assert.equal(cleanArticlePresentation(html,{url:'https://ghuntley.com/patch/'}),'<figure data-reader-card="true"><p><a href="https://example.org">Repeated title</a></p></figure><p>Repeated title</p><p>Repeated title</p>');
});

test('legacy Browser Use controls are removed while all authors and meaningful heading drawings remain',()=>{
  const context={url:'https://browser-use.com/posts/benchmark',publishedAt:'2026-10-27T00:00:00Z'};
  const html='<ul><li>One <span>(CMU)</span></li><li>Two <span>(Browser Use)</span></li></ul><p>Oct 27th, 2026<span>Research</span></p><h2>Result<a href="https://browser-use.com/posts/benchmark#result"><img src="/icon" alt="文章图表"></a></h2><h2>Trend<a href="#trend"><img src="/chart" alt="Score trend"></a></h2>';
  const result=cleanArticlePresentation(html,context);
  assert.doesNotMatch(result,/Oct 27th|Research|src="\/icon"/);assert.match(result,/One.*CMU.*Two.*Browser Use/);assert.match(result,/alt="Score trend"/);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('small SVG legends retain inline identity across sanitization',()=>{
  const html='<figure><p><span><svg width="9" height="9" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>Completed tasks</span></p></figure>';
  const result=sanitizeBody(html,'https://publisher.example/article');
  assert.match(result,/<img[^>]+data-reader-inline="true"/);assert.match(result,/Completed tasks/);
  assert.equal(sanitizeBody(result,'https://publisher.example/article'),result);
});

test('a small SVG coordinate system does not make an ordinary illustration an inline legend',()=>{
  for(const dimensions of ['width="600" height="400"','']){
    const html=`<figure><p><span><svg ${dimensions} viewBox="0 0 30 20"><path d="M0 20L30 0"/></svg>A full illustration</span></p></figure>`;
    assert.doesNotMatch(sanitizeBody(html,'https://publisher.example/article'),/data-reader-inline="true"/);
  }
});

test('legacy missing diagrams receive linked fallbacks, while tables and text quotations stay intact',()=>{
  const context={url:'https://openai.com/index/example'};
  const result=cleanArticlePresentation('<figure><h3>Chart title</h3><figcaption>Chart description</figcaption></figure><figure><table><tr><td>Complete data</td></tr></table><figcaption>Table</figcaption></figure><figure><blockquote>A quotation</blockquote><figcaption>Author</figcaption></figure>',context);
  assert.match(result,/此图未保存/);assert.match(result,/href="https:\/\/openai.com\/index\/example"/);
  assert.equal((result.match(/此图未保存/g)??[]).length,1);
  assert.match(result,/Complete data/);assert.match(result,/A quotation/);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('figure and bookmark headings stay out of the public outline without renumbering later sections',()=>{
  const input='<h2>First section</h2><figure><h3>Diagram title</h3><figcaption>Diagram</figcaption></figure><h2>Last section</h2>';
  const result=withOutline(input,{excludeFigures:true});
  assert.deepEqual(result.outline.map(entry=>[entry.id,entry.text]),[['sec-1','First section'],['sec-3','Last section']]);
  assert.match(result.html,/<h3 id="sec-2">Diagram title/);
  assert.equal(withOutline(input).outline.length,3,'private snapshot anchors keep their existing protocol');
});

test('legacy Ghost bookmark links keep only their title clickable and preserve the description',()=>{
  const result=cleanArticlePresentation('<figure><a href="https://example.org"><p>Bookmark title</p><p>A useful description of the linked article.</p></a></figure>',{url:'https://ghuntley.com/patch/'});
  assert.match(result,/data-reader-card="true"/);assert.match(result,/<a[^>]+>Bookmark title<\/a>/);
  assert.match(result,/<p>A useful description/);assert.doesNotMatch(result,/<a[^>]*><p>/);
});

test('Ghost bookmark thumbnails remain links without turning the description into one',()=>{
  const result=cleanArticlePresentation('<figure><a href="https://example.org"><p>Bookmark title</p><p>Useful description of the linked article.</p><img src="https://example.org/thumb.png" alt="Preview"></a></figure>',{url:'https://ghuntley.com/patch/'});
  assert.match(result,/<p>Useful description of the linked article\.<\/p>/);assert.match(result,/<a href="https:\/\/example.org">Bookmark title<\/a>/);
  assert.match(result,/src="https:\/\/example.org\/thumb.png"/);assert.equal(cleanArticlePresentation(result,{url:'https://ghuntley.com/patch/'}),result);
});
