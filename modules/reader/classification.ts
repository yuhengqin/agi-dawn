import {z} from "zod";
import {sql,type Db} from "@agidawn/backend/db";
import {overrideFieldsTx} from "@agidawn/backend/admin/content";
import {Conflict} from "@agidawn/backend/audit";
import {listTopics} from "@agidawn/backend/publication/topics";
import {categoryExists} from "@agidawn/backend/publication/categories";
import type {ClassifiedArticle,BulkClassificationResult} from "./contracts.ts";
import {missing} from "./state.ts";

interface ClassificationRow {id:string;title:string;category:string|null;source_tags:string[];fields:{tags?:string[];category?:string|null}|null;version:number}
async function classificationRow(id:string,db:Db,locked=false){
  const [row]=await db<ClassificationRow[]>`SELECT a.id,a.title,p.category,s.tags AS source_tags,o.fields,coalesce(o.version,0) AS version
    FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id
    LEFT JOIN editorial_overrides o ON o.article_id=a.id WHERE a.id=${id} ${locked?sql`FOR UPDATE OF a FOR SHARE OF s`:sql``}`;
  if(!row)throw missing();return row;
}
const effectiveTags=(row:ClassificationRow):string[]=>Array.isArray(row.fields?.tags)?row.fields.tags:row.source_tags;
export async function readArticleClassification(id:string,db:Db=sql):Promise<ClassifiedArticle>{
  const row=await classificationRow(id,db),tags=effectiveTags(row),topics=await listTopics(db);
  return {id:row.id,title:row.title,category:row.category,classificationVersion:row.version,
    topicSlugs:topics.filter(t=>t.tags.some(tag=>tags.includes(tag))).map(t=>t.slug)};
}
const selection=z.object({expectedVersion:z.number().int().nonnegative(),category:z.string().min(1).max(80).nullable(),topicSlugs:z.array(z.string().min(1).max(100)).max(20)}).strict();
export async function saveArticleClassification(id:string,input:unknown,actor:string):Promise<ClassifiedArticle>{
  const value=selection.parse(input);
  return sql.begin(async tx=>{
    const topics=await listTopics(tx),find=(slug:string)=>topics.find(t=>t.slug===slug);
    if(new Set(value.topicSlugs).size!==value.topicSlugs.length||value.topicSlugs.some(slug=>!find(slug)))throw Object.assign(new Error("主题不存在或重复，请重新选择"),{statusCode:400});
    const row=await classificationRow(id,tx,true);if(row.version!==value.expectedVersion)throw new Conflict("分类或主题已改变，请重新载入后再保存");
    const managed=new Set(topics.flatMap(t=>t.tags));
    const tags=[...new Set([...effectiveTags(row).filter(tag=>!managed.has(tag)),...value.topicSlugs.flatMap(slug=>find(slug)!.tags)])];
    if(tags.length>20)throw Object.assign(new Error("所选主题与其他标签合计超过20个，请减少主题或先整理其他标签"),{statusCode:400});
    await overrideFieldsTx(tx,id,{fields:{category:value.category,tags},version:value.expectedVersion,reason:"文章分类与主题"},actor);
    return readArticleClassification(id,tx);
  });
}

const topicSlugs=z.array(z.string().min(1).max(100)).max(20);
const bulkSelection=z.object({
  articles:z.array(z.object({id:z.string().regex(/^[\w-]{1,80}$/),expectedVersion:z.number().int().nonnegative()}).strict()).min(1).max(100),
  category:z.string().min(1).max(80).nullable().optional(),addTopicSlugs:topicSlugs,removeTopicSlugs:topicSlugs,
}).strict().refine(value=>value.category!==undefined||value.addTopicSlugs.length>0||value.removeTopicSlugs.length>0,"请选择要进行的整理操作");
export async function saveBulkClassification(input:unknown,actor:string):Promise<BulkClassificationResult>{
  const value=bulkSelection.parse(input),invalid=(message:string)=>Object.assign(new Error(message),{statusCode:400});
  if(new Set(value.articles.map(a=>a.id)).size!==value.articles.length)throw invalid("所选文章重复，请重新选择");
  const slugs=[...value.addTopicSlugs,...value.removeTopicSlugs];
  const category=value.category==="uncategorized"?null:value.category;
  return sql.begin(async tx=>{
    const topics=await listTopics(tx),find=(slug:string)=>topics.find(t=>t.slug===slug);
    if(new Set(slugs).size!==slugs.length||slugs.some(slug=>!find(slug)))throw invalid("主题不存在、重复或同时被添加和移除，请重新选择");
    if(category&&!await categoryExists(category,tx))throw invalid("分类不存在");
    const ids=value.articles.map(a=>a.id).sort();
    // Lock every article in the same order, then read versions after any wait.
    const locked=await tx`SELECT id FROM articles WHERE id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    if(locked.length!==ids.length)throw missing();
    await tx`SELECT id FROM sources WHERE id IN (SELECT source_id FROM articles WHERE id=ANY(${ids}::text[])) ORDER BY id FOR SHARE`;
    const removeTags=new Set(value.removeTopicSlugs.flatMap(slug=>find(slug)!.tags));
    const addTags=value.addTopicSlugs.flatMap(slug=>find(slug)!.tags);
    let changed=0;
    for(const id of ids){
      const row=await classificationRow(id,tx),expected=value.articles.find(a=>a.id===id)!.expectedVersion;
      if(row.version!==expected)throw new Conflict("所选文章的分类、主题或可见性已改变，整批未保存，请重新载入列表后再整理");
      const fields:{category?:string|null;tags?:string[]}={};
      const currentCategory=row.fields&&Object.hasOwn(row.fields,"category")?row.fields.category:row.category;
      if(category!==undefined&&category!==(currentCategory??null))fields.category=category;
      if(slugs.length){
        const before=effectiveTags(row),tags=[...new Set([...before.filter(tag=>!removeTags.has(tag)),...addTags])];
        if(tags.length!==before.length||tags.some(tag=>!before.includes(tag))){
          if(tags.length>20)throw invalid("所选文章的主题与其他标签合计超过20个，整批未保存，请减少主题或先整理其他标签");
          fields.tags=tags;
        }
      }
      if(!Object.keys(fields).length)continue;
      await overrideFieldsTx(tx,id,{fields,version:expected,reason:"私人书库批量整理"},actor);changed++;
    }
    return {selected:ids.length,changed};
  });
}
