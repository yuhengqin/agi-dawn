// Persistent operator decisions and body retries. No model, event or report work is reachable here.
import {z} from "zod";
import {sql,type Tx} from "../db.ts";
import {audit,auditHistory,Conflict} from "../audit.ts";
import {queueProcessing} from "../jobs/content.ts";
import {publishArticleTx,setSeoDecision} from "../publication/publish.ts";
import {emit} from "../modules.ts";
import {categoryExists} from "../publication/categories.ts";
const reason=z.string().trim().min(1).max(2000);
const version=z.number().int().nonnegative();
async function overrideRow(id:string,tx:Tx){
  if(!(await tx`SELECT 1 FROM articles WHERE id=${id} FOR UPDATE`).length)throw Object.assign(new Error("内容不存在"),{statusCode:404});
  const [row]=await tx`SELECT fields,visibility,version FROM editorial_overrides WHERE article_id=${id}`;
  return row??{fields:{},visibility:null,version:0};
}
export async function setVisibility(id:string,input:{visibility:"public"|"summary-only"|"withdrawn";reason:string;version:number},actor:string){
  z.object({visibility:z.enum(["public","summary-only","withdrawn"]),reason,version}).strict().parse(input);
  return sql.begin(async tx=>{
    const before=await overrideRow(id,tx);if(before.version!==input.version)throw new Conflict("人工设置已改变，请刷新后再操作");
    await tx`INSERT INTO editorial_overrides(article_id,visibility,reason,version,updated_by) VALUES (${id},${input.visibility},${input.reason},1,${actor})
      ON CONFLICT(article_id) DO UPDATE SET visibility=EXCLUDED.visibility,reason=EXCLUDED.reason,version=editorial_overrides.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    const result=await publishArticleTx(tx,id);
    await emit("articleChanged",{id,kind:"content",reduced:result?.reduced,reason:"manual visibility"},tx);
    await audit(actor,"content.visibility","content:"+id,input.reason,{visibility:before.visibility},{visibility:input.visibility},{db:tx});
    return result;
  });
}
const fieldsSchema=z.object({title:z.string().trim().min(1).max(300),summary:z.string().max(2000),category:z.string().min(1).max(80).nullable(),tags:z.array(z.string().trim().min(1).max(60)).max(20)}).partial().strict();
export async function overrideFields(id:string,input:{fields:unknown;clear?:string[];reason:string;version:number},actor:string){
  return sql.begin(tx=>overrideFieldsTx(tx,id,input,actor));
}
export async function overrideFieldsTx(tx:Tx,id:string,input:{fields:unknown;clear?:string[];reason:string;version:number},actor:string){
  z.object({reason,version,fields:z.unknown(),clear:z.array(z.enum(["title","summary","category","tags"])).optional()}).strict().parse(input);
  const fields=fieldsSchema.parse(input.fields??{});
  if(fields.category&&!await categoryExists(fields.category,tx))throw Object.assign(new Error("分类不存在"),{statusCode:400});
  if(fields.category==="uncategorized")fields.category=null;
  const before=await overrideRow(id,tx);if(before.version!==input.version)throw new Conflict("人工设置已改变，请刷新后再操作");
  const next={...before.fields,...fields};for(const key of input.clear??[])delete next[key];
  await tx`INSERT INTO editorial_overrides(article_id,fields,reason,version,updated_by) VALUES (${id},${tx.json(next)},${input.reason},1,${actor})
    ON CONFLICT(article_id) DO UPDATE SET fields=EXCLUDED.fields,reason=EXCLUDED.reason,version=editorial_overrides.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()`;
  const result=await publishArticleTx(tx,id);
  if(result?.changed)await emit("articleChanged",{id,kind:"content",reduced:result.reduced,reason:"manual correction"},tx);
  await audit(actor,"content.override","content:"+id,input.reason,before.fields,next,{db:tx});return result;
}
export async function setSeoIndexed(id:string,input:{indexed:boolean;reason:string},actor:string){
  z.object({indexed:z.boolean(),reason}).strict().parse(input);
  return sql.begin(async tx=>{
    const [before]=await tx`SELECT indexable FROM publications WHERE article_id=${id} FOR UPDATE`;if(!before)return null;
    const result=await setSeoDecision(tx,id,input.indexed);
    await audit(actor,"content.seo","content:"+id,input.reason,{indexed:before.indexable},{indexed:input.indexed},{db:tx});return result;
  });
}
export async function rerun(id:string,step:"extract",requestId:string,actor:string){
  z.literal("extract").parse(step);z.string().regex(/^[\w-]{8,80}$/).parse(requestId);
  return sql.begin(async tx=>{
    if(!(await tx`SELECT 1 FROM articles WHERE id=${id} FOR UPDATE`).length)return null;
    const [prior]=await tx`SELECT after FROM audit_log WHERE subject=${"content:"+id} AND action='content.rerun' AND request_id=${requestId} AND actor=${actor} ORDER BY id LIMIT 1`;
    if(prior)return {jobId:(prior.after as {jobId:string|null}).jobId};
    const jobId=await queueProcessing(id,{db:tx,refresh:true});
    await audit(actor,"content.rerun","content:"+id,"正文重新提取",null,{jobId,step},{db:tx,requestId});return {jobId};
  });
}
export async function searchContent(query:string){
  const term=query.trim();if(!term)return [];
  if(term.length>1000||term.includes("\0"))throw Object.assign(new Error("搜索过长或无效"),{statusCode:400});
  return sql`SELECT a.id,coalesce(p.title,a.title) AS title,a.url,s.name AS source,a.discovered_at,a.processing_state,p.visibility
    FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id
    WHERE a.id=${term} OR a.url=${term} OR a.title ILIKE ${"%"+term.replace(/[\\%_]/g,"\\$&")+"%"} ORDER BY a.discovered_at DESC,a.id LIMIT 50`;
}
export async function contentChain(id:string){
  const [article]=await sql`SELECT a.id,a.source_id,a.url,a.identity_key,a.title,a.author,a.language,a.published_at,a.discovered_at,a.revision,a.body_revision,a.body_quality,a.body_issues,
    a.body_status,a.processing_state,a.processing_error,a.body_refresh_requested_at,s.name AS source_name,s.kind AS source_kind,s.site_fulltext
    FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=${id}`;
  if(!article)return null;
  const [discoveries,revisions,publication,overrides,history]=await Promise.all([
    sql`SELECT source_id,via,discovered_at FROM article_discoveries WHERE article_id=${id} ORDER BY discovered_at`,
    sql`SELECT revision,title,content_hash,created_at FROM article_revisions WHERE article_id=${id} ORDER BY revision DESC LIMIT 10`,
    sql`SELECT * FROM publications WHERE article_id=${id}`,
    sql`SELECT fields,visibility,reason,version,updated_by,updated_at FROM editorial_overrides WHERE article_id=${id}`,
    auditHistory("content:"+id),
  ]);
  return {article,discoveries,revisions,publication:publication[0]??null,override:overrides[0]??null,history};
}
