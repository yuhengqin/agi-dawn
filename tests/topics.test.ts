import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {overrideFields} from "@agidawn/backend/admin/content";
import {listTopicSummaries} from "@agidawn/backend/publication/topics";
import {loadReaderList} from "@agidawn/backend/publication/pool";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await closeDb();});
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
