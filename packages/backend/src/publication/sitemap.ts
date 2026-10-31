import {sql} from "../db.ts";
import {escapeXml} from "../lib/text.ts";
import {sha256,stableJson} from "../lib/ids.ts";
import {serverModules,type SitemapEntry} from "../modules.ts";
import {READER_FROM,readerVisible} from "./items.ts";
import {siteUrl} from "./links.ts";
import {listTopicSummaries} from "./topics.ts";
import {loadPublicSources} from "./sources.ts";
export async function loadDiscoveryEntries(_at=new Date(),limits?:{urls:number}):Promise<SitemapEntry[]>{
  const rows=await sql`SELECT p.article_id AS id,md5(concat_ws('|',p.revision::text,a.body_html,a.body_quality,s.name,s.site_fulltext::text)) AS revision
    ${READER_FROM} WHERE ${readerVisible} AND p.indexable ORDER BY p.sort_at DESC,p.article_id DESC ${limits?sql`LIMIT ${limits.urls}`:sql``}`;
  const revision=sha256(stableJson(rows));
  const entries:SitemapEntry[]=["/","/about","/terms","/privacy","/changelog"].map(loc=>({loc,revision,changefreq:"daily"}));
  const [topics,sources]=await Promise.all([listTopicSummaries(),loadPublicSources()]);
  entries.push({loc:"/explore",revision:sha256(stableJson(topics))},{loc:"/explore?view=sources",revision:sha256(stableJson(sources))});
  for(const row of rows)entries.push({loc:"/items/"+row.id,revision:row.revision});
  for(const module of serverModules())if(module.sitemap?.entries)entries.push(...await module.sitemap.entries());
  return limits?entries.slice(0,limits.urls):entries;
}
export async function loadSitemap(){
  const entries=await loadDiscoveryEntries(new Date(),{urls:45000});
  const body=entries.map(entry=>"<url><loc>"+escapeXml(siteUrl(entry.loc))+"</loc></url>").join("\n");
  return {xml:'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+body+"\n</urlset>\n",expiresAt:Date.now()};
}
