import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after,test } from "node:test";
import { sql,closeDb } from "@agidawn/backend/db";
import { installModules } from "@agidawn/backend/modules";
import { upsertMaterial } from "@agidawn/backend/content/materials";
import { stopBoss } from "@agidawn/backend/jobs/queue";
import reader from "../server.ts";
import {publishArticle} from "@agidawn/backend/publication/publish";

installModules([reader]);
after(async()=>{await stopBoss();await closeDb();});
test("snapshot captures and archive jobs commit with their exact material",async()=>{
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,site_fulltext) VALUES ('snapshot-reader','Snapshots','rss','T1','editorial',true)`;
  const input={sourceId:"snapshot-reader",url:"https://example.com/snapshot",title:"Versioned original",bodyHtml:"<h2>Original</h2><p>Text</p>",bodyText:"Original Text",bodyStatus:"ok" as const,via:"fetch" as const};
  await upsertMaterial(input);
  const first=await sql`SELECT * FROM reader_snapshots`;
  assert.equal(first.length,1);
  const original=first[0]!;
  assert.equal(original.data.bodyHtml,input.bodyHtml);
  assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE name='reader.archive' AND data->>'snapshotId'=${original.id}`).length,1);
  await upsertMaterial(input);
  assert.equal((await sql`SELECT * FROM reader_snapshots`).length,1,"same input is idempotent");
  await upsertMaterial({...input,bodyHtml:"<h2>Original</h2><p><strong>Text</strong></p>"});
  const revised=await sql`SELECT * FROM reader_snapshots ORDER BY created_at,id`;
  assert.equal(revised.length,2);
  assert.equal(revised[0]!.body_revision,revised[1]!.body_revision,"HTML layout change is a distinct representation of the same text revision");
  assert.notEqual(revised[0]!.representation_hash,revised[1]!.representation_hash);
  assert.equal(revised.find(row=>row.id===original.id)!.data.bodyHtml,input.bodyHtml,"old versions are immutable");
  await assert.rejects(sql.begin(async tx=>{
    await upsertMaterial({...input,url:"https://example.com/rolled-back",title:"Rolled back"},tx);
    throw new Error("intentional rollback");
  }),/intentional rollback/);
  assert.equal((await sql`SELECT * FROM reader_snapshots WHERE data->>'title'='Rolled back'`).length,0);
  assert.equal((await sql`SELECT * FROM pgboss.job WHERE name='reader.archive'`).length,2,"rolled back snapshot has no runnable job");
});

test('source and author metadata changes capture a new representation without mutating history',async()=>{
  await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES ('snapshot-metadata','Original source','rss',true)`;
  const {articleId}=await upsertMaterial({sourceId:'snapshot-metadata',url:'https://example.com/metadata-snapshot',title:'Original title',bodyHtml:'<p>Frozen body.</p>',bodyText:'Frozen body.',bodyStatus:'ok',via:'fetch'});
  const [first]=await sql`SELECT * FROM reader_snapshots WHERE article_id=${articleId}`;
  await sql`UPDATE sources SET name='Renamed source' WHERE id='snapshot-metadata'`;
  await sql`UPDATE articles SET author='Verified author' WHERE id=${articleId}`;
  await publishArticle(articleId);
  const rows=await sql`SELECT * FROM reader_snapshots WHERE article_id=${articleId}`;
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.id===first!.id)!.data.sourceName,'Original source');
  const changed=rows.find(row=>row.id!==first!.id)!;
  assert.equal(changed.data.sourceName,'Renamed source');assert.equal(changed.data.author,'Verified author');
  assert.equal(changed.body_revision,first!.body_revision);assert.notEqual(changed.representation_hash,first!.representation_hash);
});
