import {createReadStream} from "node:fs";
import {readFile,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {Readable} from "node:stream";
import {Zip,ZipPassThrough} from "fflate";
import * as cheerio from "cheerio";
import {sql} from "@agidawn/backend/db";
import {sha256} from "@agidawn/backend/lib/ids";
import {bodyToMarkdown} from "@agidawn/backend/content/markdown";
import {assetFile} from "./assets.ts";
import {readSnapshot} from "./snapshots.ts";
import {missing} from "../state.ts";
import {ARCHIVE_LIMITS} from "../config.ts";
import type {ArchiveManifest} from "../contracts.ts";
import {markdownText} from "../markdown.ts";

interface BundleFile {path:string;mime:string;bytes:number;sha256:string;body?:Buffer;file?:string}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
async function verifiedFile(file:string,bytes:number,hash:string) {
  const info=await stat(file);
  if(info.size!==bytes||bytes>ARCHIVE_LIMITS.maxAssetBytes)throw new Error("image size does not match archive");
  if(sha256(await readFile(file))!==hash)throw new Error("image checksum does not match archive");
}

/** Prepare one fixed mapping before streaming. Pending assets are never substituted mid-export. */
export async function exportSnapshot(id:string) {
  const snapshot=await readSnapshot(id);if(!snapshot)throw missing();
  if(Buffer.byteLength(snapshot.bodyHtml)>16*1024*1024)throw new Error("article exceeds export body limit");
  const rows=await sql`SELECT sa.*,a.path,a.mime,a.bytes FROM reader_snapshot_assets sa LEFT JOIN reader_assets a ON a.hash=sa.asset_hash WHERE sa.snapshot_id=${id} ORDER BY sa.asset_key`;
  const files:BundleFile[]=[],links=new Map<string,string>(),missingResources:ArchiveManifest["missingResources"]=[];
  let total=0;
  for(const row of rows) {
    try {
      if(row.status!=="ready"||!row.path)throw new Error(row.error??"图片尚未保存");
      const file=assetFile(row.path);await verifiedFile(file,Number(row.bytes),row.asset_hash);
      total+=Number(row.bytes);if(total>ARCHIVE_LIMITS.maxSnapshotBytes)throw new Error("article exceeds total image size limit");
      const name="assets/"+row.path;
      links.set(row.original_url,name);
      if(!files.some(f=>f.path===name))files.push({path:name,mime:row.mime,bytes:Number(row.bytes),sha256:row.asset_hash,file});
    } catch {
      missingResources.push({url:row.original_url.startsWith("data:")?"embedded:"+row.asset_key:row.original_url,reason:row.status==="pending"?"图片尚未保存":row.status==="failed"?"图片未能保存，请对照原文":"图片文件缺失或校验失败"});
    }
  }
  const $=cheerio.load(snapshot.bodyHtml,null,false);
  $("script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select").remove();
  $("video,audio").replaceWith("<p>音视频请访问原文查看。</p>");
  $("source").remove();
  $("*").each((_,node)=>{
    if(!("attribs" in node))return;
    const element=$(node);
    for(const attribute of Object.keys(node.attribs)) {
      if(/^on/i.test(attribute)||["style","srcset","poster","background","action","formaction","xlink:href"].includes(attribute)
        ||attribute==="src"&&node.name!=="img"||attribute==="href"&&node.name!=="a") element.removeAttr(attribute);
    }
    if(node.name==="a") {
      const href=element.attr("href")??"";
      if(!/^(https?:|mailto:|#)/i.test(href))element.removeAttr("href");
      element.attr("rel","noreferrer");
    }
  });
  $("img").each((_,node)=>{
    const image=$(node),target=links.get(image.attr("src")??"");
    if(target)image.attr("src",target);else image.replaceWith($("<p>").text("图片未保存："+(image.attr("alt")??"原文图片")));
  });
  const complete=snapshot.status==="complete"&&snapshot.quality==="ready"&&!missingResources.length;
  const marker=complete?"":"（不完整）";
  const body=$.html();
  const html=Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.title+marker)}</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;font:18px/1.8 system-ui,sans-serif;color:#202522}img{max-width:100%;height:auto}pre{overflow:auto;background:#f0f2f1;padding:20px;font-size:14px;line-height:1.6}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid #bbc4be;padding:8px 14px}h1,h2,h3{line-height:1.4}a{color:#145b54}.metadata{font-size:14px;color:#56635a}</style></head><body><header><h1>${escape(snapshot.title+marker)}</h1><p class="metadata">${escape(snapshot.sourceName)} · ${escape(snapshot.author??"")} · ${escape((snapshot.publishedAt?"发布于 ":"收录于 ")+(snapshot.publishedAt??snapshot.discoveredAt))}</p><p><a href="${escape(snapshot.originalUrl)}">阅读原文</a></p>${complete?"":"<p>此归档不完整，请对照原文。缺失资源见 metadata.json。</p>"}</header><main>${body}</main></body></html>`);
  const markdown=Buffer.from(`# ${markdownText(snapshot.title+marker)}\n\n来源：${markdownText(snapshot.sourceName)}\n\n原文：${markdownText(snapshot.originalUrl)}\n\n${bodyToMarkdown(body)}\n`);
  files.unshift(...[{path:"article.html",mime:"text/html",body:html},{path:"article.md",mime:"text/markdown",body:markdown}].map(f=>({...f,bytes:f.body.length,sha256:sha256(f.body)})));
  const manifest:ArchiveManifest={formatVersion:1,snapshotId:id,articleId:snapshot.articleId,bodyRevision:snapshot.bodyRevision,representationHash:snapshot.representationHash,savedAt:snapshot.createdAt,
    source:{id:snapshot.sourceId,name:snapshot.sourceName},originalUrl:snapshot.originalUrl,quality:snapshot.quality,completeness:complete?"complete":"partial",
    files:files.map(({path,mime,bytes,sha256})=>({path,mime,bytes,sha256})),missingResources};
  const metadata=Buffer.from(JSON.stringify(manifest,null,2));
  files.push({path:"metadata.json",mime:"application/json",bytes:metadata.length,sha256:sha256(metadata),body:metadata});
  async function* chunks() {
    let output:Uint8Array[]=[];let failure:Error|null=null;
    const zip=new Zip((error,data)=>{if(error)failure=error;else output.push(data);});
    const drain=function*(){if(failure)throw failure;yield* output;output=[];};
    try {
      for(const file of files) {
        const entry=new ZipPassThrough(file.path);zip.add(entry);yield* drain();
        const hash=createHash("sha256");
        const source=file.body?[file.body]:createReadStream(file.file!,{highWaterMark:64*1024});
        for await(const data of source) {hash.update(data);entry.push(data,false);yield* drain();}
        if(hash.digest("hex")!==file.sha256)throw new Error("archive changed during export");
        entry.push(new Uint8Array(),true);yield* drain();
      }
      zip.end();yield* drain();
    } finally {zip.terminate();}
  }
  return {filename:`article-${id}${complete?"":"-incomplete"}.zip`,stream:Readable.from(chunks()),manifest};
}
