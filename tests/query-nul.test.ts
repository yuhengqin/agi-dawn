import "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {closeDb} from "@agidawn/backend/db";
import {buildApp} from "../apps/api/src/app.ts";
const app=await buildApp();after(async()=>{await app.close();await closeDb();});
for(const key of ["q","sourceId","category","topic","page","limit","from","to"])test("decoded NUL in "+key+" is rejected before SQL",async()=>{
  const response=await app.inject("/api/site/articles?"+key+"=AI%00");
  assert.equal(response.statusCode,400,response.body);assert.equal(response.json().code,"invalid_request");assert.equal(response.headers["cache-control"],"no-store");
});
test("Unicode and literal escape text remain searchable",async()=>{
  for(const q of ["AI模型","AI\\u0000","AI%00"]){const response=await app.inject("/api/site/articles?q="+encodeURIComponent(q));assert.equal(response.statusCode,200,response.body);}
});
