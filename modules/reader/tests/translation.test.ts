import '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createServer} from 'node:http';
import {config} from '@agidawn/backend/config';
import {stub,gate,tag} from '../../../tests/setup.ts';
import {sql,closeDb} from '@agidawn/backend/db';
import {upsertMaterial} from '@agidawn/backend/content/materials';
import {publishArticle} from '@agidawn/backend/publication/publish';
import {installModules} from '@agidawn/backend/modules';
import {stopBoss} from '@agidawn/backend/jobs/queue';
import {releaseUnknownReceipt} from '@agidawn/backend/providers/receipts';
import {buildApp} from '../../../apps/api/src/app.ts';
import reader from '../server.ts';
import {requestTranslation} from '../translation/model.ts';
import {translatePending} from '../translation/index.ts';
import {translateMetadataPending} from '../translation/metadata.ts';

let hold:ReturnType<typeof gate>|null=null,asked=gate(),invalidAnswers=false,onAnswer:(()=>void)|null=null;
const provider=await stub((_hit,req)=>{
  const body=JSON.parse(req.body);
  assert.equal(body.model,'translation-fixture');
  const {segments}=JSON.parse(body.messages[1].content) as {segments:string[]};
  asked.open();
  const reply=()=>{onAnswer?.();return {id:'translation-fixture',choices:[{message:{content:JSON.stringify({t:invalidAnswers?[]:segments.map(s=>s.includes('never keeps')?'丢失了链接。':'中文译文：'+s)})}}]};};
  return hold?hold.promise.then(reply):reply();
});
process.env.MODEL_CALLS_ENABLED='true';
process.env.LLM_MODEL='translation-fixture';
process.env.LLM_BASE_URL=provider.url+'/v1';
process.env.LLM_API_KEY='local-test-key';
config.allowPrivateNetworkFetch=true;
const app=await buildApp(),source='translate-'+tag();
installModules([reader]);
before(async()=>{
  await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'Translation fixture','rss',true)`;
  await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('llm',1000,1000,1000) ON CONFLICT(service) DO UPDATE SET per_minute=1000,per_hour=1000,per_day=1000`;
});
after(async()=>{await app.close();await provider.close();await stopBoss();await closeDb();});
const input=(html='<h2>Original section</h2><p>The model is available.</p>')=>({sourceId:source,url:'https://example.org/'+tag(),title:'Original article',bodyHtml:html,bodyText:html.replace(/<[^>]+>/g,' '),bodyStatus:'ok' as const,via:'fetch' as const,language:'en'});
async function run(){await translatePending();}
async function runAll(){const schedule=reader.schedules?.find(s=>s.name==='reader.translate');assert.ok(schedule,'reader provides automatic translation work');await schedule.run();}
async function detail(id:string){return (await app.inject('/api/site/items/'+id)).json();}

test('only newly collected foreign bodies translate, without model calls on page reads or old republication',async()=>{
  installModules([]);const old=await upsertMaterial(input());installModules([reader]);await publishArticle(old.articleId);
  const fresh=await upsertMaterial(input()),chinese=await upsertMaterial({...input('<p>这是已经用中文写好的文章。</p>'),language:'zh'});
  assert.equal((await detail(fresh.articleId)).translation??null,null);const before=provider.hits();
  await run();
  assert.equal(provider.hits(),before+1);
  const item=await detail(fresh.articleId);assert.match(item.bodyHtml,/Original section/);assert.match(item.translation.bodyHtml,/中文译文/);
  assert.equal(item.translation.complete,true);assert.match(item.translation.outline[0].text,/中文译文/);
  assert.equal((await detail(old.articleId)).translation??null,null);assert.equal((await detail(chinese.articleId)).translation??null,null);
  const calls=provider.hits();await run();await detail(fresh.articleId);assert.equal(provider.hits(),calls);
});

test('delayed bodies are eligible; code, images and link destinations survive translation',async()=>{
  const material=input('<h2>Technical section</h2><p>Read <a href="https://example.org/docs">the docs</a>, run <code>npm test</code>.<img src="https://example.org/diagram.png" alt="Diagram"></p><pre><code>const x = 1;</code></pre>');
  const pending=await upsertMaterial({...material,bodyHtml:undefined,bodyText:undefined,bodyStatus:'pending'});
  await run();assert.equal((await detail(pending.articleId)).translation??null,null);
  await upsertMaterial(material);await run();
  const item=await detail(pending.articleId);assert.match(item.translation.bodyHtml,/href="https:\/\/example.org\/docs"/);assert.match(item.translation.bodyHtml,/<code>npm test<\/code>/);assert.match(item.translation.bodyHtml,/const x = 1;/);
  const [stored]=await sql`SELECT body_html FROM reader_translations WHERE article_id=${pending.articleId}`;assert.match(stored!.body_html,/src="https:\/\/example.org\/diagram.png"/);
});

