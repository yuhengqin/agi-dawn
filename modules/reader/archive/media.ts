import * as cheerio from 'cheerio';
import sharp from 'sharp';
import {Readable} from 'node:stream';
import {sha256} from '@agidawn/backend/lib/ids';
import {guardedFetch,guardedStreamFetch} from '@agidawn/backend/lib/http-fetch';
import {isPlaceholderPoster} from '@agidawn/backend/content/video';

export interface MediaCandidate {kind:'video'|'poster';url:string}
const chunkBytes=1024*1024;
const keyOf=(item:MediaCandidate)=>sha256(item.kind+'\n'+item.url).slice(0,32);
/** Only media already present in the stored snapshot can acquire a public address. */
export function mediaCandidates(html:string){
  const $=cheerio.load(html,null,false),items=new Map<string,MediaCandidate>();
  $('video[src],video > source[src],video[poster]').each((_,node)=>{
    const el=$(node);
    for(const [attr,kind] of [['src','video'],['poster','poster']] as const){
      const url=el.attr(attr);if(!url||attr==='poster'&&(node.tagName!=='video'||isPlaceholderPoster(url)))continue;
      try{const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password)continue;}catch{continue;}
      const item={kind,url};items.set(keyOf(item),item);
    }
  });return items;
}
export function rewriteMedia(html:string,candidates:Map<string,MediaCandidate>,address:(key:string)=>string){
  const $=cheerio.load(html,null,false);
  $('video,video > source').each((_,node)=>{
    const el=$(node);
    for(const [attr,kind] of [['src','video'],['poster','poster']] as const){
      const url=el.attr(attr);if(!url)continue;
      const key=keyOf({kind,url});if(candidates.has(key))el.attr(attr,address(key));else el.removeAttr(attr);
    }
  });return $.html();
}
export class MediaRangeError extends Error {}
export class MediaStreamRequired extends Error {}
function requestedRange(value:string|undefined){
  if(value===undefined)return {header:`bytes=0-${chunkBytes-1}`,start:0,end:chunkBytes-1,suffix:null};
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||!match[1]&&!match[2])throw new MediaRangeError('invalid media range');
  const number=(v:string)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw new MediaRangeError('invalid media range');return n;};
  if(!match[1]){const suffix=Math.min(number(match[2]!),chunkBytes);if(!suffix)throw new MediaRangeError('invalid media range');return {header:`bytes=-${suffix}`,start:null,end:null,suffix};}
  const start=number(match[1]),last=match[2]?number(match[2]):null;
  if(last!==null&&last<start)throw new MediaRangeError('invalid media range');
  const end=Math.min(last??Number.MAX_SAFE_INTEGER,start+chunkBytes-1,Number.MAX_SAFE_INTEGER);
  return {header:`bytes=${start}-${end}`,start,end,suffix:null};
}
/** Bounded reads avoid buffering whole videos; no client cookies or conditional headers are forwarded. */
export async function fetchMedia(item:MediaCandidate,range?:string){
  const requested=item.kind==='video'?requestedRange(range):null;
  const result=await guardedFetch(item.url,{headers:requested?{range:requested.header,'accept-encoding':'identity'}:{},timeoutMs:20_000,maxBytes:requested?chunkBytes:8*1024*1024,truncate:!!requested});
  if(result.status===416)throw new MediaRangeError('unsatisfied media range');
  if(result.status!==200&&result.status!==206)throw new Error('media unavailable');
  const mime=(result.headers.get('content-type')??'').split(';')[0]!.trim().toLowerCase();
  if(item.kind==='video'?!['video/mp4','video/webm','video/ogg'].includes(mime):!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(mime))throw new Error('unsupported media type');
  if(!result.body.length)throw new Error('empty media');
  if(result.truncated){if(result.status===200&&requested)throw new MediaStreamRequired('origin returned a complete media response');throw new Error('oversized media range response');}
  let contentRange:string|undefined;
  if(result.status===206){
    const found=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(result.headers.get('content-range')??'');
    if(!requested||!found)throw new Error('invalid media range response');
    const [start,end,total]=found.slice(1).map(Number);
    if(![start,end,total].every(Number.isSafeInteger)||start!>end!||end!>=total!||end!-start!+1!==result.body.length
      ||requested.start!==null&&(start!==requested.start||end!>requested.end!)
      ||requested.suffix!==null&&(end!==total!-1||start!==Math.max(0,total!-requested.suffix)))throw new Error('invalid media range response');
    contentRange=`bytes ${start}-${end}/${total}`;
  }
  if(item.kind==='poster'){
    const meta=await sharp(result.body,{limitInputPixels:16_000_000}).metadata();
    if(!meta.width||!meta.height||!['jpeg','png','webp','avif','heif','gif'].includes(meta.format??''))throw new Error('invalid media image');
  }
  return {status:result.status,body:result.body,mime,contentRange};
}

/** A normal GET uses one response, including servers that do not implement Range. */
export async function streamMedia(item:MediaCandidate,allowed:()=>Promise<boolean>){
  const limit=512*1024*1024,upstream=await guardedStreamFetch(item.url,{headers:{'accept-encoding':'identity'},timeoutMs:60_000,maxBytes:limit});
  const mime=(upstream.headers.get('content-type')??'').split(';')[0]!.trim().toLowerCase(),length=upstream.headers.get('content-length'),total=length&&/^\d+$/.test(length)?Number(length):null;
  if(upstream.status!==200||!['video/mp4','video/webm','video/ogg'].includes(mime)||total!==null&&(!Number.isSafeInteger(total)||total<=0||total>limit)){
    upstream.body.destroy();throw new Error('invalid media stream');
  }
  async function* chunks(){
    let bytes=0,checked=-chunkBytes;
    try{for await(const part of upstream.body){if(bytes-checked>=chunkBytes){if(!await allowed())throw new Error('media permission changed');checked=bytes;}bytes+=part.length;yield part;}
      if(!bytes||total!==null&&bytes!==total)throw new Error('incomplete media stream');
    }finally{upstream.body.destroy();}
  }
  const body=Readable.from(chunks());body.once('close',()=>upstream.body.destroy());
  return {body,mime,total,ranges:upstream.headers.get('accept-ranges')==='bytes'};
}
