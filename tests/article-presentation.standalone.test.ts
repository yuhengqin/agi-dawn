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

test('a verified inline Ghost bookmark no longer splits the original or translated opening sentence',()=>{
  const context={url:'https://ghuntley.com/open-webui/'};
  for(const chinese of [false,true])for(const tag of ['figure','blockquote']){
    const title=chinese?'亲爱的学生：AI 来了':'Dear Student: AI is here';
    const beginning=chinese?'这是对 ':'This is a follow-up to ';
    const continuation=chinese?'但更多是面向家长的。我儿子刚满十岁，':'but targeted more towards parents. My son recently turned ten, ';
    const card=`<${tag}><p><a href="https://ghuntley.com/screwed/">${title}</a></p><p>A preview of the linked article.</p><img src="https://example.org/preview.png"></${tag}>`;
    const html=`<p>${beginning}</p>${card}<p>${continuation}<a href="https://ghuntley.com/dothings">writing together</a>.</p><h2>Next</h2><pre><code>keep &lt;T&gt;\n  source</code></pre>`;
    const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false),opening=$.root().children().first();
    assert.equal(opening.is('p'),true);assert.equal(opening.find('a').length,2);
    assert.equal(opening.find('a').first().attr('href'),'https://ghuntley.com/screwed/');
    assert.equal(opening.text(),chinese?`这是对《${title}》的后续补充，${continuation}writing together.`:`This is a follow-up to ${title} ${continuation}writing together.`);
    assert.equal($(tag).length,1);assert.match($(tag).text(),/A preview/);assert.equal($('img').attr('src'),'https://example.org/preview.png');
    assert.equal($('pre code').text(),'keep <T>\n  source');assert.equal(cleanArticlePresentation(result,context),result);
  }
});

test('independent bookmarks and unverified opening fragments retain their paragraph boundaries',()=>{
  const card='<figure><p><a href="https://ghuntley.com/screwed/">Earlier article</a></p><p>Useful preview.</p></figure>';
  for(const [url,start,link] of [
    ['https://other.example/open-webui/','This is a follow-up to ',card],
    ['https://ghuntley.com/another/','This is a follow-up to ',card],
    ['https://ghuntley.com/open-webui/','A complete introduction.',card],
    ['https://ghuntley.com/open-webui/','This is a follow-up to ',card.replace('/screwed/','/other/')],
  ]){
    const html=`<p>${start}</p>${link}<p>but targeted more towards parents. More prose.</p>`;
    assert.equal(cleanArticlePresentation(html,{url}),html);
  }
});

