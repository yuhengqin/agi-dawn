// Topic names and descriptions are live metadata; matching identities remain stable.
import {readFileSync} from "node:fs";
import path from "node:path";
import {READER_TOPIC_FILTERS,type ReaderTopicQuery,type TopicGroup,type TopicGroupKey,type TopicsResponse} from "@agidawn/contracts/site";
import {REPO_ROOT} from "../config.ts";
import {sql,type Db} from "../db.ts";
import {READER_FROM} from "./items.ts";
import {readerFilters,withSearchCapacity} from './query.ts';
import {shared} from '../lib/cache.ts';
export interface Topic {slug:string;name:string;group:TopicGroupKey;definition:string;tags:string[]}
const file=JSON.parse(readFileSync(path.join(REPO_ROOT,"industry/topics.json"),"utf8")) as {groups:TopicGroup[]};
export const TOPIC_GROUPS=file.groups;
const columns=sql`slug,name,group_key AS "group",definition,tags`;
export async function listTopics(db:Db=sql):Promise<Topic[]>{return db<Topic[]>`SELECT ${columns} FROM article_topics ORDER BY position,created_at,slug`;}
export async function findTopic(slug:string,db:Db=sql):Promise<Topic|null>{const [topic]=await db<Topic[]>`SELECT ${columns} FROM article_topics WHERE slug=${slug}`;return topic??null;}
export const topicBrowseLinks=async()=>(await listTopics()).map(({slug,name,group})=>({slug,name,group}));
type TopicSummaryRow=Omit<Topic,'tags'>&{total:number;recent:number;latest_title:string|null;latest_at:Date|null};
const sharedTopicSearch=shared((input:{key:string;run:(db:Db)=>Promise<TopicSummaryRow[]>})=>input.key,input=>withSearchCapacity(input.run));
export async function listTopicSummaries(query:ReaderTopicQuery={}):Promise<TopicsResponse>{
  const {joins,where,terms}=await readerFilters(query);
  // Evaluate the filtered public set once; empty topics remain available as alternatives.
  const run=async(db:Db)=>db<TopicSummaryRow[]>`WITH matches AS MATERIALIZED (
    SELECT p.article_id,p.title,p.sort_at,p.tags ${READER_FROM} ${terms.length?joins:sql``} WHERE ${where}
  ) SELECT t.slug,t.name,t.group_key AS "group",t.definition,counts.total,counts.recent,latest.title AS latest_title,latest.sort_at AS latest_at
    FROM article_topics t
    CROSS JOIN LATERAL (SELECT count(*)::int AS total,count(*) FILTER(WHERE m.sort_at>=now()-interval '30 days')::int AS recent
      FROM matches m WHERE m.tags && t.tags) counts
    LEFT JOIN LATERAL (SELECT m.title,m.sort_at FROM matches m WHERE m.tags && t.tags ORDER BY m.sort_at DESC,m.article_id DESC LIMIT 1) latest ON true
    ORDER BY t.position,t.created_at,t.slug`;
  const key=JSON.stringify(READER_TOPIC_FILTERS.map(key=>key==='q'?query.q?.trim()??'':query[key]??null));
  const rows=terms.length?await sharedTopicSearch({key,run}):await run(sql);
  const topics=rows.map(topic=>({slug:topic.slug,name:topic.name,group:topic.group,definition:topic.definition,brand:null,total:topic.total,recent:topic.recent,indexable:topic.total>0,
    latest:topic.latest_at?{title:topic.latest_title!,at:topic.latest_at.toISOString()}:null}));
  return {groups:TOPIC_GROUPS,topics};
}
