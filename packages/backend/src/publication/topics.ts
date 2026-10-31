// Topic names and descriptions are live metadata; matching identities remain stable.
import {readFileSync} from "node:fs";
import path from "node:path";
import type {TopicGroup,TopicGroupKey,TopicsResponse} from "@agidawn/contracts/site";
import {REPO_ROOT} from "../config.ts";
import {sql,type Db} from "../db.ts";
import {READER_FROM,readerVisible} from "./items.ts";
export interface Topic {slug:string;name:string;group:TopicGroupKey;definition:string;tags:string[]}
const file=JSON.parse(readFileSync(path.join(REPO_ROOT,"industry/topics.json"),"utf8")) as {groups:TopicGroup[]};
export const TOPIC_GROUPS=file.groups;
const columns=sql`slug,name,group_key AS "group",definition,tags`;
export async function listTopics(db:Db=sql):Promise<Topic[]>{return db<Topic[]>`SELECT ${columns} FROM article_topics ORDER BY position,created_at,slug`;}
export async function findTopic(slug:string,db:Db=sql):Promise<Topic|null>{const [topic]=await db<Topic[]>`SELECT ${columns} FROM article_topics WHERE slug=${slug}`;return topic??null;}
export const topicBrowseLinks=async()=>(await listTopics()).map(({slug,name,group})=>({slug,name,group}));
export async function listTopicSummaries():Promise<TopicsResponse>{
  const topics=await Promise.all((await listTopics()).map(async topic=>{
    const [count]=await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE p.sort_at>=now()-interval '30 days')::int AS recent ${READER_FROM} WHERE ${readerVisible} AND p.tags && ${topic.tags}::text[]`;
    const [latest]=await sql`SELECT p.title,p.sort_at ${READER_FROM} WHERE ${readerVisible} AND p.tags && ${topic.tags}::text[] ORDER BY p.sort_at DESC,p.article_id DESC LIMIT 1`;
    return {slug:topic.slug,name:topic.name,group:topic.group,definition:topic.definition,brand:null,total:Number(count!.total),recent:Number(count!.recent),indexable:Number(count!.total)>0,latest:latest?{title:latest.title,at:latest.sort_at.toISOString()}:null};
  }));
  return {groups:TOPIC_GROUPS,topics};
}
