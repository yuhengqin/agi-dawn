import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanArticlePresentation} from '@agidawn/backend/content/presentation';
import {sanitizeBody} from '@agidawn/backend/content/sanitize';
import {withOutline} from '@agidawn/backend/content/outline';
import * as cheerio from 'cheerio';

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

test('paired historical Substack footnotes and their return links stay inside the current body',()=>{
  const context={url:'https://blog.sshh.io/p/example'},html='<p>Explanation<a href="https://blog.sshh.io/p/example#footnote-2">2</a>.</p><p><a href="https://blog.sshh.io/p/example#footnote-anchor-2">2</a></p><p>A supporting note.</p>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false),links=$('a');
  for(const link of links.toArray()){const href=$(link).attr('href')!;assert.ok(href.startsWith('#'));assert.equal($(`[id="${href.slice(1)}"]`).length,1);}
  assert.equal(cleanArticlePresentation(result,context),result);
  assert.equal(cleanArticlePresentation('<p><a href="https://blog.sshh.io/p/other#footnote-2">2</a></p>',context),'<p><a href="https://blog.sshh.io/p/other#footnote-2">2</a></p>');
});

test('numbered Microsoft footnote paragraphs gain targets and return links without matching inline superscripts',()=>{
  const url='https://blogs.microsoft.com/blog/example/',html=`<p>A claim<sup><a href="${url}#footnote1">1</a></sup>.</p><p>A second claim<sup><a href="${url}#footnote1">4</a></sup>.</p><p>Ordinary text <sup>1</sup> stays ordinary.</p><p><sup>1 </sup>Evidence from the study.</p>`;
  const result=cleanArticlePresentation(html,{url}),$=cheerio.load(result,null,false);
  const refs=$('sup a');assert.equal(refs.length,2);assert.equal(refs.eq(0).attr('href'),refs.eq(1).attr('href'));
  const target=$(`[id="${refs.eq(0).attr('href')!.slice(1)}"]`);assert.match(target.text(),/Evidence from the study/);assert.equal(target.find('a[href^="#"]').length,2);
  assert.equal(cleanArticlePresentation(result,{url}),result);
});

test('new footnote anchors survive sanitization while arbitrary publisher IDs cannot collide with app chrome',()=>{
  const html=sanitizeBody('<p id="main">Claim<a id="footnote-anchor-1" href="#footnote-1">1</a>.</p><p id="footnote-1">Evidence<a href="#footnote-anchor-1">Return</a></p>','https://publisher.example/article');
  const $=cheerio.load(html,null,false);assert.equal($('#main').length,0);
  for(const link of $('a').toArray()){const href=$(link).attr('href')!;assert.ok(href.startsWith('#'));assert.equal($(`[id="${href.slice(1)}"]`).length,1);}
  assert.equal(sanitizeBody(html,'https://publisher.example/article'),html);
});

test('known transparent Browser Use figures retain their dark image surface without affecting ordinary pictures',()=>{
  const html='<p><img src="https://browser-use.com/images/benchmark-behind-the-benchmark/ensemble.png" alt="Ensemble"><img src="https://browser-use.com/images/photo.png" alt="Photo"></p>';
  const result=cleanArticlePresentation(html,{url:'https://browser-use.com/posts/benchmark-behind-the-benchmark'}),$=cheerio.load(result,null,false);
  assert.equal($('img').eq(0).attr('data-reader-image-surface'),'dark');assert.equal($('img').eq(1).attr('data-reader-image-surface'),undefined);
  assert.equal(sanitizeBody(result,'https://browser-use.com/posts/benchmark-behind-the-benchmark'),result);
});

test('legacy Google compatibility fallback paragraphs are removed only next to a native video',()=>{
  const html='<video src="https://example.org/clip.mp4"></video><p>Sorry, your browser doesn\'t support playback for this video</p><p>An article can discuss browser compatibility.</p>';
  const result=cleanArticlePresentation(html,{url:'https://developers.googleblog.com/example/'});
  assert.doesNotMatch(result,/Sorry/);assert.match(result,/article can discuss/);
  assert.match(cleanArticlePresentation('<p>Sorry, your browser doesn\'t support playback for this video</p>',{url:'https://developers.googleblog.com/example/'}),/Sorry/);
});

