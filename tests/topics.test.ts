import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {overrideFields} from "@agidawn/backend/admin/content";
import {listTopicSummaries} from "@agidawn/backend/publication/topics";
import {loadReaderList} from "@agidawn/backend/publication/pool";
import {buildApp} from "../apps/api/src/app.ts";
import {addCategory} from '@agidawn/backend/admin/categories';
import {stopBoss} from '@agidawn/backend/jobs/queue';
import type {ReaderListQuery,TopicsResponse} from '@agidawn/contracts/site';
const app=await buildApp();after(async()=>{await app.close();await stopBoss();await closeDb();});
test("source tags and manual article tags determine topic membership without model classifications",async()=>{
  const source=tag(),slug="topic-"+source,tagName="tag-"+source;
  await sql`INSERT INTO article_topics(slug,name,group_key,definition,tags) VALUES(${slug},'Test topic','field','Test',${[tagName]})`;
  try{
    await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Topic fixture','rss',${[tagName]})`;
    const {articleId}=await upsertMaterial({sourceId:source,url:"https://example.org/"+source,title:"Topic article",via:"fetch"});
    assert.deepEqual((await loadReaderList({topic:slug})).items.map(i=>i.id),[articleId]);
    assert.equal((await listTopicSummaries()).topics.find(t=>t.slug===slug)!.total,1);
    assert.ok((await app.inject("/api/site/items/"+articleId)).json().topics.some((t:{slug:string})=>t.slug===slug));
    await overrideFields(articleId,{fields:{tags:[]},version:0,reason:"adjust topics"},"test");
    assert.equal((await loadReaderList({topic:slug})).items.length,0);
    assert.deepEqual((await app.inject("/api/site/articles?topic="+slug)).json().items,[],"configured empty topics remain valid filters");
    assert.equal((await app.inject("/api/site/articles?topic=does-not-exist")).statusCode,400);
  }finally{await sql`DELETE FROM article_topics WHERE slug=${slug}`;}
});

