import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {setVisibility} from "@agidawn/backend/admin/content";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await closeDb();});
test("original X text follows current full-text permission and persistent manual visibility",async()=>{
  const source=tag();await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'X licence','x_search',true)`;
  const {articleId}=await upsertMaterial({sourceId:source,url:"https://x.com/fixture/status/"+Date.now(),title:"Original post",bodyText:"Sensitive original post body",bodyStatus:"ok",via:"fetch"});
  const read=()=>app.inject("/api/site/items/"+articleId);
  assert.match((await read()).json().bodyHtml,/Sensitive original post body/);
  await sql`UPDATE sources SET site_fulltext=false WHERE id=${source}`;
  assert.equal((await read()).json().bodyHtml,null);assert.equal((await read()).json().bodyState.status,"not-permitted");
  await sql`UPDATE sources SET site_fulltext=true WHERE id=${source}`;
  await setVisibility(articleId,{visibility:"summary-only",version:0,reason:"limit display"},"test");assert.equal((await read()).json().bodyHtml,null);
  await setVisibility(articleId,{visibility:"withdrawn",version:1,reason:"remove"},"test");assert.equal((await read()).statusCode,404);
});
