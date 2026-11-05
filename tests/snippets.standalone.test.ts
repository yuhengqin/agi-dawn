import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanSummary,metadataAddsMarkup,plainMetadata} from '@agidawn/backend/content/snippets';

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