test('outline text decodes HTML entities once and keeps nested text and section numbering',()=>{
  const result=withOutline('<h2>First&nbsp;<em>section</em></h2><h3>A&amp;nbsp; label</h3><h2>Third&#160; section</h2>');
  assert.deepEqual(result.outline.map(entry=>[entry.id,entry.text]),[
    ['sec-1','First section'],['sec-2','A&nbsp; label'],['sec-3','Third section'],
  ]);
  assert.match(result.html,/<h2 id="sec-1">First&nbsp;<em>section<\/em><\/h2>/);
  assert.match(result.html,/<h3 id="sec-2">A&amp;nbsp; label<\/h3>/);
});

test('Substack promotional paragraphs and same-article share links are removed only on blog.sshh.io',()=>{
  const context={url:'https://blog.sshh.io/post?ref=home#article'};
  const html='<p>Thanks for reading Shrivu’s Substack! Subscribe for free to receive new posts and support my work.</p><p>Thanks for reading Shrivu\'s Substack! Subscribe for free to receive new posts and support my work.</p><p>感谢阅读 Shrivu 的 Substack！ 免费订阅以接收新文章并支持我的工作。</p><p><a href="https://blog.sshh.io/post?utm_source=email&amp;action=share#share">Share</a></p><p><a href="/post?action=share">分享</a></p><p>I recommend subscribing to Shrivu’s Substack, and sharing this post with colleagues.</p><p>Share the post after reading it.</p><p><img src="/inline.png">Thanks for reading Shrivu’s Substack! Subscribe for free to receive new posts and support my work.</p>';
  const expected='<p>I recommend subscribing to Shrivu’s Substack, and sharing this post with colleagues.</p><p>Share the post after reading it.</p><p><img src="/inline.png">Thanks for reading Shrivu’s Substack! Subscribe for free to receive new posts and support my work.</p>';
  const result=cleanArticlePresentation(html,context);
  assert.equal(result,expected);
  assert.equal(cleanArticlePresentation(result,context),result);
  assert.equal(cleanArticlePresentation(html,{...context,url:'https://other.example/post?ref=home#article'}),html);
});

test('only a root-tail No posts paragraph is removed',()=>{
  const context={url:'https://blog.sshh.io/archive/'};
  const html='<p>No posts</p><p>正文中提到无帖子，但仍有内容。</p><p>无帖子</p>';
  const result=cleanArticlePresentation(html,context);
  assert.equal(result,'<p>No posts</p><p>正文中提到无帖子，但仍有内容。</p>');
  assert.equal(cleanArticlePresentation('<div><p>No posts</p></div>',context),'<div><p>No posts</p></div>');
  assert.equal(cleanArticlePresentation(result,context),result);
});
test('footnotes do not conflate documents selected by different query parameters',()=>{
  const html='<p><a href="https://example.test/#footnote-1">1</a></p><p id="footnote-1">Other note</p>';
  assert.doesNotMatch(cleanArticlePresentation(html,{url:'https://example.test/?p=123'}),/reader-fn/);
});
test('translated native-video fallback is removed only next to a Google player',()=>{
  for(const text of ['抱歉，你的浏览器不支持此视频的播放','抱歉，您的浏览器不支持此视频的播放','您的浏览器不支持视频标签。']){
    const html='<video src="https://example.com/clip.mp4"></video><p>'+text+'</p><p>正文说明。</p>';
    assert.doesNotMatch(cleanArticlePresentation(html,{url:'https://developers.googleblog.com/article'}),/不支持/);
    assert.doesNotMatch(cleanArticlePresentation(html,{url:'https://developers.openai.com/blog/article'}),/不支持/);
    assert.match(cleanArticlePresentation('<p>'+text+'</p>',{url:'https://developers.googleblog.com/article'}),/不支持/);
  }
});
test('a historical Ghost card omits its icon when a cover exists and repairs literal metadata escapes',()=>{
  const html='<figure data-reader-card="true"><a href="https://ghuntley.com/post"><img src="https://storage.ghost.io/content/images/icon/avatar.jpg"></a><a href="https://ghuntley.com/post"><img src="https://storage.ghost.io/content/images/thumbnail/cover.jpg"></a><p>It&amp;#39;s a linked preview.</p><p>Geoffrey HuntleyGeoffrey Huntley</p></figure><p>Literal &amp;#39; in author prose.</p>';
  const result=cleanArticlePresentation(html,{url:'https://ghuntley.com/article'}),$=cheerio.load(result);assert.equal($('img').length,1);assert.equal($('figure').text(),"It's a linked preview.Geoffrey Huntley");assert.match($('body >p').text(),/&#39;/);assert.equal(cleanArticlePresentation(result,{url:'https://ghuntley.com/article'}),result);
});