test('missing protected content is retried once, then retained as original and labelled partial',async()=>{
  const {articleId}=await upsertMaterial(input('<p>A good paragraph.</p><p>This never keeps <a href="https://example.org/safe">the link</a>.</p>'));
  await run();const item=await detail(articleId);
  assert.equal(item.translation.complete,false);assert.match(item.translation.bodyHtml,/中文译文/);assert.match(item.translation.bodyHtml,/This never keeps/);
});

test('switches and missing or stopped budgets leave work pending without sending or consuming attempts',async()=>{
  const {articleId}=await upsertMaterial(input());const before=provider.hits();
  process.env.MODEL_CALLS_ENABLED='false';await run();assert.equal(provider.hits(),before);process.env.MODEL_CALLS_ENABLED='true';
  await sql`DELETE FROM budgets WHERE service='llm'`;await run();assert.equal(provider.hits(),before);
  await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('llm',0,0,0)`;await run();assert.equal(provider.hits(),before);
  assert.equal((await sql`SELECT attempts FROM reader_translations WHERE article_id=${articleId}`)[0]!.attempts,0);
  await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='llm'`;await run();assert.ok((await detail(articleId)).translation);
});

test('saved paid answers repair business storage without a second request and licence withdrawal hides the result',async()=>{
  const {articleId}=await upsertMaterial(input());await run();const before=provider.hits();
  await sql`UPDATE reader_translations SET status='pending',body_html=NULL WHERE article_id=${articleId}`;await run();assert.equal(provider.hits(),before);assert.ok((await detail(articleId)).translation);
  await sql`UPDATE sources SET site_fulltext=false WHERE id=${source}`;
  try{const item=await detail(articleId);assert.equal(item.bodyHtml,null);assert.equal(item.translation,null);}finally{await sql`UPDATE sources SET site_fulltext=true WHERE id=${source}`;}
});

test('a source revised while the model answers never displays the previous body translation',async()=>{
  const material=input('<h2>Before revision</h2><p>The original price is ten.</p>'),{articleId}=await upsertMaterial(material);
  hold=gate();asked=gate();const active=run();await asked.promise;
  const revised={...material,bodyHtml:'<h2>After revision</h2><p>The new price is twenty.</p>',bodyText:'After revision The new price is twenty.'};
  try{
    await upsertMaterial(revised);assert.equal((await detail(articleId)).translation,null);
  }finally{const release=hold;hold=null;release.open(undefined);}
  await active;assert.equal((await detail(articleId)).translation,null);
  await run();assert.match((await detail(articleId)).translation.bodyHtml,/new price is twenty/);
});

test('nested list and quotation text outside child paragraphs is included before declaring a complete translation',async()=>{
  const {articleId}=await upsertMaterial(input('<ul><li>Parent explanation<ul><li>Child detail</li></ul>Trailing explanation</li></ul><blockquote>Quoted introduction<p>Quoted paragraph</p>Quoted conclusion</blockquote>'));
  await run();const item=await detail(articleId);
  assert.match(item.translation.bodyHtml,/中文译文：Parent explanation/);
  assert.match(item.translation.bodyHtml,/中文译文：Trailing explanation/);
  assert.match(item.translation.bodyHtml,/中文译文：Quoted introduction/);
  assert.match(item.translation.bodyHtml,/中文译文：Quoted conclusion/);
  assert.equal(item.translation.complete,true);
});

test('an unknown paid receipt waits without another request until the existing recovery mechanism releases it',async()=>{
  const {articleId}=await upsertMaterial(input());await run();
  const [receipt]=await sql`SELECT id FROM receipts WHERE purpose='translate_body' AND subject=${'article:'+articleId+'@1'}`;assert.ok(receipt);
  await sql`UPDATE receipts SET status='unknown' WHERE id=${receipt.id}`;
  await sql`UPDATE reader_translations SET status='pending',body_html=NULL WHERE article_id=${articleId}`;
  const before=provider.hits();await run();assert.equal(provider.hits(),before);
  assert.equal((await sql`SELECT attempts FROM reader_translations WHERE article_id=${articleId}`)[0]!.attempts,0);
  await sql.begin(tx=>releaseUnknownReceipt(tx,Number(receipt.id),'confirmed local test release'));
  await run();assert.equal(provider.hits(),before+1);assert.ok((await detail(articleId)).translation);
});

