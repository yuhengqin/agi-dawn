import {sql} from "../db.ts";
import {READER_FROM,readerVisible} from "../publication/items.ts";
export async function loadSiteStats(){
  const [row]=await sql`SELECT count(*)::int AS items,count(DISTINCT p.source_id)::int AS sources ${READER_FROM} WHERE ${readerVisible}`;
  return {items:Number(row!.items),sources:Number(row!.sources)};
}
