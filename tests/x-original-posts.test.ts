import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {tweetToCandidate} from "@agidawn/backend/sources/x";
import {buildApp} from "../apps/api/src/app.ts";
import {installModules} from "@agidawn/backend/modules";
import {stopBoss} from "@agidawn/backend/jobs/queue";
import reader from "../modules/reader/server.ts";
installModules([reader]);
const app=await buildApp();after(async()=>{await app.close();await stopBoss();await closeDb();});
test("empty, link-only and prose posts retain their original address, text and image without model copy",async()=>{
  const source=tag();await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'Original post','x_search',true)`;
  for(const text of ["","https://example.org/release","Original prose <script>unsafe()</script>"]){
    const tweet=String(BigInt(Date.now())*10000n+BigInt(Math.floor(Math.random()*10000)));
    const candidate=tweetToCandidate({id_str:tweet,tweet_created_at:new Date().toISOString(),full_text:text,lang:"en",user:{name:"Fixture",screen_name:"fixture"},extended_entities:{media:[{type:"photo",media_url_https:"https://example.org/image.png"}]}} as Parameters<typeof tweetToCandidate>[0]);
    const {articleId}=await upsertMaterial({...candidate,sourceId:source,via:"fetch"}),response=await app.inject("/api/site/items/"+articleId),item=response.json();
    assert.equal(response.statusCode,200);assert.equal(item.links.original,"https://x.com/fixture/status/"+tweet);
    assert.ok(item.bodyHtml,"confirmed original posts keep a readable representation");
    assert.doesNotMatch(item.bodyHtml,/<script>/);assert.match(item.bodyHtml,/图片正在保存/);
    assert.match((await sql`SELECT body_html FROM articles WHERE id=${articleId}`)[0]!.body_html,/<img/);
    if(text)assert.ok(item.bodyHtml.includes(text.startsWith("http")?"https://example.org/release":"Original prose"));
    assert.equal(item.summary,null);assert.equal("hasTranslation" in item,false);
  }
});
