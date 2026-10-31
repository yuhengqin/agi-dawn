import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {stopBoss} from "@agidawn/backend/jobs/queue";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {setVisibility} from "@agidawn/backend/admin/content";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await stopBoss();await closeDb();});
test("mutable public reads and conditional requests cannot extend the withdrawal window",async()=>{
  const source=tag();await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'Cache source','rss',true)`;
  const {articleId:id}=await upsertMaterial({sourceId:source,url:"https://example.org/"+tag(),title:"Cache article",bodyHtml:"<p>Permitted body</p>",bodyText:"Permitted body",bodyStatus:"ok",via:"fetch"});
  const paths=["/api/site/articles","/api/site/items/"+id,"/sitemap.xml","/og/items/"+id+".png"];
  for(const url of paths){
    const first=await app.inject(url);assert.equal(first.statusCode,200,url);assert.equal(first.headers["cache-control"],"no-store",url);
    if(first.headers.etag){const next=await app.inject({url,headers:{"if-none-match":String(first.headers.etag)}});assert.ok([200,304].includes(next.statusCode));assert.equal(next.headers["cache-control"],"no-store");}
  }
  const image=await app.inject("/og/items/"+id+".png");
  await setVisibility(id,{visibility:"withdrawn",version:0,reason:"cache check"},"test");
  assert.equal((await app.inject("/api/site/items/"+id)).statusCode,404);
  assert.equal((await app.inject({url:"/og/items/"+id+".png",headers:{"if-none-match":String(image.headers.etag)}})).statusCode,404);
  assert.ok(!(await app.inject("/api/site/articles")).body.includes(id));assert.ok(!(await app.inject("/sitemap.xml")).body.includes(id));
});
