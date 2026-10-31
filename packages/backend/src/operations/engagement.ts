import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {credential} from "../config.ts";
import {sql} from "../db.ts";
import {sha256} from "../lib/ids.ts";
import {READER_FROM,readerVisible} from "../publication/items.ts";

export const VISITOR_COOKIE="reader_visitor";
function signature(value:string){
  const key=credential("auth","SESSION_SECRET");if(!key)throw new Error("SESSION_SECRET is required for anonymous engagement");
  return createHmac("sha256",key).update("reader-visitor:"+value).digest("base64url");
}
export function newVisitor(){const value=randomBytes(24).toString("base64url");return value+"."+signature(value);}
export function visitorHash(token:string|undefined):string|null{
  if(!token||!/^[-\w]{32}\.[-\w]{43}$/.test(token))return null;
  const [value,given]=token.split(".") as [string,string];
  return timingSafeEqual(Buffer.from(signature(value)),Buffer.from(given))?sha256(value):null;
}

// The unique key serializes concurrent requests for one browser and article. Each action
// updates only its own fields, so a like and an open cannot erase one another.
export async function recordEngagement(id:string,visitor:string,action:"view"|"like"|"unlike"):Promise<boolean>{
  const rows=action==="view"?await sql`
    INSERT INTO article_engagement(article_id,visitor_hash,views,viewed_at)
    SELECT p.article_id,${visitor},1,now() ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}
    ON CONFLICT(article_id,visitor_hash) DO UPDATE SET
      views=article_engagement.views+CASE WHEN article_engagement.viewed_at IS NULL OR article_engagement.viewed_at<=now()-interval '30 minutes' THEN 1 ELSE 0 END,
      viewed_at=CASE WHEN article_engagement.viewed_at IS NULL OR article_engagement.viewed_at<=now()-interval '30 minutes' THEN now() ELSE article_engagement.viewed_at END
    RETURNING article_id`:
    await sql`INSERT INTO article_engagement(article_id,visitor_hash,liked)
    SELECT p.article_id,${visitor},${action==="like"} ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}
    ON CONFLICT(article_id,visitor_hash) DO UPDATE SET liked=excluded.liked RETURNING article_id`;
  return rows.length>0;
}
