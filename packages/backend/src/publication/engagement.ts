import type {ArticleEngagement} from "@agidawn/contracts/site";
import {sql} from "../db.ts";
import {READER_FROM,readerVisible} from "./items.ts";

export async function loadEngagement(ids:string[],visitorHash:string):Promise<ArticleEngagement[]>{
  return sql<ArticleEngagement[]>`SELECT p.article_id AS id,
    (SELECT coalesce(sum(e.views),0) FROM article_engagement e WHERE e.article_id=p.article_id) AS views,
    (SELECT count(*) FROM article_engagement e WHERE e.article_id=p.article_id AND e.liked) AS likes,
    EXISTS(SELECT 1 FROM article_engagement e WHERE e.article_id=p.article_id AND e.visitor_hash=${visitorHash} AND e.liked) AS liked
    ${READER_FROM} WHERE p.article_id IN ${sql(ids)} AND ${readerVisible} ORDER BY p.article_id`;
}
