import {mkdir,readFile,writeFile,rename,rm,stat} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import * as cheerio from "cheerio";
import {sql} from "@agidawn/backend/db";
import {config} from "@agidawn/backend/config";
import {guardedFetch,requireOk} from "@agidawn/backend/lib/http-fetch";
import {sha256} from "@agidawn/backend/lib/ids";
import {normalizeTechnicalMarkup} from "@agidawn/backend/content/technical-markup";
import {storedMaterial} from "@agidawn/backend/content/materials";
import {materialRepresentationHash,type PublishedBodyInput} from "@agidawn/backend/modules";
import {ARCHIVE_LIMITS as limits} from "../config.ts";
import {readSnapshot} from "./snapshots.ts";
import type {ArchiveSnapshot} from "../contracts.ts";

export const assetRoot=()=>path.join(config.dataDir,"reader-archives/assets");
export function assetFile(relative:string,dataDir=config.dataDir) {
  if(!/^[a-f0-9]{64}\.(png|jpg|webp|gif|avif)$/.test(relative)) throw new Error("invalid archive asset path");
  return path.join(dataDir,"reader-archives/assets",relative);
}
const types:Record<string,{ext:string;mime:string}>={png:{ext:"png",mime:"image/png"},jpeg:{ext:"jpg",mime:"image/jpeg"},webp:{ext:"webp",mime:"image/webp"},gif:{ext:"gif",mime:"image/gif"},avif:{ext:"avif",mime:"image/avif"},heif:{ext:"avif",mime:"image/avif"}};

async function download(url:string) {
  let bytes:Buffer;
  if(url.startsWith("data:")) {
    const found=/^data:image\/(png|jpeg|webp|gif|avif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
    if(!found||found[2]!.length>Math.ceil(limits.maxAssetBytes*4/3)+100) throw new Error("invalid or oversized embedded image");
    bytes=Buffer.from(found[2]!,"base64");
  } else {
    const response=requireOk(await guardedFetch(url,{timeoutMs:limits.timeoutMs,maxBytes:limits.maxAssetBytes}));
    if(!/^image\/(?:png|jpe?g|webp|gif|avif|svg\+xml)(?:;|$)/i.test(response.headers.get("content-type")??"")) throw new Error("resource is not a supported image");
    bytes=response.body;
  }
  if(!bytes.length||bytes.length>limits.maxAssetBytes) throw new Error("image exceeds archive size limit");
  let meta=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();
  if(meta.format==="svg") {
    const normalized=normalizeTechnicalMarkup(bytes.toString("utf8"),url);
    if(normalized.issues.length) throw new Error("SVG requires unsupported content or styles");
    const src=cheerio.load(normalized.html)("img").first().attr("src");
    if(!src?.startsWith("data:image/svg+xml;base64,")) throw new Error("SVG cannot be saved safely");
    bytes=await sharp(Buffer.from(src.split(",")[1]!,"base64"),{limitInputPixels:16_000_000}).png().toBuffer();
    meta=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();
  }
  const type=meta.format?types[meta.format]:undefined;
  if(!type||!meta.width||!meta.height||meta.width*meta.height>16_000_000||bytes.length>limits.maxAssetBytes) throw new Error("image format or dimensions exceed archive limits");
  return {bytes,...type};
}

async function storeBytes(bytes:Buffer,ext:string) {
  const hash=sha256(bytes),relative=`${hash}.${ext}`,file=assetFile(relative);
  await mkdir(assetRoot(),{recursive:true});
  const temp=path.join(assetRoot(),`.tmp-${randomUUID()}`);
  try {
    const exists=await stat(file).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return null;throw e;});
    if(exists) {if(sha256(await readFile(file))!==hash) throw new Error("existing archive image is corrupt");}
    else {await writeFile(temp,bytes,{flag:"wx"});if(sha256(await readFile(temp))!==hash)throw new Error("image write checksum mismatch");await rename(temp,file);}
    return {hash,path:relative};
  } finally {await rm(temp,{force:true});}
}

