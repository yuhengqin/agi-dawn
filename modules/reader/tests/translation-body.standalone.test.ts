import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as cheerio from 'cheerio';
import {translateHtml} from '../translation/body.ts';

test('copied English prose remains available but is not reported as complete Chinese translation',async()=>{
  const html='<p>This paragraph explains the production system and its operational constraints in detail.</p>';let calls=0;
  const result=await translateHtml(html,async parts=>{calls++;return {t:parts,receiptId:calls};});
  assert.equal(result.complete,false);assert.match(result.html,/operational constraints/);assert.equal(calls,2);
});

test('Chinese prose and short technical names may correctly remain unchanged',async()=>{
  const result=await translateHtml('<h2>GPT-5.4</h2><p>这是已有的中文正文。</p>',async parts=>({t:parts,receiptId:1}));
  assert.equal(result.complete,true);assert.match(result.html,/GPT-5.4/);
});
test('a literal documentation URL is not mistaken for an untranslated English sentence',async()=>{
  const html='<p><a href="https://www.erlang.org/doc/apps/dialyzer/dialyzer.html">https://www.erlang.org/doc/apps/dialyzer/dialyzer.html</a></p>';
  const result=await translateHtml(html,async parts=>({t:parts,receiptId:1}));assert.equal(result.complete,true);assert.match(result.html,/href="https:\/\/www.erlang.org/);
});

test('unsourced JSON delimiter pollution is retried while real JSON code is preserved',async()=>{
  let calls=0;
  const result=await translateHtml('<h2>Hosted tools</h2><pre><code>{"enabled":true}</code></pre>',async parts=>{calls++;return {t:parts.map(()=>calls===1?'托管工具。}]}':'托管工具'),receiptId:calls};});
  assert.equal(calls,2);assert.equal(result.complete,true);assert.match(result.html,/<h2>托管工具<\/h2>/);assert.match(result.html,/\{"enabled":true\}/);
});

test('a repaired body reuses matching verified wording and translates only new segments',async()=>{
  const old='<p>The deployment has a stable interface.</p><p>Existing explanation.</p>';
  const translation='<p>部署具有稳定的接口。</p><p>现有说明。</p>';
  const html=old+'<p>Newly recovered explanation.</p>';const sent:string[][]=[];
  const result=await translateHtml(html,async parts=>{sent.push(parts);return {t:parts.map(()=> '新恢复的说明。'),receiptId:1};},{sourceHtml:old,translatedHtml:translation});
  assert.equal(sent.length,1);assert.equal(sent[0]!.length,1);assert.match(sent[0]![0]!,/Newly recovered/);
  assert.match(result.html,/部署具有稳定的接口/);assert.match(result.html,/新恢复的说明/);assert.equal(result.complete,true);
});

test('old copied English and polluted headings are not reused as verified translations',async()=>{
  const source='<h2>Hosted tools</h2><p>This complete paragraph remains in English even though it should have been translated.</p>';
  const previous='<h2>托管工具。}]}</h2><p>This complete paragraph remains in English even though it should have been translated.</p>';
  let sent=0;const result=await translateHtml(source,async parts=>{sent+=parts.length;return {t:parts.map((_,i)=>i?'这一段现在已翻译。':'托管工具'),receiptId:1};},{sourceHtml:source,translatedHtml:previous});
  assert.equal(sent,2);assert.equal(result.complete,true);assert.doesNotMatch(result.html,/remains in English|\}\]\}/);
});
test('model names in a description list are assessed independently from prose',async()=>{
  const html='<dl><dt>GPT-6 Astra Ultra</dt><dd>$109.06</dd><dt>GPT-6.1 Sol Ultra</dt><dd>$15.12</dd><dt>GPT-6.1 Sol Medium</dt><dd>$5.27</dd></dl>';
  const result=await translateHtml(html,async parts=>({t:parts,receiptId:1}));assert.equal(result.complete,true);assert.match(result.html,/GPT-6 Astra Ultra/);assert.match(result.html,/109.06/);
});
test('table wording is translated within each cell while row and column structure stays local',async()=>{
  const html='<table><thead><tr><th>Method</th><th>Cost</th></tr></thead><tbody><tr><td><p>Full harness</p></td><td>$200</td></tr></tbody></table>';
  const result=await translateHtml(html,async parts=>{assert(parts.every(part=>!/<(?:thead|tbody|tr|td|th)[ >]/.test(part)));return {t:parts.map(part=>part.replace('Method','方法').replace('Cost','成本').replace('Full harness','完整框架')),receiptId:1};});
  const $=cheerio.load(result.html);assert.equal(result.complete,true);assert.equal($('tr').length,2);assert.equal($('th').eq(0).text(),'方法');assert.equal($('td').eq(0).text(),'完整框架');assert.equal($('td').eq(1).text(),'$200');
});

test('ordinary short English headings cannot be returned unchanged as complete translations',async()=>{
  let calls=0;
  const result=await translateHtml('<h2>Introduction</h2><h3>What Are Export Workloads?</h3>',async parts=>({t:parts,receiptId:++calls}));
  assert.equal(result.complete,false);assert.equal(calls,2);
  assert.match(result.html,/Introduction/);
});

test('adding a few Chinese characters does not translate a copied English paragraph',async()=>{
  const text='This paragraph describes the complete architecture and several important implementation details for distributed systems.';
  const result=await translateHtml('<p>'+text+'</p>',async parts=>({t:parts.map(part=>'中文'+part),receiptId:1}));
  assert.equal(result.complete,false);assert.match(result.html,/This paragraph describes/);
});

test('product labels and genuine translations retaining technical terms are accepted',async()=>{
  const result=await translateHtml('<h2>Claude Code</h2><h3>Introduction</h3><p>Use the PostgreSQL query planner to optimize production queries.</p>',async parts=>({t:parts.map(part=>part==='Introduction'?'引言':part.startsWith('Use the')?'使用 PostgreSQL 查询规划器优化生产查询。':part),receiptId:1}));
  assert.equal(result.complete,true);assert.match(result.html,/Claude Code/);assert.match(result.html,/使用 PostgreSQL/);
});

test('publisher names, people and project names are not rejected as untranslated prose',async()=>{
  const html='<p>The Register · Thomas Claburn</p><h2>underclass</h2><h2>preflight</h2>';
  const result=await translateHtml(html,async parts=>({t:parts,receiptId:1}));
  assert.equal(result.complete,true);assert.match(result.html,/The Register/);
});
