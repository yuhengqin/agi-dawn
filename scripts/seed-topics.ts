// One-time topic defaults. Re-running never overwrites administrator edits or matching tags.
import {readFileSync} from "node:fs";
import path from "node:path";
import {REPO_ROOT} from "@agidawn/backend/config";
import {sql,closeDb,type Db} from "@agidawn/backend/db";
import type {Topic} from "@agidawn/backend/publication/topics";

export async function seedTopics(db:Db=sql){
  const file=JSON.parse(readFileSync(path.join(REPO_ROOT,"industry/topics.json"),"utf8")) as {topics:Array<Topic&{entityId?:string}>};
  let added=0;
  for(const [position,topic] of file.topics.entries()){
    const tags=topic.entityId?["entity:"+topic.entityId]:topic.tags;
    const rows=await db`INSERT INTO article_topics(slug,name,definition,group_key,tags,position) VALUES(${topic.slug},${topic.name},${topic.definition},${topic.group},${tags},${position}) ON CONFLICT(slug) DO NOTHING RETURNING slug`;
    added+=rows.length;
  }
  return {added,total:file.topics.length};
}
if(import.meta.main){try{console.log(JSON.stringify(await seedTopics()));}finally{await closeDb();}}
