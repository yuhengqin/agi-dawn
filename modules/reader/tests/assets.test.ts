import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {createServer} from "node:http";
import {once} from "node:events";
import sharp from "sharp";
import {mkdtemp,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {sha256} from '@agidawn/backend/lib/ids';
import {sql,closeDb} from "@agidawn/backend/db";
import {config} from "@agidawn/backend/config";
import {installModules} from "@agidawn/backend/modules";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {stopBoss} from "@agidawn/backend/jobs/queue";
import {setVisibility} from "@agidawn/backend/admin/content";
import {passwordLogin,SESSION_COOKIE} from "@agidawn/backend/admin/auth";
import {buildApp} from "../../../apps/api/src/app.ts";
import reader from "../server.ts";
import {archiveSnapshot} from "../archive/assets.ts";
import {assetFile} from '../archive/assets.ts';

installModules([reader]);
const app=await buildApp();
after(async()=>{await app.close();await stopBoss();await closeDb();});

test("archived images freeze a version and every public read checks current permission",async()=>{
  config.allowPrivateNetworkFetch=true;
  let pixels=await sharp({create:{width:40,height:30,channels:3,background:"#145b54"}}).png().toBuffer();
  let hits=0;
  const server=createServer((req,res)=>{hits++;res.setHeader("Content-Type","image/png");res.end(req.url==="/bad"?"not an image":pixels);});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  try {
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,site_fulltext) VALUES ('asset-reader','Assets','rss','T1','editorial',true)`;
    const material={sourceId:"asset-reader",url:"https://example.com/asset-reader",title:"Archived images",bodyText:"Body with image",bodyHtml:`<p>Body with image</p><img src="${origin}/image" alt="Diagram">`,bodyStatus:"ok" as const,via:"fetch" as const};
    const {articleId}=await upsertMaterial(material);
    const [snapshot]=await sql`SELECT * FROM reader_snapshots WHERE article_id=${articleId}`;
    await archiveSnapshot(snapshot!.id);
    assert.equal((await sql`SELECT status FROM reader_snapshots WHERE id=${snapshot!.id}`)[0]!.status,"complete");
    const [asset]=await sql`SELECT * FROM reader_snapshot_assets WHERE snapshot_id=${snapshot!.id}`;
    assert.equal(asset!.status,"ready");
    const route=`/api/reader/articles/${articleId}/assets/${snapshot!.id}/${asset!.asset_key}`;
    const detail=(await app.inject(`/api/site/items/${articleId}`)).json();
    assert.ok(detail.bodyHtml.includes(route),"published HTML points at its exact archived representation");
    const first=await app.inject(route);
    assert.equal(first.statusCode,200);
    assert.equal(first.headers["cache-control"],"no-store");
    assert.deepEqual(first.rawPayload,pixels);
    pixels=await sharp({create:{width:40,height:30,channels:3,background:"#d0e3e0"}}).png().toBuffer();
    await archiveSnapshot(snapshot!.id);
    assert.equal(hits,1,"a complete snapshot never fetches a changed image URL again");
    await sql`UPDATE sources SET site_fulltext=false WHERE id='asset-reader'`;
    assert.equal((await app.inject({url:route,headers:{"if-none-match":String(first.headers.etag)}})).statusCode,404);
    await sql`UPDATE sources SET site_fulltext=true WHERE id='asset-reader'`;
    await setVisibility(articleId,{visibility:"withdrawn",version:0,reason:"image visibility"},"test");
    assert.equal((await app.inject(route)).statusCode,404);
    const legacy="/api/img-proxy/retired-signature/full/image";
    assert.equal((await app.inject(legacy)).statusCode,404,"legacy arbitrary image addresses are retired");
    config.devAdmin=null;config.adminPassword="asset-reader-test-password";
    const {token}=await passwordLogin(config.adminPassword,"/admin/reader","test");
    const adminRoute=`/api/admin/reader/snapshots/${snapshot!.id}/assets/${asset!.asset_key}`;
    assert.equal((await app.inject(adminRoute)).statusCode,401);
    assert.equal((await app.inject({url:adminRoute,headers:{cookie:`${SESSION_COOKIE}=${token}`}})).statusCode,200);
    const bad=await upsertMaterial({...material,url:"https://example.com/bad-image",bodyHtml:`<p>Missing image</p><img src="${origin}/bad">`,bodyText:"Missing image"});
    const [badSnapshot]=await sql`SELECT id FROM reader_snapshots WHERE article_id=${bad.articleId}`;
    await archiveSnapshot(badSnapshot!.id);
    assert.equal((await sql`SELECT status FROM reader_snapshots WHERE id=${badSnapshot!.id}`)[0]!.status,"partial");
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('image count, response bytes and the article budget produce honest partial archives',async()=>{
  const originalDir=config.dataDir;config.dataDir=await mkdtemp(path.join(tmpdir(),'reader-limits-'));
  config.allowPrivateNetworkFetch=true;
  const small=await sharp({create:{width:5,height:5,channels:3,background:'#275c40'}}).png().toBuffer();
  const raw=randomBytes(1700*1500*3);let bigHits=0,countHits=0,lastBigHash='';
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','image/png');
    if(req.url!.startsWith('/oversized'))return res.end(Buffer.alloc(8*1024*1024+1));
    if(req.url!.startsWith('/big')){raw[0]=++bigHits;const bytes=await sharp(raw,{raw:{width:1700,height:1500,channels:3}}).png().toBuffer();lastBigHash=sha256(bytes);return res.end(bytes);}
    countHits++;res.end(small);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    await sql`INSERT INTO sources(id,name,kind) VALUES ('archive-limits','Limits','rss')`;
    const capture=async(suffix:string,images:string[])=>{const {articleId}=await upsertMaterial({sourceId:'archive-limits',url:'https://example.com/limits/'+suffix,title:suffix,bodyHtml:'<p>Limit fixture</p>'+images.map(src=>`<img src="${src}">`).join(''),bodyText:'Limit fixture '+suffix,bodyStatus:'ok',via:'fetch'});const [snapshot]=await sql`SELECT id FROM reader_snapshots WHERE article_id=${articleId}`;await archiveSnapshot(snapshot!.id);return snapshot!.id;};
    const count=await capture('count',Array.from({length:129},(_,n)=>origin+'/small?n='+n));
    assert.equal(countHits,128);assert.equal((await sql`SELECT status FROM reader_snapshots WHERE id=${count}`)[0]!.status,'partial');
    assert.equal((await sql`SELECT count(*)::int AS n FROM reader_snapshot_assets WHERE snapshot_id=${count} AND status='failed'`)[0]!.n,1);
    const oversized=await capture('oversized',[origin+'/oversized']);
    assert.equal((await sql`SELECT status FROM reader_snapshots WHERE id=${oversized}`)[0]!.status,'partial');
    const budget=await capture('budget',Array.from({length:9},(_,n)=>origin+'/big?n='+n));
    const [state]=await sql`SELECT s.status,count(a.asset_key) FILTER(WHERE a.status='ready')::int AS ready FROM reader_snapshots s JOIN reader_snapshot_assets a ON a.snapshot_id=s.id WHERE s.id=${budget} GROUP BY s.id`;
    assert.equal(state!.status,'partial');assert.equal(state!.ready,8);assert.equal(bigHits,9);
    await assert.rejects(stat(assetFile(lastBigHash+'.png')),/ENOENT/,'an image rejected by the total budget is never installed');
    assert.equal((await readdir(path.join(config.dataDir,'reader-archives/assets'))).filter(name=>name.startsWith('.tmp-')).length,0);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(config.dataDir,{recursive:true,force:true});config.dataDir=originalDir;}
});
