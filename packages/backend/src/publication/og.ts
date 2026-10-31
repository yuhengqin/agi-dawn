import {sql} from "../db.ts";
import type {OgCard} from "../media/og.ts";
import {beijingDate} from "@agidawn/contracts/time";
import {READER_FROM,readerVisible} from "./items.ts";
import {publicSourceName} from "./rules.ts";
export async function loadItemOgCard(id:string):Promise<OgCard|null>{
  const [row]=await sql`SELECT p.title,p.summary,p.sort_at,s.name ${READER_FROM} WHERE p.article_id=${id} AND ${readerVisible}`;
  return row?{kicker:"文章",title:row.title,subtitle:row.summary,meta:publicSourceName(row.name)+" · "+beijingDate(row.sort_at.toISOString())}:null;
}
