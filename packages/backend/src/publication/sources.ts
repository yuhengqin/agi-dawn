import { sql } from "../db.ts";
import { publicSourceName } from "./rules.ts";
import { READER_FROM, readerVisible } from "./items.ts";

export async function loadPublicSources() {
  const rows = await sql`SELECT s.id,s.name,s.config,s.site_fulltext,count(*)::int AS articles,max(p.sort_at) AS latest_at ${READER_FROM}
    WHERE ${readerVisible} GROUP BY s.id ORDER BY lower(s.name),s.id`;
  return rows.map(r=>({id:r.id,name:publicSourceName(r.name),url:r.config.url??r.config.feedUrl??null,
    description:typeof r.config.description==="string"?r.config.description:null,articles:r.articles,fulltext:r.site_fulltext,latestAt:r.latest_at?.toISOString()??null}));
}
