import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import * as cheerio from "cheerio";
import {SITE} from "@agidawn/site";
import {fakeApi,itemDetail,startWebServer,type WebServer} from "../apps/web/tests/web-server.ts";
const item=itemDetail({id:"metadata-fixture",title:"Original metadata title",publishedAt:null,author:null});
let web:WebServer;
before(async()=>{web=await startWebServer(fakeApi(url=>{
  if(url.pathname==="/api/site/articles")return {items:[item],total:1,page:1,limit:25,pageCount:1};
  if(url.pathname==="/api/site/sources")return {items:[]};
  if(url.pathname==="/api/site/topics")return {groups:[],topics:[]};
  if(url.pathname==="/api/site/categories")return {items:[{id:"uncategorized",name:"待分类"}]};
  if(url.pathname==="/api/site/items/metadata-fixture")return item;
}));});
after(async()=>{await web?.stop();});
async function page(path:string){const response=await fetch(web.origin+path);assert.equal(response.status,200,web.logs());return cheerio.load(await response.text());}
test("reading pages carry the confirmed brand and canonical filter address",async()=>{
  const $=await page("/all?q=Agent&category=uncategorized");
  assert.equal($("title").text(),"文章 · "+SITE.name);
  assert.equal($("link[rel=canonical]").attr("href"),web.origin+"/?q=Agent&category=uncategorized");
  assert.equal($("meta[name=robots]").attr("content"),"noindex, follow");assert.ok($("main").text().includes(item.title));
});
test("exploration views have stable canonical addresses and old article links preserve filters",async()=>{
  for(const path of ["/explore","/explore?view=sources"]){
    const $=await page(path);
    assert.equal($("title").text(),"探索 · "+SITE.name);
    assert.equal($("link[rel=canonical]").attr("href"),web.origin+path);
    assert.equal($("meta[property='og:image']").attr("content"),web.origin+"/og/pages/explore.png");
  }
  for(const path of ["/all","/all/"]){
    const response=await fetch(web.origin+path+"?topic=mcp&sourceId=fixture&page=3&limit=50",{redirect:"manual"});
    assert.equal(response.status,301);assert.equal(response.headers.get("location"),"/?topic=mcp&sourceId=fixture&page=3&limit=50");
  }
  const $=await page("/?topic=mcp&sourceId=fixture");
  assert.equal($("link[rel=canonical]").attr("href"),web.origin+"/?topic=mcp&sourceId=fixture");
});
test("article metadata names the original without inventing an author or publication/update time",async()=>{
  const $=await page("/items/"+item.id);assert.equal($("title").text(),item.title+" · "+SITE.name);
  const article=$("script[type='application/ld+json']").toArray().map(node=>JSON.parse($(node).text())).find(value=>value["@type"]==="Article");
  assert.ok(article);assert.equal(article.headline,item.title);assert.equal(article.isBasedOn,item.links.original);
  for(const field of ["author","datePublished","dateModified"])assert.equal(field in article,false,field);
});
