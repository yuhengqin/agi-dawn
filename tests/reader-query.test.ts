import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@agidawn/backend/db";
import { stopBoss } from "@agidawn/backend/jobs/queue";
import { upsertMaterial } from "@agidawn/backend/content/materials";
import * as pool from "@agidawn/backend/publication/pool";

after(async () => { await stopBoss(); await closeDb(); });

test("reader numbered pages count matching articles, jump directly and protect restricted body search", async () => {
  assert.equal(typeof pool.loadReaderList, "function");
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,site_fulltext,tags)
    VALUES ('reader-query','Reader query','rss','T1','editorial',true,ARRAY['agent'])`;
  const discovered = new Date("2026-10-26T16:00:00Z");
  const rows = Array.from({ length: 2105 }, (_, i) => ({
    id: `reader-query-${String(i).padStart(5, "0")}`, source_id: "reader-query", identity_key: `reader-query:${i}`,
    url: `https://example.com/reader-query/${i}`, title: `Original article ${i}`, discovered_at: discovered,
    timeline_at: discovered, body_status: "pending",
  }));
  await sql`INSERT INTO articles ${sql(rows)}`;
  await sql`INSERT INTO publications (article_id,source_id,title,url,channel,first_party,eligible,timeline_at,sort_at,discovered_at,search_text)
    SELECT id,source_id,title,url,'news',true,true,discovered_at,discovered_at,discovered_at,lower(title) FROM articles WHERE source_id='reader-query'`;
  const ids = new Set<string>();
  for(let number=1;number<=22;number++) {
    const page = await pool.loadReaderList({ sourceId: "reader-query", limit: 100, page:number });
    assert.equal(page.total,2105);assert.equal(page.pageCount,22);assert.equal(page.page,number);assert.equal(page.limit,100);
    for (const item of page.items) { assert.ok(!ids.has(item.id), "no duplicate at tied timestamps"); ids.add(item.id); }
  }
  assert.equal(ids.size, 2105);
  assert.ok(ids.has("reader-query-00000"));
  const first = await pool.loadReaderList({ sourceId: "reader-query", from: "2026-10-27", to: "2026-10-27" });
  assert.equal(first.items.length,25,"default size and inclusive Shanghai calendar boundary");assert.equal(first.total,2105);assert.equal(first.pageCount,85);
  for(const [limit,firstId] of [[25,'reader-query-02054'],[50,'reader-query-02004'],[100,'reader-query-01904']] as const){
    const page=await pool.loadReaderList({sourceId:'reader-query',q:'Original article',limit,page:3});
    assert.equal(page.items.length,limit);assert.equal(page.items[0]!.id,firstId);assert.equal(page.total,2105);
  }
  const last=await pool.loadReaderList({sourceId:'reader-query',limit:100,page:Number.MAX_SAFE_INTEGER});
  assert.equal(last.page,22);assert.equal(last.items.length,5);assert.equal(last.items.at(-1)!.id,'reader-query-00000');
  const empty=await pool.loadReaderList({sourceId:'reader-query',to:'2026-10-26',page:99});
  assert.deepEqual(empty,{items:[],total:0,page:1,limit:25,pageCount:0});
  for (const query of [{limit:0},{limit:40},{limit:101},{page:0},{page:-1},{page:1.5},{page:Infinity},{page:Number.MAX_SAFE_INTEGER+1},{from:"2026-02-30"},{q:"a".repeat(201)}]) {
    await assert.rejects(pool.loadReaderList(query));
  }
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id='reader-query-02104'`;
  const visible=await pool.loadReaderList({sourceId:'reader-query',q:'Original article'});
  assert.equal(visible.total,2104);assert.equal(visible.items[0]!.id,'reader-query-02103');
  const { articleId } = await upsertMaterial({ sourceId: "reader-query", title: "Long original", url: "https://example.com/long-reader",
    bodyText: "preface ".repeat(2000) + " uniquetailreader", bodyHtml: "<p>Long original uniquetailreader</p>", bodyStatus: "ok", via: "fetch" });
  assert.ok((await pool.loadReaderList({ q: "uniquetailreader" })).items.some(i => i.id === articleId));
  await sql`UPDATE sources SET site_fulltext=false WHERE id='reader-query'`;
  const restricted=await pool.loadReaderList({ q: "uniquetailreader" });
  assert.equal(restricted.items.length,0,"revocation immediately protects body matches");assert.equal(restricted.total,0);
  assert.ok((await pool.loadReaderList({ q: "Long original" })).items.some(i => i.id === articleId));
});

test("topic pagination reaches articles within the same millisecond and at identical timestamps", async () => {
  await sql`INSERT INTO sources(id,name,kind) VALUES('reader-precision','Precise dates','rss')`;
  await sql`INSERT INTO article_topics(slug,name,group_key,definition,tags)
    VALUES('reader-precision','Precise topic','field','Timestamp pagination',ARRAY['reader-precision'])`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    SELECT id,'reader-precision',id,'https://example.com/'||id,'Precise topic article',at,at
    FROM (VALUES
      ('reader-precision-z','2026-10-27T12:00:00.123456Z'::timestamptz),
      ('reader-precision-y','2026-10-27T12:00:00.123456Z'::timestamptz),
      ('reader-precision-x','2026-10-27T12:00:00.123400Z'::timestamptz),
      ('reader-precision-w','2026-10-27T12:00:00.122999Z'::timestamptz)
    ) AS fixture(id,at)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    SELECT 'reader-precision-lead-'||n,'reader-precision','reader-precision-lead-'||n,'https://example.com/precise/'||n,
      'Precise topic article','2026-10-28T00:00:00Z','2026-10-28T00:00:00Z' FROM generate_series(1,24) AS n`;
  await sql`INSERT INTO publications(article_id,source_id,title,url,channel,first_party,eligible,timeline_at,sort_at,discovered_at,tags,search_text)
    SELECT id,source_id,title,url,'news',true,true,discovered_at,discovered_at,discovered_at,ARRAY['reader-precision'],'precise topic article'
    FROM articles WHERE source_id='reader-precision'`;
  for(const q of [undefined,'Precise']){
    const ids:string[]=[];
    for(const number of [1,2]){
      const page=await pool.loadReaderList({topic:'reader-precision',q,page:number});
      assert.equal(page.total,28);assert.equal(page.pageCount,2);
      ids.push(...page.items.map(item=>item.id));
    }
    assert.equal(new Set(ids).size,28);
    assert.deepEqual(ids.slice(24),['reader-precision-z','reader-precision-y','reader-precision-x','reader-precision-w']);
  }
});

