import {gate,tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {loadReaderList} from "@agidawn/backend/publication/pool";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp(),source=tag(),q="shared"+tag();let id:string;
before(async()=>{await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Search source','rss')`;id=(await upsertMaterial({sourceId:source,url:"https://example.org/"+source,title:q,via:"fetch"})).articleId;});
after(async()=>{await app.close();await closeDb();});
async function blocked<T>(read:()=>Promise<T>){
  const ready=gate(),release=gate();const lock=sql.begin(async tx=>{await tx`LOCK TABLE pool_search IN ACCESS EXCLUSIVE MODE`;ready.open();await release.promise;});
  await ready.promise;const result=read();await new Promise(resolve=>setTimeout(resolve,100));release.open();await lock;return result;
}
test("a simultaneous burst of the same search shares only its unfinished read",async()=>{
  const responses=await blocked(()=>Promise.all(Array.from({length:20},()=>app.inject("/api/site/articles?q="+q))));
  assert.deepEqual(responses.map(r=>r.statusCode),Array(20).fill(200));
  for(const response of responses)assert.deepEqual(response.json().items.map((i:{id:string})=>i.id),[id]);
});
test("distinct searches stay bounded and overload responses advertise a retry",async()=>{
  const responses=await blocked(()=>Promise.all(Array.from({length:20},(_,i)=>app.inject("/api/site/articles?q=distinct"+i+q))));
  assert.ok(responses.some(r=>r.statusCode===503));assert.ok(responses.filter(r=>r.statusCode===503).every(r=>r.headers["retry-after"]==="5"));
});
test("completed or rejected reads cannot conceal withdrawals or prevent retry",async()=>{
  assert.deepEqual((await loadReaderList({q})).items.map(i=>i.id),[id]);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${id}`;assert.deepEqual((await loadReaderList({q})).items,[]);
  await sql`ALTER TABLE pool_search RENAME TO unavailable_pool_search`;
  try{await assert.rejects(loadReaderList({q}));}finally{await sql`ALTER TABLE unavailable_pool_search RENAME TO pool_search`;}
  await sql`UPDATE publications SET visibility='public' WHERE article_id=${id}`;assert.deepEqual((await loadReaderList({q})).items.map(i=>i.id),[id]);
});
