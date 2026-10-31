import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {setVisibility} from "@agidawn/backend/admin/content";
import {listTopicSummaries} from "@agidawn/backend/publication/topics";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await closeDb();});
test("topic counts and discovery immediately lose their last withdrawn article",async()=>{
  const source=tag(),slug="fixture-"+source;await sql`INSERT INTO article_topics(slug,name,group_key,definition,tags) VALUES(${slug},'Fixture topic','field','Fixture',ARRAY['fixture'])`;
  try{
    await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Topic source','rss',ARRAY['fixture'])`;
    const {articleId}=await upsertMaterial({sourceId:source,url:"https://example.org/"+source,title:"Topic material",via:"fetch"});
    await sql`UPDATE publications SET indexable=true WHERE article_id=${articleId}`;
    assert.equal((await listTopicSummaries()).topics.find(t=>t.slug===slug)!.total,1);
    const before=(await app.inject("/sitemap.xml")).body;
    assert.ok(before.includes("/explore</loc>"));
    assert.ok(before.includes("/items/"+articleId));
    assert.ok(!before.includes("/topics/")&&!before.includes("/sources/")&&!before.includes("/?"));
    await setVisibility(articleId,{visibility:"withdrawn",version:0,reason:"topic scope"},"test");
    assert.equal((await listTopicSummaries()).topics.find(t=>t.slug===slug)!.total,0);
    assert.ok(!(await app.inject("/sitemap.xml")).body.includes("/items/"+articleId));
  }finally{await sql`DELETE FROM article_topics WHERE slug=${slug}`;}
});