test('a budget stop between batches resumes from saved answers without paying for the first batch twice',async()=>{
  const html=Array.from({length:8},(_,i)=>'<p>Section '+i+' '+('A long technical explanation. '.repeat(60))+'</p>').join('');
  const {articleId}=await upsertMaterial(input(html)),[count]=await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE service='llm' AND origin='live' AND started_at>now()-interval '1 minute'`;
  await sql`UPDATE budgets SET per_minute=${Number(count!.n)+1} WHERE service='llm'`;
  const before=provider.hits();
  try{await run();assert.equal(provider.hits(),before+1);assert.equal((await detail(articleId)).translation,null);}
  finally{await sql`UPDATE budgets SET per_minute=1000 WHERE service='llm'`;}
  const [saved]=await sql`SELECT id FROM receipts WHERE purpose='translate_body' AND subject=${'article:'+articleId+'@1'}`;
  await run();assert.ok((await detail(articleId)).translation);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${saved!.id}`)[0]!.attempts,1);
});

test('model requests use the configured outbound proxy rather than attempting a direct connection',async()=>{
  let tunnels=0;const proxy=createServer();proxy.on('connect',(_request,socket)=>{tunnels++;socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const previousProxy=config.egressProxyUrl,previousBase=process.env.LLM_BASE_URL;
  config.egressProxyUrl='http://127.0.0.1:'+(proxy.address() as {port:number}).port;process.env.LLM_BASE_URL='https://translation-provider.invalid/v1';
  try{await assert.rejects(requestTranslation('proxy-'+tag(),1,['A sentence.']));assert.ok(tunnels>0,'configured proxy must receive the model connection');}
  finally{config.egressProxyUrl=previousProxy;process.env.LLM_BASE_URL=previousBase;await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
});

test('title and summary translate for summary-only articles without fetching or exposing a body',async()=>{
  const {articleId}=await upsertMaterial({...input(),title:'Metadata without full text',excerpt:'A short original summary.',bodyHtml:undefined,bodyText:undefined,bodyStatus:'pending'});
  await sql`UPDATE sources SET site_fulltext=false WHERE id=${source}`;
  try{
    await runAll();
    const item=await detail(articleId);
    assert.deepEqual(item.metadataTranslation,{title:'中文译文：Metadata without full text',summary:'中文译文：A short original summary.'});
    assert.equal(item.title,'Metadata without full text');assert.equal(item.summary,'A short original summary.');
    assert.equal(item.bodyHtml,null);assert.equal(item.translation,null);
    const list=(await app.inject('/api/site/articles?sourceId='+source)).json();
    assert.deepEqual(list.items.find((entry:{id:string})=>entry.id===articleId).metadataTranslation,item.metadataTranslation);
    const before=provider.hits();await detail(articleId);await app.inject('/api/site/articles');assert.equal(provider.hits(),before);
  }finally{await sql`UPDATE sources SET site_fulltext=true WHERE id=${source}`;}
});

test('metadata fills existing articles without retranslating saved bodies and preserves absent or Chinese fields',async()=>{
  const {articleId}=await upsertMaterial({...input(),title:'Saved body metadata',excerpt:undefined});await run();
  const [stored]=await sql`SELECT body_html FROM reader_translations WHERE article_id=${articleId}`;
  const [before]=await sql`SELECT count(*)::int AS n FROM receipts WHERE purpose='translate_body'`;
  await runAll();
  assert.deepEqual((await detail(articleId)).metadataTranslation,{title:'中文译文：Saved body metadata',summary:null});
  assert.equal((await sql`SELECT body_html FROM reader_translations WHERE article_id=${articleId}`)[0]!.body_html,stored!.body_html);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE purpose='translate_body'`)[0]!.n,before!.n);
  installModules([]);const old=await upsertMaterial({...input(),title:'An old article',excerpt:'这是已经保存的中文摘要。'});installModules([reader]);await publishArticle(old.articleId);
  const chinese=await upsertMaterial({...input(),title:'已经是中文的标题',excerpt:'这是中文摘要。',language:'zh'});
  await runAll();
  assert.deepEqual((await detail(old.articleId)).metadataTranslation,{title:'中文译文：An old article',summary:'这是已经保存的中文摘要。'});
  assert.equal((await detail(chinese.articleId)).metadataTranslation??null,null);
});

test('metadata follows effective publication values and rejects stale answers without changing body identity',async()=>{
  const {articleId}=await upsertMaterial({...input(),title:'Before metadata revision',excerpt:'Before summary.'});
  hold=gate();asked=gate();
  // Body work is already saved so the held request belongs to the title and summary.
  await sql`UPDATE reader_translations SET status='skipped' WHERE article_id=${articleId}`;
  const active=runAll();await asked.promise;
  try{
    await sql`INSERT INTO editorial_overrides(article_id,fields) VALUES(${articleId},${sql.json({title:'After metadata revision',summary:'After summary.'})})`;
    await publishArticle(articleId);
  }finally{const release=hold;hold=null;release.open(undefined);}
  await active;assert.equal((await detail(articleId)).metadataTranslation??null,null);
  await runAll();assert.deepEqual((await detail(articleId)).metadataTranslation,{title:'中文译文：After metadata revision',summary:'中文译文：After summary.'});
  await sql`UPDATE editorial_overrides SET fields=${sql.json({title:'人工中文标题',summary:'人工中文摘要。'})} WHERE article_id=${articleId}`;await publishArticle(articleId);
  assert.equal((await detail(articleId)).metadataTranslation??null,null);
  await runAll();assert.equal((await detail(articleId)).title,'人工中文标题');assert.equal((await detail(articleId)).metadataTranslation??null,null);
});

test('metadata respects switches and budgets, replays paid answers and waits on unknown receipts',async()=>{
  const {articleId}=await upsertMaterial({...input(),title:'Budgeted metadata',bodyHtml:undefined,bodyText:undefined,bodyStatus:'pending'}),before=provider.hits();
  process.env.MODEL_CALLS_ENABLED='false';await runAll();assert.equal(provider.hits(),before);process.env.MODEL_CALLS_ENABLED='true';
  await sql`UPDATE budgets SET per_minute=0,per_hour=0,per_day=0 WHERE service='llm'`;
  try{await runAll();assert.equal(provider.hits(),before);assert.equal((await sql`SELECT attempts FROM reader_metadata_translations WHERE article_id=${articleId}`)[0]!.attempts,0);}
  finally{await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='llm'`;}
  await runAll();assert.ok((await detail(articleId)).metadataTranslation);const calls=provider.hits();
  await sql`UPDATE reader_metadata_translations SET status='pending',title=NULL,summary=NULL WHERE article_id=${articleId}`;
  await runAll();assert.equal(provider.hits(),calls);assert.ok((await detail(articleId)).metadataTranslation);
  const [receipt]=await sql`SELECT id FROM receipts WHERE purpose='translate_metadata' AND subject=${'article:'+articleId+'@0'}`;assert.ok(receipt);
  await sql`UPDATE receipts SET status='unknown' WHERE id=${receipt.id}`;
  await sql`UPDATE reader_metadata_translations SET status='pending',title=NULL,summary=NULL WHERE article_id=${articleId}`;
  await runAll();assert.equal(provider.hits(),calls);assert.equal((await detail(articleId)).metadataTranslation??null,null);
  assert.equal((await sql`SELECT attempts FROM reader_metadata_translations WHERE article_id=${articleId}`)[0]!.attempts,0);
  await sql.begin(tx=>releaseUnknownReceipt(tx,Number(receipt.id),'confirmed metadata test release'));
  await runAll();assert.equal(provider.hits(),calls+1);assert.ok((await detail(articleId)).metadataTranslation);
});

test('a metadata backlog still lets a newly collected body translate in the same scheduled run',async()=>{
  const {articleId}=await upsertMaterial({...input(),title:'Fair translation scheduling'}),now=Date.now;let elapsed=0;
  Date.now=()=>now()+elapsed;onAnswer=()=>{elapsed+=241_000;onAnswer=null;};
  try{await runAll();const item=await detail(articleId);assert.ok(item.metadataTranslation);assert.ok(item.translation);}
  finally{Date.now=now;onAnswer=null;}
});

test('a round attempts at most thirty metadata articles even when all paid answers are invalid',async()=>{
  const ids:string[]=[];
  for(let i=0;i<31;i++)ids.push((await upsertMaterial({...input(),title:'Invalid metadata '+i,bodyHtml:undefined,bodyText:undefined,bodyStatus:'pending'})).articleId);
  const before=provider.hits();invalidAnswers=true;
  try{await translateMetadataPending();assert.equal(provider.hits()-before,30);}
  finally{invalidAnswers=false;await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;}
});

test('English titles and summaries containing Chinese product names still translate',async()=>{
  const title='What 通义千问 teaches us about open models',summary='Lessons from 通义千问 for building better coding agents.';
  const {articleId}=await upsertMaterial({...input(),title,excerpt:summary,bodyHtml:undefined,bodyText:undefined,bodyStatus:'pending'});
  await runAll();assert.deepEqual((await detail(articleId)).metadataTranslation,{title:'中文译文：'+title,summary:'中文译文：'+summary});
});