test('Ghost callout decorations do not become the first paragraph',()=>{
  for(const [slug,icon] of [['z80','✨'],['stdlib','🗞️'],['agent','😎'],['slop','🎉']]){
    const prose='<p>A useful notice with <code>ls</code> and <a href="https://example.org">a link</a>.</p><p>✨ stays in later prose.</p>';
    assert.equal(cleanArticlePresentation(`<p>${icon}</p>`+prose,{url:`https://ghuntley.com/${slug}/`}),prose);
    assert.equal(cleanArticlePresentation(`<p>${icon}</p>`+prose,{url:'https://ghuntley.com/another/'}),prose);
    assert.equal(cleanArticlePresentation(`<p>${icon}</p>`+prose,{url:'https://other.example/'+slug+'/'}),`<p>${icon}</p>`+prose);
    const meaningful=`<p><a href="https://example.org">${icon}</a></p>`+prose;
    assert.equal(cleanArticlePresentation(meaningful,{url:`https://ghuntley.com/${slug}/`}),meaningful);
  }
  const hero='<blockquote>Coverage of the hackathon.</blockquote><hr>',body='<p>A field report from the event.</p><p>😎 stays in later prose.</p>';
  assert.equal(cleanArticlePresentation(hero+'<p>😎</p>'+body,{url:'https://ghuntley.com/ralph/'}),hero+body);
  const midArticle='<p>Opening prose.</p><p>😎</p><p>Later prose.</p>';
  assert.equal(cleanArticlePresentation(midArticle,{url:'https://ghuntley.com/ralph/'}),midArticle);
  const beforeHeading='<p>😎</p><h2>Later section</h2><p>Prose.</p>';
  assert.equal(cleanArticlePresentation(beforeHeading,{url:'https://ghuntley.com/ralph/'}),beforeHeading);
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

test('Claude caption labels have a word boundary without changing inline article wording',()=>{
  const context={url:'https://claude.dev/blog/example/'};
  const html='<figure><img src="/chart.png"><figcaption><b>图 2</b><span>Claude Code团队</span></figcaption></figure><p><b>图 2</b><span>正文原样</span></p>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('figcaption').text(),'图 2 Claude Code团队');
  assert.equal($('p').last().text(),'图 2正文原样');
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('legacy Claude code headers become metadata and never enter copied source',()=>{
  const context={url:'https://claude.dev/blog/example/'};
  const result=cleanArticlePresentation('<p><span>CODE<span>JavaScript</span></span></p><pre><code>const x = 1;\n</code></pre><p>CODEPython is an example name.</p><pre><code>keep()</code></pre>',context);
  const $=cheerio.load(result,null,false);
  assert.equal($('pre').first().attr('data-language'),'javascript');
  assert.equal($('pre code').first().text(),'const x = 1;\n');
  assert.equal($('p').length,1);assert.match($('p').text(),/CODEPython is/);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('Ghost player clock controls are removed only as an adjacent pair after a video',()=>{
  const context={url:'https://ghuntley.com/example/'};
  const html='<figure><p><video src="/clip.mp4"></video></p><p><span>0:00</span></p><p>/<span>0:29</span></p><figcaption>Explanation</figcaption></figure><p>0:00</p><p>/0:29</p><p>Actual prose.</p>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('figure p').length,1);assert.match($('figure').text(),/Explanation/);
  assert.equal($.root().children('p').first().text(),'0:00');
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('text-only conversations are not declared lost drawings by hostname or an unrelated article issue',()=>{
  const html='<figure><ol><li>Human: explain this.</li><li>Assistant: here is the answer.</li></ol><figcaption>A conversation</figcaption></figure><figure><p>Ordinary text.</p><figcaption>A textual example</figcaption></figure>';
  const result=cleanArticlePresentation(html,{url:'https://claude.dev/blog/example/',issues:[{kind:'missing-figure',message:'Another figure was lost.'}]});
  assert.doesNotMatch(result,/此图未保存|data-reader-figure-status/);
  assert.match(result,/Human: explain this/);assert.match(result,/Ordinary text/);
});

test('an unsupported embed has one local fallback and does not acquire a second missing-image note',()=>{
  const context={url:'https://ghuntley.com/example/'};
  const html='<figure data-reader-figure-status="missing"><p><a href="https://ghuntley.com/example/">此图未保存，查看原文</a></p><p data-reader-embed="true"><a href="https://ghuntley.com/example/">互动内容请访问原文查看。</a></p><figcaption>Original explanation.</figcaption></figure>';
  const result=cleanArticlePresentation(html,context);
  assert.doesNotMatch(result,/此图未保存/);assert.match(result,/互动内容请访问原文查看/);assert.match(result,/Original explanation/);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('legacy Ghost card metadata keeps a separator between publisher and author',()=>{
  const context={url:'https://ghuntley.com/example/'};
  const html='<figure data-reader-card="true"><p><a href="https://example.org">A linked article</a></p><p>A useful description.</p><p>The RegisterThomas Claburn</p></figure><p>The RegisterThomas Claburn appears in this example.</p>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('figure > p').last().text(),'The Register · Thomas Claburn');
  assert.equal($.root().children('p').text(),'The RegisterThomas Claburn appears in this example.');
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('valid mail links stay actionable and rejected empty anchors become ordinary wording',()=>{
  const result=sanitizeBody('<p><a href="mailto:person@example.org">Email</a> <a href="javascript:alert(1)">Unsafe</a> <a>No destination</a></p>','https://example.org');
  const $=cheerio.load(result,null,false);
  assert.equal($('a').length,1);assert.equal($('a').attr('href'),'mailto:person@example.org');
  assert.match($.root().text(),/Unsafe/);assert.match($.root().text(),/No destination/);
});

test('matching leading author and date chrome is omitted without deleting prose mentions',()=>{
  const context={url:'https://ghuntley.com/example/',publishedAt:'2025-07-19T03:00:00Z'};
  const result=cleanArticlePresentation('<p>作者 Geoffrey Huntley ， AI — 2025年7月19日</p><p>作者 Geoffrey Huntley 在这里讨论一个想法。</p>',context);
  assert.equal(result,'<p>作者 Geoffrey Huntley 在这里讨论一个想法。</p>');
  const date=cleanArticlePresentation('<p>2026年11月10日 音频</p><p>正文内容。</p>',{url:'https://developers.openai.com/blog/voice',publishedAt:'2026-11-10T03:00:00Z'});
  assert.equal(date,'<p>正文内容。</p>');
});

test('a video poster is not repeated as a second image while its description remains available',()=>{
  const context={url:'https://claude.dev/blog/claude-code-in-the-cloud/'};
  const html='<figure><p><video src="/clip.mp4" poster="/poster.png" width="1762" height="716"></video></p><p><img src="/poster.png" width="1762" height="716" alt="Timeline of three sessions"></p><figcaption>A shared caption.</figcaption></figure><figure><video poster="/another.png"></video><p><img src="/diagram.png" alt="A separate diagram"></p></figure>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('figure').first().find('img').length,0);assert.equal($('video').first().attr('aria-label'),'Timeline of three sessions');
  assert.equal($('video').first().attr('src'),'/clip.mp4');assert.equal($('figcaption').text(),'A shared caption.');assert.equal($('img').length,1);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('nested lost diagrams have one fallback without losing their nested explanations or headings',()=>{
  const context={url:'https://example.org/nested-diagram'};
  const note='<p><a href="https://example.org/nested-diagram">此图未保存，查看原文</a></p>';
  const html='<figure data-reader-figure-status="missing">'+note+'<figure data-reader-figure-status="missing">'+note+'<figcaption><h2>Implementation</h2><p>Inner explanation.</p></figcaption></figure><figcaption>Outer explanation.</figcaption></figure>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('a').length,1);assert.equal($('h2').text(),'Implementation');assert.equal($('figcaption').length,2);
  assert.match($.root().text(),/Inner explanation/);assert.match($.root().text(),/Outer explanation/);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('lost Git widgets expose their explanations as body paragraphs and preserve chapter anchor slots',()=>{
  const context={url:'https://openai.com/index/scaling-git-at-openai'};
  const html='<h2>Before</h2><figure><figure><figcaption><h2>Simulated Git server implementations</h2><p>Track independent readers and writers.</p></figcaption><p>Fetching 27 trunk packs.</p></figure><figcaption><p>Compare the approaches in the original simulation.</p></figcaption></figure><h2>After</h2>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false),outlined=withOutline(sanitizeBody(result,context.url),{excludeFigures:true});
  assert.equal($('figcaption h2,figcaption h3,figcaption h4').length,0);
  const explanation=$('p').filter((_,n)=>$(n).text()==='Track independent readers and writers.');assert.equal(explanation.parents('figure,figcaption').length,0);
  assert.match($.root().text(),/Compare the approaches/);assert.doesNotMatch($.root().text(),/Fetching 27/);
  assert.equal($('a').filter((_,n)=>$(n).text()==='此图未保存，查看原文').length,1);
  assert.deepEqual(outlined.outline.map(h=>[h.text,h.id]),[['Before','sec-1'],['After','sec-3']]);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('Chinese storage figure captions are localized labels while complete diagrams and chapter anchors stay intact',()=>{
  const context={url:'https://openai.com/index/scaling-storage-one-billion-users-part-two'};
  const figure='<figure><img src="https://example.org/diagram.png" width="800" height="600"><figcaption><p>Figure 02a · Logical partition key limits</p><h2>Different clients, the same partition key</h2></figcaption></figure>';
  const html='<h2>前文</h2><p>'+('这是关于存储架构的中文说明。'.repeat(15))+'</p>'+figure+'<h2>后文</h2>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('figure h2,figure h3,figure h4').length,0);assert.match($('figcaption').text(),/图 02a · 逻辑分区键上限/);assert.match($('figcaption').text(),/不同客户端，相同的分区键/);
  assert.equal($('img').attr('src'),'https://example.org/diagram.png');assert.doesNotMatch(result,/此图未保存/);
  assert.deepEqual(withOutline(result,{excludeFigures:true}).outline.map(h=>h.id),['sec-1','sec-3']);
  const english=cleanArticlePresentation('<p>'+('This article explains storage architecture in English. '.repeat(20))+'</p>'+figure,context);assert.match(english,/Different clients, the same partition key/);
  assert.equal(cleanArticlePresentation(result,context),result);
});

test('a storage legend icon does not stand in for a missing diagram or turn figure labels into sections',()=>{
  const context={url:'https://openai.com/index/scaling-storage-one-billion-users-part-one'};
  const html='<figure><figcaption><p>图 03 · 追踪 asyncio 延迟</p><h3>并发不等于 CPU 并行</h3><p>请求可以并发，但 CPU 执行需要排队。</p></figcaption><img src="https://example.org/icon.png" width="16" height="16"><ul><li>请求</li><li>响应</li></ul><h4>CPU 工作量低</h4><p>0.0 / 40 个示意单位</p></figure>';
  const result=cleanArticlePresentation(html,context),$=cheerio.load(result,null,false);
  assert.equal($('figure h2,figure h3,figure h4').length,0);assert.equal($('figure[data-reader-figure-status="missing"]').length,1);assert.equal($('li').length,2);
  assert.match($.root().text(),/请求可以并发/);assert.match($.root().text(),/CPU 工作量低/);assert.doesNotMatch($.root().text(),/0.0 \/ 40/);
  assert.equal(cleanArticlePresentation(result,context),result);
});
