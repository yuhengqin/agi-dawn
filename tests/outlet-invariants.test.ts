import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {setSeoIndexed} from "@agidawn/backend/admin/content";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await closeDb();});
async function fixture(name:string,mode="editorial"){
  const source=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES(${source},${name},'rss',${mode})`;
  return (await upsertMaterial({sourceId:source,url:"https://example.org/"+source,title:"Source article",via:"fetch"})).articleId;
}
test("a stale indexability bit cannot expose a currently unreadable source",async()=>{
  const visible=await fixture("Visible"),signal=await fixture("Signal","hot_signal");
  for(const id of [visible,signal])await setSeoIndexed(id,{indexed:true,reason:"scope check"},"test");
  await sql`UPDATE publications SET indexable=true WHERE article_id=${signal}`;
  assert.equal((await app.inject("/api/site/items/"+signal)).statusCode,404);
  const sitemap=await app.inject("/sitemap.xml");assert.equal(sitemap.statusCode,200);assert.ok(sitemap.body.includes("/items/"+visible));assert.ok(!sitemap.body.includes("/items/"+signal));
});
test("public search matches the visible source name and excludes internal source notes",async()=>{
  const visible="Visible"+tag(),internal="Internal"+tag(),id=await fixture(visible+"（"+internal+"）");
  for(const [q,expected] of [[visible,true],[internal,false]] as const){
    const response=await app.inject("/api/site/articles?q="+encodeURIComponent(q));assert.equal(response.statusCode,200,response.body);assert.equal(response.body.includes(id),expected);
  }
});
