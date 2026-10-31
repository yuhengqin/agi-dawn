// Opt-in real-source acceptance, separate from the network-isolated automatic tests.
import {readFile,writeFile} from "node:fs/promises";
import {sql,closeDb} from "@agidawn/backend/db";
import {config} from "@agidawn/backend/config";
import {installModules} from "@agidawn/backend/modules";
import {SERVER_MODULES} from "@agidawn/site/modules/server";
import {collectSource} from "@agidawn/backend/sources/collect";
import {extractArticleBody} from "@agidawn/backend/content/extract";
import {stopBoss} from "@agidawn/backend/jobs/queue";
import {archiveSnapshot} from "../modules/reader/archive/assets.ts";

if(process.argv.slice(2).join(" ")!=="--live")throw new Error("usage: node --env-file=.env scripts/validate-reader-sources.ts --live (performs real network requests)");
installModules(SERVER_MODULES);
const {sources}=JSON.parse(await readFile(new URL("../industry/sources.json",import.meta.url),"utf8")) as {sources:Array<{id:string}>};
const sourceIds=sources.map(source=>source.id);
const samples:Record<string,string>={"sshh-blog":"https://blog.sshh.io/p/i-asked-100-agents-to-hack-me","openai-developer-blog":"https://developers.openai.com/blog/eval-skills","openai-engineering":"https://openai.com/index/core-dump-epidemiology-data-infrastructure-bug","anthropic-engineering":"https://www.anthropic.com/research/code-execution-with-mcp","claude-dev":"https://claude.dev/blog/solving-code-review-at-anthropic"};
const rows:unknown[]=[];
try {
  for(const sourceId of sourceIds) {
    const collection=await collectSource(sourceId);
    const [article]=await sql`SELECT id,url FROM articles WHERE source_id=${sourceId} ORDER BY starts_with(url,${samples[sourceId]??""}) DESC,coalesce(published_at,discovered_at) DESC,id DESC LIMIT 1`;
    let extraction:string|null=null,archive:unknown=null;
    if(article) {
      extraction=await extractArticleBody(article.id,{force:true,paidFallback:false});
      const [snapshot]=await sql`SELECT id FROM reader_snapshots WHERE article_id=${article.id} ORDER BY created_at DESC,id DESC LIMIT 1`;
      if(snapshot) {
        await archiveSnapshot(snapshot.id);
        [archive]=await sql`SELECT s.id,s.status,s.data->>'quality' AS quality,count(a.asset_key)::int AS assets,count(a.asset_key) FILTER(WHERE a.status='ready')::int AS ready_assets
          FROM reader_snapshots s LEFT JOIN reader_snapshot_assets a ON a.snapshot_id=s.id WHERE s.id=${snapshot.id} GROUP BY s.id`;
      }
    }
    const [counts]=await sql`SELECT count(*)::int AS articles,count(*) FILTER(WHERE body_status='ok')::int AS bodies,
      count(*) FILTER(WHERE author IS NOT NULL)::int AS authors,count(*) FILTER(WHERE published_at IS NOT NULL)::int AS dated FROM articles WHERE source_id=${sourceId}`;
    const row={sourceId,collection,counts,sample:article??null,extraction,archive};rows.push(row);console.log(JSON.stringify(row));
  }
  await writeFile(config.dataDir+"/reader-live-validation.json",JSON.stringify({checkedAt:new Date().toISOString(),rows},null,2));
}finally {await stopBoss();await closeDb();}
