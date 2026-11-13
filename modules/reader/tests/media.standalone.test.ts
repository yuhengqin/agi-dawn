import '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {config} from '@agidawn/backend/config';
import {mediaCandidates,rewriteMedia,fetchMedia,streamMedia} from '../archive/media.ts';

test('media addresses are bound to stored video candidates, including posters, and never arbitrary links',()=>{
  const body='<a href="https://example.org/arbitrary">link</a><video src="https://example.org/video.mp4" poster="https://example.org/cover.jpg"><source src="https://example.org/other.webm"></video>';
  const candidates=mediaCandidates(body);assert.equal(candidates.size,3);
  const rewritten=rewriteMedia(body,candidates,key=>'/bound/'+key);assert.equal((rewritten.match(/\/bound\//g)||[]).length,3);assert.match(rewritten,/href="https:\/\/example.org\/arbitrary"/);
  assert.doesNotMatch(rewriteMedia('<video src="https://attacker.org/new.mp4"></video>',candidates,key=>'/bound/'+key),/attacker/);
});
test('ordinary video GET streams one complete version even when the origin ignores Range',async()=>{
  const before=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;const bytes=Buffer.alloc(2*1024*1024+17,42),requests:Array<string|undefined>=[];
  const server=http.createServer((req,res)=>{assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);requests.push(req.headers.range);res.writeHead(200,{'content-type':'video/mp4','content-length':bytes.length,etag:'"version-'+requests.length+'"'});res.end(requests.length===1?bytes:Buffer.alloc(bytes.length,7));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+(server.address() as {port:number}).port+'/clip';
  try{const result=await streamMedia({kind:'video',url},async()=>true),chunks:Buffer[]=[];for await(const part of result.body)chunks.push(Buffer.from(part));assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(result.total,bytes.length);assert.deepEqual(requests,[undefined]);
    const revoked=await streamMedia({kind:'video',url},async()=>false);await assert.rejects(async()=>{for await(const part of revoked.body){void part;}},/permission/);
  }finally{config.allowPrivateNetworkFetch=before;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('video byte ranges are bounded, validated and retain seekable response semantics',async()=>{
  const before=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
  let requested='';const server=http.createServer((req,res)=>{requested=req.headers.range??'';if(req.url==='/wrong'){res.writeHead(200,{'content-type':'text/html'});res.end('bad');return;}if(req.url==='/bad-range'){res.writeHead(206,{'content-type':'video/mp4','content-range':'bytes 1-3/10'});res.end('abc');return;}res.writeHead(206,{'content-type':'video/mp4','content-range':'bytes 4-6/10'});res.end('abc');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  try{
    const result=await fetchMedia({kind:'video',url:origin+'/clip'},'bytes=4-6');assert.equal(requested,'bytes=4-6');assert.equal(result.status,206);assert.equal(result.contentRange,'bytes 4-6/10');assert.equal(result.body.toString(),'abc');
    await assert.rejects(()=>fetchMedia({kind:'video',url:origin+'/wrong'}),/media/);
    await assert.rejects(()=>fetchMedia({kind:'video',url:origin+'/bad-range'},'bytes=4-6'),/range/i);
    for(const range of ['bytes=0-1,4-5','bytes=-0','bytes=5-4','bytes=9007199254740992-'])await assert.rejects(()=>fetchMedia({kind:'video',url:origin+'/clip'},range),/range/i);
    config.allowPrivateNetworkFetch=false;await assert.rejects(()=>fetchMedia({kind:'video',url:origin+'/clip'}));
  }finally{config.allowPrivateNetworkFetch=before;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('closing the media response cancels a stalled origin without waiting for another chunk',async()=>{
  const before=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;let close!:()=>void;const closed=new Promise<void>(resolve=>{close=resolve;});
  const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'video/mp4'});res.flushHeaders();res.once('close',close);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const url='http://127.0.0.1:'+(server.address() as {port:number}).port+'/clip',media=await streamMedia({kind:'video',url},async()=>true);media.body.destroy();
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('media origin was not cancelled')),2000);closed.then(()=>{clearTimeout(timer);resolve();});});
  }finally{config.allowPrivateNetworkFetch=before;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
