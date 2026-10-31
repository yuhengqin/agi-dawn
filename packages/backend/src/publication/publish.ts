// Raw material and persistent manual decisions define the only public projection.
import {sql,type Tx} from "../db.ts";
import {stableJson} from "../lib/ids.ts";
import {collapseWhitespace} from "../lib/text.ts";
import {emit} from "../modules.ts";
import {shutdownSignal} from "../jobs/queue.ts";
import {publicSourceName,displayTags} from "./rules.ts";
import {captureStoredMaterial} from "../content/materials.ts";
export interface PublishOptions {now?:Date}
export interface PublishResult {articleId:string;changed:boolean;changeKind:"content";visibility:string;reduced:boolean}
const text=(value:unknown,fallback:string|null)=>typeof value==="string"?value.trim()||fallback:fallback;
export async function publishArticle(articleId:string,options:PublishOptions={}):Promise<PublishResult|null>{
  return sql.begin(async tx=>{const result=await publishArticleTx(tx,articleId,options);await captureStoredMaterial(tx,articleId);if(result?.changed)await emit("articleChanged",{id:articleId,kind:"content",reduced:result.reduced,reason:"republication"},tx);return result;});
}
export async function publishArticleTx(tx:Tx,articleId:string,options:PublishOptions={}):Promise<PublishResult|null>{
  const [a]=await tx`SELECT a.*,s.name AS source_name,s.site_fulltext,s.participation_mode,s.kind,s.tier,s.config,s.tags AS source_tags
    FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=${articleId} FOR UPDATE OF a`;
  if(!a)return null;
  const [override]=await tx`SELECT fields,visibility FROM editorial_overrides WHERE article_id=${articleId}`;
  const [previous]=await tx`SELECT * FROM publications WHERE article_id=${articleId}`;
  const fields=override?.fields??{};
  const title=text(fields.title,collapseWhitespace(a.title))!;
  const summary=typeof fields.summary==="string"?fields.summary.trim()||null:a.excerpt;
  const category=fields.category===null?null:text(fields.category,null);
  const rawTags=Array.isArray(fields.tags)?fields.tags:a.source_tags;
  const tags=[...new Set<string>(rawTags.filter((value:unknown):value is string=>typeof value==="string").map((value:string)=>value.trim()).filter(Boolean))].slice(0,20);
  const visibility=a.participation_mode==="editorial"?(override?.visibility??"public"):"withdrawn";
  const eligible=a.participation_mode==="editorial"&&!!title;
  const bodyMode=visibility==="public"&&a.site_fulltext&&a.body_status==="ok"&&a.body_html?"full":"summary";
  const searchText=collapseWhitespace([title,summary,publicSourceName(a.source_name),...displayTags(tags)].filter(Boolean).join(" ")).toLowerCase();
  const next={source_id:a.source_id,first_party:a.tier==="T1",visibility,eligible,title,summary,category,tags,body_mode:bodyMode,
    url:a.url,channel:a.kind==="x_search"?"x":"news",published_at:a.published_at,discovered_at:a.discovered_at,timeline_at:a.published_at??a.discovered_at,
    backfill:a.backfill,sort_at:a.published_at??a.discovered_at,indexable:eligible&&visibility==="public"&&!previous?.seo_excluded_at,search_text:searchText};
  const changed=!previous||Object.entries(next).some(([key,value])=>stableJson(previous[key])!==stableJson(value));
  const revision=previous?previous.revision+(changed?1:0):1;
  const updatedAt=changed?(options.now??new Date()):previous.updated_at;
  await tx`INSERT INTO publications ${tx({article_id:articleId,...next,revision,updated_at:updatedAt} as never)}
    ON CONFLICT(article_id) DO UPDATE SET ${tx({...next,revision,updated_at:updatedAt} as never)}`;
  if(eligible&&visibility!=="withdrawn"){
    const body=bodyMode==="full"?(a.body_text??"").toLowerCase():"";
    await tx`INSERT INTO pool_search(article_id,direct,body) VALUES (${articleId},${searchText},${body})
      ON CONFLICT(article_id) DO UPDATE SET direct=EXCLUDED.direct,body=EXCLUDED.body`;
  }else await tx`DELETE FROM pool_search WHERE article_id=${articleId}`;
  const reduced=!!previous&&previous.eligible&&previous.visibility!=="withdrawn"&&(!eligible||visibility==="withdrawn"||previous.visibility==="public"&&visibility!=="public"||previous.body_mode==="full"&&bodyMode!=="full");
  return {articleId,changed,changeKind:"content",visibility,reduced};
}
export async function setSeoDecision(tx:Tx,articleId:string,indexed:boolean){
  await tx`UPDATE publications SET seo_indexed_at=CASE WHEN ${indexed} THEN now() ELSE NULL END,seo_excluded_at=CASE WHEN ${indexed} THEN NULL ELSE now() END WHERE article_id=${articleId}`;
  return publishArticleTx(tx,articleId);
}
export async function republishSource(sourceId:string,onProgress?:(done:number,total:number)=>Promise<void>){
  const [count]=await sql`SELECT count(*)::int AS total FROM articles WHERE source_id=${sourceId}`;
  let after="",done=0,changed=0,reduced=0;
  for(;;){
    const batch=await sql`SELECT id FROM articles WHERE source_id=${sourceId} AND id>${after} ORDER BY id LIMIT 500`;
    if(!batch.length)break;
    for(const row of batch){
      if(shutdownSignal.signal.aborted)throw new Error("worker is stopping; republish resumes after restart");
      const result=await publishArticle(row.id);if(result?.changed)changed++;if(result?.reduced)reduced++;
    }
    done+=batch.length;after=batch.at(-1)!.id;await onProgress?.(done,Number(count!.total));
  }
  return {total:Number(count!.total),changed,reduced};
}
