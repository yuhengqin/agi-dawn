import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql,type Db} from "@agidawn/backend/db";
import {audit,Conflict} from "@agidawn/backend/audit";
import type {ManagedTopic} from "./contracts.ts";

const name=z.string().trim().min(1).max(60).refine(value=>!/[\0\r\n]/.test(value));
const definition=z.string().trim().min(1).max(2000).refine(value=>!value.includes("\0"));
const fields=z.object({name,definition}).strict();
export async function listManagedTopics(db:Db=sql,slug?:string):Promise<ManagedTopic[]>{
  return db<ManagedTopic[]>`SELECT t.slug,t.name,t.definition,t.version,count(p.article_id)::int AS "articleCount"
    FROM article_topics t LEFT JOIN publications p ON p.tags && t.tags
    WHERE (${slug??null}::text IS NULL OR t.slug=${slug??null})
    GROUP BY t.slug ORDER BY t.position,t.created_at,t.slug`;
}
export async function addTopic(input:unknown,actor:string):Promise<ManagedTopic>{
  const value=fields.parse(input),id=randomUUID(),slug="topic-"+id;
  return sql.begin(async tx=>{
    const rows=await tx`INSERT INTO article_topics(slug,name,definition,group_key,tags) VALUES(${slug},${value.name},${value.definition},'field',${["topic:"+id]}) ON CONFLICT(name) DO NOTHING RETURNING slug`;
    if(!rows.length)throw new Conflict("主题名称已存在，请使用其他名称");
    await audit(actor,"topic.add","topic:"+slug,null,null,value,{db:tx});
    return (await listManagedTopics(tx,slug))[0]!;
  });
}
export async function updateTopic(slug:string,input:unknown,actor:string):Promise<ManagedTopic>{
  const value=fields.extend({expectedVersion:z.number().int().nonnegative()}).parse(input);
  try{return await sql.begin(async tx=>{
    const [before]=await tx`SELECT name,definition,version FROM article_topics WHERE slug=${slug} FOR UPDATE`;
    if(!before)throw Object.assign(new Error("主题不存在"),{statusCode:404});
    if(before.version!==value.expectedVersion)throw new Conflict("主题已改变，输入已保留，请重新载入后再调整");
    if(before.name!==value.name||before.definition!==value.definition){
      await tx`UPDATE article_topics SET name=${value.name},definition=${value.definition},version=version+1,updated_at=now() WHERE slug=${slug}`;
      await audit(actor,"topic.update","topic:"+slug,null,before,{name:value.name,definition:value.definition,version:before.version+1},{db:tx});
    }
    return (await listManagedTopics(tx,slug))[0]!;
  });}catch(error){if((error as {code?:string}).code==="23505")throw new Conflict("主题名称已存在，请使用其他名称");throw error;}
}
