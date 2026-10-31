// Raw publication, persistent manual corrections and current permissions share one public read layer.
import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {overrideFields,setVisibility} from "@agidawn/backend/admin/content";
import {publishArticle,republishSource} from "@agidawn/backend/publication/publish";
import {processArticle} from "@agidawn/backend/jobs/content";
import {stopBoss} from "@agidawn/backend/jobs/queue";
import {buildApp} from "../apps/api/src/app.ts";
const source=`publication-${tag()}`,app=await buildApp();
before(async()=>{await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'Original source','rss',true)`;});
after(async()=>{await app.close();await stopBoss();await closeDb();});
async function article(){return (await upsertMaterial({sourceId:source,url:`https://example.org/${tag()}`,title:"Original technical title",bodyText:"Original saved body",bodyHtml:"<h2>Original heading</h2><p>Original saved body</p>",bodyStatus:"ok",via:"fetch"})).articleId;}
const detail=(id:string)=>app.inject(`/api/site/items/${id}`);

test("source-supplied plain text becomes safe readable HTML",async()=>{
  const {articleId}=await upsertMaterial({sourceId:source,url:"https://example.org/"+tag(),title:"Plain text",bodyText:"Original <b>text</b>",bodyStatus:"ok",via:"fetch"});
  const item=(await detail(articleId)).json();assert.match(item.bodyHtml,/Original &lt;b&gt;text&lt;\/b&gt;/);assert.equal(item.bodyState.status,"ready");
});

test("raw material appears immediately, retains its language and needs no summary or publication date",async()=>{
  const id=await article(),response=await detail(id),item=response.json();
  assert.equal(response.statusCode,200);assert.equal(item.title,"Original technical title");assert.equal(item.summary,null);
  assert.equal(item.publishedAt,null);assert.equal(typeof item.discoveredAt,"string");assert.equal(item.bodyState.status,"ready");
  assert.match(item.bodyHtml,/Original saved body/);assert.equal(item.outline[0].text,"Original heading");
  assert.equal((await processArticle(id)).state,"ready");
  assert.equal((await sql`SELECT body_revision FROM articles WHERE id=${id}`)[0]!.body_revision,1);
  for(const field of ["score","selected","hasTranslation","note","starred","readingStatus"])assert.equal(field in item,false,field);
});

test("manual wording and visibility survive recollection, body processing and source republication",async()=>{
  const id=await article();await overrideFields(id,{fields:{title:"Corrected title",summary:"Verified summary"},version:0,reason:"correction"},"test");
  await assert.rejects(overrideFields(id,{fields:{title:"Stale edit"},version:0,reason:"stale"},"test"),{code:"conflict"});
  await publishArticle(id);assert.equal((await detail(id)).json().title,"Corrected title");
  await setVisibility(id,{visibility:"withdrawn",version:1,reason:"persistent removal"},"test");
  const [stored]=await sql`SELECT url FROM articles WHERE id=${id}`;
  await upsertMaterial({sourceId:source,url:stored!.url,title:"New source wording",bodyText:"New source body",bodyHtml:"<p>New source body</p>",bodyStatus:"ok",via:"fetch"});
  await processArticle(id);await republishSource(source);
  assert.equal((await detail(id)).statusCode,404);
  const list=(await app.inject(`/api/site/articles?sourceId=${source}`)).json();assert.ok(!list.items.some((item:{id:string})=>item.id===id));
});

test("summary-only and current source permission suppress bodies before a queued republish runs",async()=>{
  const id=await article();await setVisibility(id,{visibility:"summary-only",version:0,reason:"metadata only"},"test");
  let item=(await detail(id)).json();assert.equal(item.bodyHtml,null);assert.equal(item.bodyState.status,"not-permitted");assert.deepEqual(item.outline,[]);
  await setVisibility(id,{visibility:"public",version:1,reason:"restore visibility"},"test");
  assert.match((await detail(id)).json().bodyHtml,/Original saved body/);
  try{await sql`UPDATE sources SET site_fulltext=false WHERE id=${source}`;
    item=(await detail(id)).json();assert.equal(item.bodyHtml,null);assert.equal(item.bodyState.status,"not-permitted");
  }finally{await sql`UPDATE sources SET site_fulltext=true WHERE id=${source}`;}
});

test("paused sources retain readable history; signal and isolated sources cannot expose stale projections",async()=>{
  const id=await article();await sql`UPDATE sources SET enabled=false WHERE id=${source}`;
  try{assert.equal((await detail(id)).statusCode,200);}finally{await sql`UPDATE sources SET enabled=true WHERE id=${source}`;}
  for(const mode of ["hot_signal","isolated"]){
    try{await sql`UPDATE sources SET participation_mode=${mode} WHERE id=${source}`;
      assert.equal((await detail(id)).statusCode,404);assert.ok(!(await app.inject(`/api/site/articles?sourceId=${source}`)).body.includes(id));
    }finally{await sql`UPDATE sources SET participation_mode='editorial' WHERE id=${source}`;}
  }
});

test("source update times follow the newest visible article date and fall back after withdrawal",async()=>{
  const sourceId='source-updates-'+tag();
  await sql`INSERT INTO sources(id,name,kind) VALUES(${sourceId},'Source update dates','rss')`;
  const old=await upsertMaterial({sourceId,url:'https://example.org/'+tag(),title:'Older publication',publishedAt:new Date('2026-10-01T12:00:00Z'),via:'fetch'});
  const latest=await upsertMaterial({sourceId,url:'https://example.org/'+tag(),title:'Latest publication',publishedAt:new Date('2026-10-24T12:00:00Z'),via:'fetch'});
  const entry=async()=>{
    const response=await app.inject('/api/site/sources');assert.equal(response.statusCode,200);
    return response.json().items.find((item:{id:string})=>item.id===sourceId);
  };
  assert.equal((await entry()).latestAt,'2026-10-24T12:00:00.000Z','importing older articles does not make a source look newly updated');
  const undated=await upsertMaterial({sourceId,url:'https://example.org/'+tag(),title:'No publication date',via:'fetch'});
  await sql`UPDATE articles SET discovered_at='2026-10-26T09:00:00Z' WHERE id=${undated.articleId}`;
  await publishArticle(undated.articleId);
  assert.equal((await entry()).latestAt,'2026-10-26T09:00:00.000Z');assert.equal((await entry()).articles,3);
  await setVisibility(undated.articleId,{visibility:'withdrawn',version:0,reason:'source date scope'},'test');
  assert.equal((await entry()).latestAt,'2026-10-24T12:00:00.000Z');assert.equal((await entry()).articles,2);
  await setVisibility(latest.articleId,{visibility:'withdrawn',version:0,reason:'source date scope'},'test');
  assert.equal((await entry()).latestAt,'2026-10-01T12:00:00.000Z');
  await setVisibility(old.articleId,{visibility:'withdrawn',version:0,reason:'source date scope'},'test');
  assert.equal(await entry(),undefined,'a source with no visible articles has no stale update date');
});

test("identical republication preserves its freshness; public address changes advance the projection",async()=>{
  const id=await article(),row=async()=>({...((await sql`SELECT updated_at,revision,url FROM publications WHERE article_id=${id}`)[0])});
  const before=await row();assert.equal((await publishArticle(id))!.changed,false);assert.deepEqual(await row(),before);
  const url=`https://example.org/corrected-${tag()}`;await sql`UPDATE articles SET url=${url} WHERE id=${id}`;
  assert.equal((await publishArticle(id))!.changed,true);const after=await row();assert.equal(after.url,url);assert.equal(after.revision,before.revision+1);
});

test("old public outlets expose no content",async()=>{
  for(const url of ["/api/v1/items","/api/mcp","/feed.xml","/feed/all.xml","/api/v1/agent","/api/site/hot","/api/site/reports/daily","/llms.txt","/openapi-v1.json","/items/example/markdown"]){
    for(const method of ["GET","HEAD","OPTIONS"] as const){const response=await app.inject({method,url});assert.ok([404,410].includes(response.statusCode),`${method} ${url}: ${response.statusCode}`);}
  }
});