test('article API validates page and size parameters before querying',async()=>{
  const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();
  try{
    for(const query of ['page=0','page=-1','page=1.5','page=1e2','page=Infinity','page=9007199254740992','limit=40','limit=26','limit=25.0','limit=101','page=','cursor=retired']){
      const response=await app.inject('/api/site/articles?'+query);
      assert.equal(response.statusCode,400,query);assert.equal(response.json().code,'invalid_request');
    }
    for(const limit of [25,50,100]){
      const response=await app.inject('/api/site/articles?sourceId=missing&page=3&limit='+limit);
      assert.equal(response.statusCode,200,response.body);
      assert.deepEqual(response.json(),{items:[],total:0,page:1,limit,pageCount:0});
    }
  }finally{await app.close();}
});

test("anonymous engagement counts visible opens once per half hour and makes likes idempotent",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts"),{config}=await import("@agidawn/backend/config");
  const app=await buildApp(),site=new URL(config.siteUrl),origin=site.origin;
  try{
    await sql`INSERT INTO sources(id,name,kind) VALUES('engagement-test','Engagement','rss')`;
    const {articleId:id}=await upsertMaterial({sourceId:'engagement-test',title:'Engagement test',url:'https://example.com/engagement',bodyStatus:'pending',via:'fetch'});
    const initial=await app.inject({url:'/api/site/engagement?ids='+id});
    assert.equal(initial.statusCode,200);assert.deepEqual(initial.json().items,[{id,views:0,likes:0,liked:false}]);
    const cookie=String(initial.headers['set-cookie']).split(';')[0]!;
    assert.match(String(initial.headers['set-cookie']),/HttpOnly/);
    const request=(method:'POST'|'PUT'|'DELETE',action:string,identity=cookie)=>app.inject({method,url:`/api/site/items/${id}/${action}`,headers:{host:site.host,origin,cookie:identity,'content-type':'application/json'},payload:{}});
    await app.inject({url:'/api/site/items/'+id});
    assert.equal((await pool.loadReaderList({sourceId:'engagement-test'})).items[0]!.engagement.views,0);
    const views=await Promise.all(Array.from({length:8},()=>request('POST','view')));
    assert.ok(views.every(r=>r.statusCode===200));
    assert.equal((await request('POST','view')).json().views,1);
    await sql`UPDATE article_engagement SET viewed_at=now()-interval '31 minutes' WHERE article_id=${id}`;
    assert.equal((await request('POST','view')).json().views,2);
    await Promise.all(Array.from({length:8},()=>request('PUT','like')));
    assert.deepEqual((await request('PUT','like')).json(),{id,views:2,likes:1,liked:true});
    const second=await app.inject({url:'/api/site/engagement?ids='+id});
    const otherCookie=String(second.headers['set-cookie']).split(';')[0]!;
    assert.equal(second.json().items[0].liked,false);
    assert.equal((await request('PUT','like',otherCookie)).json().likes,2);
    assert.equal((await request('DELETE','like')).json().likes,1);
    assert.equal((await request('DELETE','like')).json().likes,1);
    assert.equal((await pool.loadReaderList({sourceId:'engagement-test'})).items[0]!.engagement.likes,1);
    assert.equal((await app.inject({method:'PUT',url:`/api/site/items/${id}/like`,headers:{host:site.host,origin:'https://elsewhere.example',cookie,'content-type':'application/json'},payload:{}})).statusCode,403);
    assert.equal((await request('PUT','like','')).statusCode,400);
    await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${id}`;
    assert.equal((await request('POST','view')).statusCode,404);
    assert.equal((await request('PUT','like')).statusCode,404);
    assert.deepEqual((await app.inject({url:'/api/site/engagement?ids='+id,headers:{cookie}})).json().items,[]);
  }finally{await app.close();}
});

test("anonymous engagement accepts the SSH-forwarded origin and rejects cross-origin writes",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts");
  const app=await buildApp(),origin='http://localhost:8123',host='localhost:8123';
  try{
    await sql`INSERT INTO sources(id,name,kind) VALUES('engagement-forwarded','Forwarded engagement','rss')`;
    const {articleId:id}=await upsertMaterial({sourceId:'engagement-forwarded',title:'Forwarded engagement',url:'https://example.com/engagement-forwarded',bodyStatus:'pending',via:'fetch'});
    const initial=await app.inject({url:'/api/site/engagement?ids='+id,headers:{host}});
    assert.equal(initial.statusCode,200);
    const cookie=String(initial.headers['set-cookie']).split(';')[0]!;
    const request=(method:'POST'|'PUT'|'DELETE',action:string,headers:Record<string,string>={})=>app.inject({method,url:`/api/site/items/${id}/${action}`,headers:{host,origin,cookie,'content-type':'application/json','sec-fetch-site':'same-origin',...headers},payload:{}});
    assert.equal((await request('POST','view')).statusCode,200);
    assert.deepEqual((await request('POST','view')).json(),{id,views:1,likes:0,liked:false});
    assert.deepEqual((await request('PUT','like')).json(),{id,views:1,likes:1,liked:true});
    assert.deepEqual((await request('DELETE','like')).json(),{id,views:1,likes:0,liked:false});
    const rejectedHeaders:Record<string,string>[]=[
      {origin:'https://elsewhere.example'},
      {host:'elsewhere.example',origin:'http://elsewhere.example'},
      {origin:'http://localhost:3000'},
      {origin:'http://localhost:8124'},
      {origin:'https://localhost:8123'},
      {origin:'null'},
      {origin:''},
      {origin:'not-an-origin'},
      {'sec-fetch-site':'cross-site'},
      {origin:'https://elsewhere.example','x-forwarded-host':'elsewhere.example','x-forwarded-proto':'https'},
      {origin:'http://localhost:8124','x-forwarded-host':'localhost:8124'},
    ];
    for(const headers of rejectedHeaders){
      for(const [method,action] of [['POST','view'],['PUT','like'],['DELETE','like']] as const){
        assert.equal((await request(method,action,headers)).statusCode,403);
      }
    }
    assert.deepEqual((await app.inject({url:'/api/site/engagement?ids='+id,headers:{host,cookie}})).json().items,[{id,views:1,likes:0,liked:false}]);
  }finally{await app.close();}
});
