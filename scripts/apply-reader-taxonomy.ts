// Explicit, reviewed article assignments for this site; never an automatic classifier.
import {readFileSync} from "node:fs";
import path from "node:path";
import {parseArgs} from "node:util";
import {z} from "zod";
import {REPO_ROOT} from "@agidawn/backend/config";
import {sql,closeDb} from "@agidawn/backend/db";
import {addCategoryTx} from "@agidawn/backend/admin/categories";
import {overrideFieldsTx} from "@agidawn/backend/admin/content";
import {listTopics} from "@agidawn/backend/publication/topics";

const batchSchema=z.object({
  snapshotAt:z.iso.datetime(),
  categories:z.array(z.object({key:z.string().min(1),name:z.string().trim().min(1).max(60)}).strict()).min(1),
  articles:z.array(z.object({sourceId:z.string().min(1),url:z.url(),title:z.string().optional(),category:z.string().nullable(),topics:z.array(z.string()),provisional:z.boolean()}).strict()).min(1),
}).strict();

export async function applyReaderTaxonomy(input:unknown,options:{database:string;apply?:boolean}){
  const batch=batchSchema.parse(input),apply=options.apply===true;
  const topics=await listTopics(),findTopic=(slug:string)=>topics.find(t=>t.slug===slug);
  const categoryKeys=new Set(batch.categories.map(c=>c.key));
  if(categoryKeys.size!==batch.categories.length||new Set(batch.categories.map(c=>c.name)).size!==batch.categories.length)throw new Error("分类重复");
  const targets=batch.articles.map(a=>JSON.stringify([a.sourceId,a.url]));
  if(new Set(targets).size!==targets.length)throw new Error("文章目标重复");
  for(const a of batch.articles){
    if(a.category!==null&&!categoryKeys.has(a.category))throw new Error("清单引用了未定义分类");
    if(new Set(a.topics).size!==a.topics.length||a.topics.some(slug=>!findTopic(slug)))throw new Error("清单引用了重复或未定义主题");
  }
  return sql.begin(apply?"":"read only",async tx=>{
    const [database]=await tx`SELECT current_database() AS name`;
    if(database!.name!==options.database)throw new Error("database name must match --database");
    const existing=await tx<{id:string;name:string}[]>`SELECT id,name FROM article_categories`;
    const categories=new Map(batch.categories.map(c=>[c.key,existing.find(row=>row.name===c.name)?.id]));
    const rows=await tx`SELECT a.id,a.url,a.source_id,s.tags AS source_tags,o.fields,coalesce(o.version,0) AS version,
      p.article_id AS publication_id,p.category,p.visibility FROM articles a JOIN sources s ON s.id=a.source_id
      LEFT JOIN editorial_overrides o ON o.article_id=a.id LEFT JOIN publications p ON p.article_id=a.id
      WHERE a.url=ANY(${batch.articles.map(a=>a.url)}::text[]) ORDER BY a.id`;
    const planned=batch.articles.map(a=>{
      const matches=rows.filter(row=>row.source_id===a.sourceId&&row.url===a.url);
      if(matches.length!==1||!matches[0]!.publication_id)throw new Error("文章缺失、重复或尚未发布："+a.url);
      const row=matches[0]!,category=a.category===null?null:categories.get(a.category);
      if(row.category!==null&&row.category!==category)throw new Error("已有分类与清单冲突："+a.url);
      const oldTags:string[]=Array.isArray(row.fields?.tags)?row.fields.tags:row.source_tags;
      const wanted=a.topics.flatMap(slug=>findTopic(slug)!.tags);
      const tags=[...new Set([...oldTags,...wanted])];
      if(tags.length>20)throw new Error("保留已有标签后超过20个，拒绝截断："+a.url);
      const addTags=wanted.some(tag=>!oldTags.includes(tag));
      return {assignment:a,row,tags,addTags,change:row.category!==category||addTags};
    }).sort((a,b)=>String(a.row.id).localeCompare(String(b.row.id)));
    const report={applied:apply,total:planned.length,changed:planned.filter(p=>p.change).length,
      unchanged:planned.filter(p=>!p.change).length,provisional:batch.articles.filter(a=>a.provisional).length,
      categoriesToCreate:batch.categories.filter(c=>!categories.get(c.key)).map(c=>c.name),
      topics:topics.filter(t=>batch.articles.some(a=>a.topics.includes(t.slug))).length};
    if(!apply)return report;
    for(const c of batch.categories)if(!categories.get(c.key))categories.set(c.key,(await addCategoryTx(tx,{name:c.name},"reader-taxonomy")).id);
    for(const p of planned){
      if(!p.change)continue;
      const category=p.assignment.category===null?null:categories.get(p.assignment.category)!;
      const result=await overrideFieldsTx(tx,p.row.id,{fields:{category,...(p.addTags?{tags:p.tags}:{})},version:p.row.version,
        reason:p.assignment.provisional?"第三阶段已确认分类与主题；仅标题摘要暂定，补正文后复核":"第三阶段已确认分类与主题；按人工复核清单归档"},"reader-taxonomy");
      if(result?.visibility!==p.row.visibility)throw new Error("发布可见性发生变化，整批回滚："+p.assignment.url);
    }
    return report;
  });
}

async function main(){
  const {values}=parseArgs({options:{database:{type:"string"},apply:{type:"boolean",default:false}},strict:true,allowPositionals:false});
  if(!values.database)throw new Error("用法：node --env-file=.env scripts/apply-reader-taxonomy.ts --database reader_dev [--apply]");
  const {assertLocalEnvironment}=await import("./local-reader.ts");
  assertLocalEnvironment(process.env);
  const batch=JSON.parse(readFileSync(path.join(REPO_ROOT,"industry/reader-taxonomy.json"),"utf8"));
  try{console.log(JSON.stringify(await applyReaderTaxonomy(batch,{database:values.database,apply:values.apply}),null,2));}
  finally{await closeDb();}
}
if(import.meta.main)main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"分类应用失败");process.exitCode=1;});
