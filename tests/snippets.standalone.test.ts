import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanSummary,metadataAddsMarkup,plainMetadata} from '@agidawn/backend/content/snippets';
import {articleIntro,estimateReadingMinutes,isTruncatedExcerpt} from '@agidawn/backend/content/reading';
import {matchRanges,searchWords} from '@agidawn/contracts/search';
import {toReaderItem,type ReaderRow} from '@agidawn/backend/publication/items';

test('summary cleanup removes a matching RSS footer without hiding useful short text',()=>{
  const context={title:'A new offer',url:'https://blogs.microsoft.com/blog/offer/'};
  assert.equal(cleanSummary('A useful introduction. The post A new offer appeared first on The Official Microsoft Blog .',context),'A useful introduction.');
  assert.equal(cleanSummary('We discuss how The post X appeared first on Y works.',context),'We discuss how The post X appeared first on Y works.');
  assert.equal(cleanSummary('GPU 开始走向端侧。',context),'GPU 开始走向端侧。');
  assert.equal(cleanSummary('Use <model> & keep &lt;literal&gt; unchanged.',context),'Use <model> & keep &lt;literal&gt; unchanged.');
});

test('known source noise is omitted without applying a length threshold',()=>{
  assert.equal(cleanSummary('Uber',{title:'A rollout',url:'https://www.uber.com/us/en/blog/rollout/'}),null);
  assert.equal(cleanSummary('Uber',{title:'A rollout',url:'https://other.example/article'}),'Uber');
  assert.equal(cleanSummary('An intact sentence. eMudhra title eMudhra title Now you&',{url:'https://ghuntley.com/patch/'}),'An intact sentence.');
  assert.equal(cleanSummary('AT&T',{url:'https://ghuntley.com/patch/'}),'AT&T');
  assert.equal(cleanSummary('A & B',{url:'https://ghuntley.com/patch/'}),'A & B');
});

test('a Ghost audio preview omits flattened player controls and list syntax',()=>{
  const text='0:00 /11:14 1× An introduction. * First point. * Second point.';
  assert.equal(cleanSummary(text,{url:'https://ghuntley.com/example/'}),'An introduction. First point. Second point.');
  assert.equal(cleanSummary('Use * as a wildcard.',{url:'https://ghuntley.com/example/'}),'Use * as a wildcard.');
  assert.equal(cleanSummary(text,{url:'https://other.example/'}),text);
});

test('snippet truncation uses cleaned wording while preserving the metadata translation identity',()=>{
  const summary='0:00 /11:14 1× The opening explains the production system and its operational';
  const row:ReaderRow={id:'audio',title:'An interview',summary,source_id:'ghuntley',source_name:'Geoffrey Huntley',author:null,url:'https://ghuntley.com/interview/',published_at:null,discovered_at:new Date(),sort_at:new Date(),category:null,tags:[],body_status:'ok',body_revision:1,site_fulltext:true,visibility:'public',manual_visibility:null,processing_state:'new',body_quality:'ready',body_issues:[],views:0,likes:0,reading_text:'The opening explains the production system and its operational constraints.'};
  const item=toReaderItem(row);assert.equal(item.summary,summary);assert.equal(item.summaryTruncated,true);
});

test('legacy metadata wrappers are removed while original literal tags remain text',()=>{
  assert.equal(plainMetadata('计划 <a id="L0">推出计划</a>。','A plan.'),'计划 推出计划。');
  assert.equal(plainMetadata('使用 <model> 与 <code>。','Use <model> and <code>.'),'使用 <model> 与 <code>。');
  assert.equal(metadataAddsMarkup('A plan.','计划 <a id="L0">链接</a>。'),true);
  assert.equal(metadataAddsMarkup('Use <model>.','使用 <model>。'),false);
  assert.equal(metadataAddsMarkup('A < B & C > D','甲 < 乙 & 丙 > 丁'),false);
});

test('translated RSS footer is removed after unwrapping legacy links',()=>{
  const summary='微软分享了新计划。<a id="L0">推出自愿离职计划</a>一文最初发布于<a id="L1">微软官方博客</a>。';
  assert.equal(cleanSummary(plainMetadata(summary,'Microsoft shared a new offer.'),{title:'推出自愿离职计划',url:'https://blogs.microsoft.com/blog/offer/'}),'微软分享了新计划。');
});

test('detail intros suppress an identical or clearly truncated opening without changing useful summaries',()=>{
  const text='A long opening paragraph that already introduces the article and its argument.';
  assert.equal(articleIntro(text,`<p>${text}</p>`),null);
  assert.equal(articleIntro(text.slice(0,48)+'…',`<p>${text}</p>`),null);
  assert.equal(articleIntro('A useful independent summary.',`<p>${text}</p>`),'A useful independent summary.');
  assert.equal(articleIntro('Summary without full text.',null),'Summary without full text.');
  assert.equal(articleIntro('中文摘要采用另一种译法。','<p>中文正文开头的措辞不完全一样。</p>',{summary:text,html:`<p>${text}</p>`}),null,'independent translations cannot make an original opening excerpt into new information');
});

test('detail intros recognize opening excerpts spanning paragraphs and leading quotations',()=>{
  const first='This opening explains the motivation behind the production system.';
  const second='The next paragraph describes how the architecture works in practice.';
  const excerpt=first+' '+second.slice(0,43);
  assert.equal(articleIntro(excerpt,`<p>${first}</p><p>${second}</p><h2>Next section</h2>`),null);
  assert.equal(articleIntro(first,`<blockquote><p>${first}</p></blockquote><p>Discussion follows.</p>`),null);
  assert.equal(articleIntro('另一种译法的开头摘录。','<p>中文正文。</p>',{summary:excerpt,html:`<p>${first}</p><p>${second}</p>`}),null);
  assert.equal(articleIntro('An independent summary with new information.',`<p>${first}</p><p>${second}</p>`),'An independent summary with new information.');
});

test('reading estimates support Chinese and English and search highlighting shares English edges',()=>{
  assert.equal(searchWords('one two three four five six seven').length,7,'private query validation must see every word before applying its six-word limit');
  assert.equal(estimateReadingMinutes(''),null);assert.equal(estimateReadingMinutes('汉'.repeat(700)),2);assert.equal(estimateReadingMinutes('word '.repeat(440)),2);
  assert.deepEqual(matchRanges('read ad stack ad',searchWords('ad')),[{start:5,end:7},{start:14,end:16}]);
  assert.deepEqual(matchRanges('Use C++ and foo.bar',searchWords('C++ foo.bar')),[{start:4,end:7},{start:12,end:19}]);
});

test('an ellipsis is justified by an actual opening excerpt, not missing punctuation alone',()=>{
  const excerpt='A reasonably long opening that stops before the full sentence';
  assert.equal(isTruncatedExcerpt(excerpt,excerpt+' has finished.'),true);
  assert.equal(isTruncatedExcerpt(excerpt,'An unrelated article about another subject.'),false);
  assert.equal(isTruncatedExcerpt('A useful short summary',null),false);
  assert.equal(isTruncatedExcerpt('A complete sentence.','A complete sentence. More content.'),false);
});