export async function archiveSnapshot(snapshotId:string):Promise<void> {
  const snapshot=await readSnapshot(snapshotId);
  if(!snapshot||snapshot.status==="complete")return;
  const [attempt]=await sql`UPDATE reader_snapshots SET attempts=attempts+1 WHERE id=${snapshotId} AND attempts<3 RETURNING attempts`;
  if(!attempt) {
    await sql`UPDATE reader_snapshot_assets SET status='failed',error='资源处理已中断多次，请手动重试' WHERE snapshot_id=${snapshotId} AND status='pending'`;
    await sql`UPDATE reader_snapshots SET status='partial' WHERE id=${snapshotId} AND status<>'complete'`;return;
  }
  const rows=await sql`SELECT * FROM reader_snapshot_assets WHERE snapshot_id=${snapshotId} ORDER BY asset_key`;
  for(const [index,row] of rows.entries()) {
    if(row.status==="ready")continue;
    try {
      if(index>=limits.maxAssetsPerSnapshot) throw new Error("article exceeds image count limit");
      const image=await download(row.original_url);
      await sql.begin(async tx=>{
        await tx`SELECT 1 FROM reader_snapshots WHERE id=${snapshotId} FOR UPDATE`;
        const [current]=await tx`SELECT status FROM reader_snapshot_assets WHERE snapshot_id=${snapshotId} AND asset_key=${row.asset_key}`;
        if(current?.status==="ready")return;
        const [total]=await tx`SELECT coalesce(sum(a.bytes),0)::bigint AS bytes FROM reader_snapshot_assets sa JOIN reader_assets a ON a.hash=sa.asset_hash WHERE sa.snapshot_id=${snapshotId} AND sa.status='ready'`;
        if(Number(total!.bytes)+image.bytes.length>limits.maxSnapshotBytes) throw new Error("article exceeds total image size limit");
        const file=await storeBytes(image.bytes,image.ext);
        await tx`INSERT INTO reader_assets (hash,mime,bytes,path) VALUES (${file.hash},${image.mime},${image.bytes.length},${file.path}) ON CONFLICT DO NOTHING`;
        await tx`UPDATE reader_snapshot_assets SET status='ready',asset_hash=${file.hash},error=NULL WHERE snapshot_id=${snapshotId} AND asset_key=${row.asset_key} AND status<>'ready'`;
      });
    } catch(error) {
      await sql`UPDATE reader_snapshot_assets SET status='failed',error=${String(error instanceof Error?error.message:error).slice(0,300)}
        WHERE snapshot_id=${snapshotId} AND asset_key=${row.asset_key} AND status<>'ready'`;
    }
  }
  const [unready]=await sql`SELECT 1 FROM reader_snapshot_assets WHERE snapshot_id=${snapshotId} AND status<>'ready' LIMIT 1`;
  const complete=!unready&&snapshot.quality==="ready";
  await sql`UPDATE reader_snapshots SET status=${complete?"complete":"partial"},completed_at=${complete?new Date():null} WHERE id=${snapshotId} AND status<>'complete'`;
}

export async function currentSnapshotMatches(articleId:string,snapshot:ArchiveSnapshot) {
  if(snapshot.articleId!==articleId)return false;
  const capture=await storedMaterial(sql,articleId);
  return !!capture&&capture.bodyRevision===snapshot.bodyRevision&&materialRepresentationHash(capture)===snapshot.representationHash;
}
export async function snapshotBody(snapshot:ArchiveSnapshot,privateRead=false):Promise<string> {
  const rows=await sql`SELECT asset_key,original_url,status FROM reader_snapshot_assets WHERE snapshot_id=${snapshot.id}`;
  const keys=new Map(rows.map(row=>[row.original_url,row]));
  const $=cheerio.load(snapshot.bodyHtml,null,false);
  $("img").each((_,node)=>{
    const image=$(node),asset=keys.get(image.attr("src"));image.removeAttr("srcset");
    if(!asset||asset.status!=="ready"){
      const message=asset?.status==="failed"?"图片未能保存，请查看原文。":"图片正在保存，请稍后重载或查看原文。";
      image.replaceWith($("<span>").attr("role","note").text([image.attr("alt"),message].filter(Boolean).join("：")));return;
    }
    image.attr("src",privateRead?`/api/admin/reader/snapshots/${snapshot.id}/assets/${asset.asset_key}`:`/api/reader/articles/${snapshot.articleId}/assets/${snapshot.id}/${asset.asset_key}`);
  });
  return $.html();
}
export async function publicationBody(input:PublishedBodyInput):Promise<string> {
  const [row]=await sql`SELECT id FROM reader_snapshots WHERE article_id=${input.articleId} AND body_revision=${input.bodyRevision} AND representation_hash=${input.representationHash}`;
  const snapshot=row?await readSnapshot(row.id):null;
  if(snapshot)return snapshotBody({...snapshot,bodyHtml:input.html});
  const $=cheerio.load(input.html,null,false);$("img").each((_,node)=>{$(node).replaceWith($("<span>").attr("role","note").text([$(node).attr("alt"),"图片正在保存，请稍后重载或查看原文。"].filter(Boolean).join("：")));});return $.html();
}
