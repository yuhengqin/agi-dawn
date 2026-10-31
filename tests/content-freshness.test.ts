// Catalogue tails remain readable without treating discovery time as publication time.
// Verified source dates can revise material timing while explicit backfill remains preserved.
import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { config } from '@agidawn/backend/config';
import { sql, closeDb } from '@agidawn/backend/db';
import { upsertMaterial } from '@agidawn/backend/content/materials';
import { extractArticleBody } from '@agidawn/backend/content/extract';
import { collectSource } from '@agidawn/backend/sources/collect';
import { stopBoss } from '@agidawn/backend/jobs/queue';
import { buildApp } from '../apps/api/src/app.ts';

const T=tag(), SOURCE=`freshness-${T}`;
const body='This page describes an existing model released in 2025. Its benchmark scores and pricing are reference data, with no announcement of a new change. '.repeat(5);
let listing: Array<{title:string;url:string;date:string|null;summary:string}>=[];
let html='';
const server=http.createServer((req,res)=>{
  res.setHeader('content-type',req.url==='/list'?'application/json':'text/html');
  res.end(req.url==='/list'?JSON.stringify(listing):html);
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
config.allowPrivateNetworkFetch=true;
const app=await buildApp();
before(async()=>{
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,config,cursor,next_fetch_at)
    VALUES(${SOURCE},'Research catalogue','json_list','T1','editorial',${sql.json({url:base+'/list',titlePaths:['title'],urlTemplate:'{raw:url}',publishedAtPath:'date',summaryPaths:['summary'],summaryIsBody:true})},${sql.json({initializedAt:new Date().toISOString()})},'2100-01-01')`;
});
after(async()=>{await app.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await stopBoss();await closeDb();});
const row=async(id:string)=>(await sql`SELECT * FROM articles WHERE id=${id}`)[0]!;

test('an undated catalogue tail stays readable with discovery time',async()=>{
  const now=new Date();
  listing=Array.from({length:60},(_,i)=>({url:`${base}/known-${i}`,title:`Known ${i}`,date:now.toISOString(),summary:body}));
  await collectSource(SOURCE);
  listing.push({url:base+'/old-model',title:'Old model data',date:null,summary:body});
  assert.equal((await collectSource(SOURCE)).created,1);
  const [a]=await sql`SELECT * FROM articles WHERE url=${base+'/old-model'}`;
  assert.equal(a!.published_at,null);
  assert.equal(a!.backfill,true,'unknown publication time does not establish recency');
  const detail=await app.inject({method:'GET',url:`/api/site/items/${a!.id}`});
  assert.equal(detail.statusCode,200,'the material remains readable');
  const item=detail.json() as {publishedAt:string|null;discoveredAt:unknown};
  assert.equal(item.publishedAt,null);
  assert.equal(typeof item.discoveredAt,'string');
  for(const url of ['/api/v1/items','/api/site/timeline','/feed.xml']){
    const res=await app.inject({method:'GET',url});assert.equal(res.statusCode,404,url);
  }
});

test('an original source can supply a missing date without changing the text; discovery and explicit backfill are preserved',async()=>{
  const discoveredAt=new Date();
  for(const mode of ['old','fresh','first-import'] as const){
    const material={sourceId:SOURCE,url:`${base}/later-${mode}`,title:'Unchanged material',bodyText:body,via:'fetch' as const,discoveredAt,backfill:mode==='first-import'?'first-import':null};
    const created=await upsertMaterial(material);
    const publishedAt=new Date(discoveredAt.getTime()-(mode==='old'?180*86400000:3600000));
    const updated=await upsertMaterial({...material,publishedAt});
    assert.equal(updated.revised,true,'verified time changes the material revision');
    const a=await row(created.articleId);
    assert.equal(a.published_at.getTime(),publishedAt.getTime());
    assert.equal(a.discovered_at.getTime(),discoveredAt.getTime());
    assert.equal(a.backfill,mode!=='fresh');
    assert.equal(a.timeline_at.getTime(),mode==='fresh'?discoveredAt.getTime():publishedAt.getTime());
    assert.equal((await upsertMaterial({...material,publishedAt})).revised,false);
  }
});

test('body extraction uses page publication metadata, never its updated time or a model release in the prose',async()=>{
  const publishedAt=new Date(Date.now()-200*86400000).toISOString();
  for(const mode of ['published','modified-only'] as const){
    html=`<html><head><title>Model reference</title>${mode==='published'?`<meta property="article:published_time" content="${publishedAt}">`:''}<meta property="article:modified_time" content="${new Date().toISOString()}"></head><body><article><h1>Model reference</h1><p>${body}</p></article></body></html>`;
    const {articleId}=await upsertMaterial({sourceId:SOURCE,url:`${base}/extract-${mode}`,title:'Model reference',via:'fetch'});
    assert.equal(await extractArticleBody(articleId),'ok');
    const a=await row(articleId);
    assert.equal(a.published_at?.toISOString()??null,mode==='published'?publishedAt:null);
    assert.equal(a.backfill,true);
  }
});

test('the second fetch of an initial catalogue still archives its undated remainder',async()=>{
  const id=`first-${T}`;
  await sql`INSERT INTO sources(id,name,kind,config,next_fetch_at) SELECT ${id},name,kind,config||'{"_agidawn":{"initialBackfillLimit":1}}'::jsonb,'2100-01-01' FROM sources WHERE id=${SOURCE}`;
  listing=[0,1,2].map(i=>({url:`${base}/initial-${i}`,title:`Reference ${i}`,date:null,summary:body}));
  assert.equal((await collectSource(id)).created,1);
  assert.equal((await collectSource(id)).created,2);
  const rows=await sql`SELECT backfill FROM articles WHERE source_id=${id}`;
  assert.equal(rows.length,3);assert.ok(rows.every(a=>a.backfill));
});