test('topic facets use the public article filters and retain zero-count alternatives',async()=>{
  const source='facet-'+tag(),other=source+'-other',first=source+'-one',second=source+'-two',empty=source+'-empty';
  const category=await addCategory({name:'Facet '+tag()},'test');
  await sql`INSERT INTO article_topics(slug,name,group_key,definition,tags) VALUES
    (${first},'First facet','field','First',${[first,first+'-alias']}),
    (${second},'Second facet','field','Second',${[second]}),
    (${empty},'Empty facet','field','Empty',${[empty]})`;
  await sql`INSERT INTO sources(id,name,kind,tags,site_fulltext) VALUES
    (${source},'Facet fixture','rss',${[first,first+'-alias',second]},true),
    (${other},'Other fixture','rss',${[first]},true)`;
  const ids:string[]=[];
  for(const [at,sourceId,categorized] of [
    ['2026-10-26T16:00:00Z',source,true],['2026-10-27T04:00:00Z',source,false],
    ['2026-10-26T15:59:59Z',source,true],['2026-10-27T16:00:00Z',source,true],
    ['2026-10-27T05:00:00Z',other,true],
  ] as const){
    const {articleId}=await upsertMaterial({sourceId,title:'Facet article '+ids.length,url:`https://example.org/${source}/${ids.length}`,publishedAt:new Date(at),via:'fetch',bodyStatus:'ok',bodyHtml:'<p>Original body evidence.</p>',bodyText:'Original body evidence.'});
    if(categorized)await overrideFields(articleId,{fields:{category:category.id},version:0,reason:'fixture'},'test');
    ids.push(articleId);
  }
  const facets=async(query:Record<string,string>={})=>{
    const response=await app.inject('/api/site/topics?'+new URLSearchParams(query));
    assert.equal(response.statusCode,200,response.body);assert.match(response.headers['cache-control']!,/no-store/);
    return response.json<TopicsResponse>().topics.filter(topic=>[first,second,empty].includes(topic.slug));
  };
  const total=(topics:TopicsResponse['topics'],slug:string)=>topics.find(topic=>topic.slug===slug)!.total;
  assert.equal(total(await facets(),first),5);
  assert.equal(total(await facets({sourceId:source}),first),4,'multiple matching tags count each article once');
  const combined={sourceId:source,category:category.id,from:'2026-10-27',to:'2026-10-27',q:'Facet article'};
  const selected=await facets(combined);assert.equal(total(selected,first),1);assert.equal(total(selected,second),1);
  assert.equal(total(selected,empty),0);assert.equal(selected.find(topic=>topic.slug===first)!.latest!.title,'Facet article 0');
  const queries:Record<string,string>[]=[{sourceId:other},{sourceId:source,category:'uncategorized'},{from:'2026-10-27'},{to:'2026-10-26'},combined,{...combined,q:'missingterm'}];
  for(const query of queries){
    const summaries=await facets(query);
    for(const topic of summaries)assert.equal(topic.total,(await loadReaderList({...query,topic:topic.slug} as ReaderListQuery)).total,JSON.stringify({query,topic:topic.slug}));
  }
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[0]!}`;
  const withdrawn=await facets(combined);assert.equal(total(withdrawn,first),0);assert.equal(withdrawn.find(topic=>topic.slug===first)!.latest,null);
  assert.equal(total(await facets(),first),4,'unfiltered exploration keeps the global scope');
});

test('topic search counts follow translation revisions and current fulltext permission',async()=>{
  const {installModules,serverModules}=await import('@agidawn/backend/modules'),{default:reader}=await import('../modules/reader/server.ts');
  const installed=serverModules();installModules([reader]);
  try{
    const source='facet-search-'+tag(),slug=source+'-topic';
    await sql`INSERT INTO article_topics(slug,name,group_key,definition,tags) VALUES(${slug},'Search facet','field','Search',${[slug]})`;
    await sql`INSERT INTO sources(id,name,kind,tags,site_fulltext) VALUES(${source},'Search fixture','rss',${[slug]},true)`;
    const {articleId:id}=await upsertMaterial({sourceId:source,title:'Original title',excerpt:'Original summary',url:`https://example.org/${source}`,bodyHtml:'<p>Original body.</p>',bodyText:'Original body.',bodyStatus:'ok',via:'fetch'});
    const [article]=await sql`SELECT body_html,body_revision FROM articles WHERE id=${id}`;
    await sql`INSERT INTO reader_metadata_translations(article_id,source_title,source_summary,title,summary,status) VALUES(${id},'Original title','Original summary','可检索标题','中文摘要','translated')`;
    await sql`INSERT INTO reader_translations(article_id,body_revision,source_html,body_html,status,complete) VALUES(${id},${article!.body_revision},${article!.body_html},'<p>人工<em>智能</em> 正文证据</p>','translated',true)
      ON CONFLICT(article_id) DO UPDATE SET body_revision=excluded.body_revision,source_html=excluded.source_html,body_html=excluded.body_html,status=excluded.status,complete=true`;
    const count=async(q:string)=>{
      const response=await app.inject('/api/site/topics?'+new URLSearchParams({sourceId:source,q}));assert.equal(response.statusCode,200,response.body);
      const total=response.json<TopicsResponse>().topics.find(topic=>topic.slug===slug)!.total;
      assert.equal(total,(await loadReaderList({sourceId:source,q,topic:slug})).total);return total;
    };
    assert.equal(await count('人工智能'),1);assert.equal(await count('可检索标题'),1);
    await sql`UPDATE sources SET site_fulltext=false WHERE id=${source}`;
    assert.equal(await count('人工智能'),0);assert.equal(await count('可检索标题'),1);
    await sql`UPDATE sources SET site_fulltext=true WHERE id=${source}`;
    await sql`UPDATE articles SET body_revision=body_revision+1 WHERE id=${id}`;
    assert.equal(await count('人工智能'),0);
    await sql`UPDATE publications SET title='Changed title' WHERE article_id=${id}`;
    assert.equal(await count('可检索标题'),0);
  }finally{installModules(installed);}
});

test('topic facet queries reject invalid and unrelated filters',async()=>{
  for(const query of ['from=2026-02-30','from=2026-11-13&to=2026-11-01','category=unknown','q='+encodeURIComponent('x'.repeat(201)),'q=%00','topic=agent','page=2','limit=25','extra=value']){
    assert.equal((await app.inject('/api/site/topics?'+query)).statusCode,400,query);
  }
});
