import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await closeDb();});
test("missing publication time stays absent; discovery time remains separately labelled",async()=>{
  const source=tag(),discoveredAt=new Date("2026-10-26T04:00:00Z"),publishedAt=new Date("2026-09-01T02:00:00Z");
  await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Dates','rss')`;
  for(const at of [null,publishedAt]){
    const {articleId}=await upsertMaterial({sourceId:source,url:"https://example.org/"+tag(),title:"Date fixture",publishedAt:at,discoveredAt,via:"fetch"});
    const item=(await app.inject("/api/site/items/"+articleId)).json();
    assert.equal(item.publishedAt,at?.toISOString()??null);assert.equal(item.discoveredAt,discoveredAt.toISOString());assert.equal(item.timelineAt,(at??discoveredAt).toISOString());
  }
});
