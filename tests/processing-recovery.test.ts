// Receipt recovery must preserve billing and queue state, while body refresh keeps the last good body.
import { gate, tag, stub, Reply } from "./setup.ts";
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { closeDb, sql } from "@agidawn/backend/db";
import { upsertMaterial } from "@agidawn/backend/content/materials";
import { getBoss, QUEUES, stopBoss } from "@agidawn/backend/jobs/queue";
import { releaseReceipt } from "@agidawn/backend/operations/recover";
import {createServer} from "node:http";
import {once} from "node:events";
import {extractArticleBody} from "@agidawn/backend/content/extract";
import {setVisibility} from "@agidawn/backend/admin/content";
import {canReadArticleBody} from "@agidawn/backend/publication/access";
import {config} from "@agidawn/backend/config";
import {queueProcessing,processArticle} from '@agidawn/backend/jobs/content';

const T = tag();
const SOURCE = `recovery-${T}`;

before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
    VALUES (${SOURCE},'Recovery','rss','T1','editorial','2100-01-01')`;
});

test('a queued body refresh preserves its full token precision on success and bounded failure',async()=>{
  config.allowPrivateNetworkFetch=true;
  const content='A complete replacement body with technical details and a reliable rendering. '.repeat(12);
  let fail=false;
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(fail?'<html><body>Unavailable</body></html>':`<html><body><article><p>${content}</p></article></body></html>`);});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const provider=await stub(()=>new Reply(503,{error:'local fallback failure'}));
  const prior={key:process.env.JINA_API_KEY,base:process.env.JINA_BASE_URL};process.env.JINA_API_KEY='test-key';process.env.JINA_BASE_URL=provider.url;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='jina'`;
  try {
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const create=async(suffix:string)=>(await upsertMaterial({sourceId:SOURCE,url:origin+'/'+suffix,title:'Refresh '+suffix,bodyHtml:'<p>Last good body</p>',bodyText:'Last good body',bodyStatus:'ok',via:'fetch'})).articleId;
    const start=async(id:string)=>{await queueProcessing(id,{refresh:true});await sql`UPDATE articles SET body_refresh_requested_at=date_trunc('milliseconds',body_refresh_requested_at)+interval '123 microseconds' WHERE id=${id}`;};
    const success=await create('success');await start(success);
    assert.equal((await processArticle(success)).state,'ready');
    const [ready]=await sql`SELECT body_refresh_requested_at,processing_state,body_text FROM articles WHERE id=${success}`;
    assert.equal(ready!.body_refresh_requested_at,null);assert.equal(ready!.processing_state,'skipped');assert.ok(ready!.body_text.includes(content.trim()));
    const failure=await create('failure');await start(failure);fail=true;
    for(let n=1;n<=3;n++) {await processArticle(failure);const [row]=await sql`SELECT processing_attempts,processing_state,body_html FROM articles WHERE id=${failure}`;assert.equal(row!.processing_attempts,n);assert.equal(row!.processing_state,n===3?'failed':'new');assert.equal(row!.body_html,'<p>Last good body</p>');}
  }finally{if(prior.key===undefined)delete process.env.JINA_API_KEY;else process.env.JINA_API_KEY=prior.key;if(prior.base===undefined)delete process.env.JINA_BASE_URL;else process.env.JINA_BASE_URL=prior.base;await provider.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
afterEach(async () => {
  await sql`DELETE FROM pgboss.job WHERE data->>'articleId' IN (SELECT id FROM articles WHERE source_id=${SOURCE})`;
});
after(async () => { await stopBoss(); await closeDb(); });

async function article(name: string) {
  return (await upsertMaterial({ sourceId: SOURCE, url: `https://example.org/${T}/${name}`, title: `AI model ${T} ${name}`,
    bodyStatus: "pending", via: "fetch", backfill: "test fixture", publishedAt: new Date() })).articleId;
}

/** Queues extraction jobs in the past so they can be fetched immediately, even if the VM clock steps back. */
const queuedMinuteAgo = () => sql`UPDATE pgboss.job SET start_after = start_after - interval '1 minute' WHERE name = ${QUEUES.extractBody} AND state = 'created'`;

test("a failed audit rolls back the receipt release and the processing job", async () => {
  const id = await article("atomic");
  await sql`UPDATE articles SET processing_state='failed',processing_error='unknown receipt' WHERE id=${id}`;
  const [receipt] = await sql<{ id: number }[]>`INSERT INTO receipts (logical_key,service,purpose,subject,status)
    VALUES (${`atomic-${T}`},'jina','body_fallback',${`article:${id}@1`},'unknown') RETURNING id`;
  await sql.unsafe(`CREATE FUNCTION fail_release_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.actor = 'test-release-atomic' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER fail_release_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_release_audit()");
  try {
    await assert.rejects(releaseReceipt(receipt!.id, { billed: false, note: "verified" }, "test-release-atomic"), /injected audit failure/);
  } finally {
    await sql.unsafe("DROP TRIGGER fail_release_audit ON audit_log");
    await sql.unsafe("DROP FUNCTION fail_release_audit()");
  }
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${receipt!.id}`)[0]!.status, "unknown");
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${id}`)[0]!.processing_state, "failed");
  assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE data->>'articleId'=${id}`).length, 0);
  const released = await releaseReceipt(receipt!.id, { billed: false, note: "verified" }, "test");
  assert.equal(released?.requeued, true);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${`receipt:${receipt!.id}`} AND action='receipt.release'`).length, 1);
  const boss = await getBoss();
  await queuedMinuteAgo();
  const jobs = await boss.fetch(QUEUES.extractBody);
  for (const job of jobs) await boss.complete(QUEUES.extractBody, job.id);
});

test("an authorized recovery preserves unknown billing instead of claiming no charge", async () => {
  const id = await article("billing-unknown");
  await sql`UPDATE articles SET processing_state='failed',processing_error='unknown receipt' WHERE id=${id}`;
  const [receipt] = await sql<{ id: number }[]>`INSERT INTO receipts(logical_key,service,purpose,subject,status)
    VALUES(${`billing-unknown-${T}`},'jina','body_fallback',${`article:${id}@1`},'unknown') RETURNING id`;
  await sql`INSERT INTO receipt_attempts(receipt_id,service,attempt,status,error) VALUES(${receipt!.id},'jina',1,'unknown','request timed out')`;
  const result = await releaseReceipt(receipt!.id, { billed: null, note: "owner authorized recovery; billing remains unknown" }, "test");
  assert.equal(result?.requeued, true);
  const [record] = await sql`SELECT error FROM receipts WHERE id=${receipt!.id}`;
  assert.match(record!.error, /计费未知/);
  assert.doesNotMatch(record!.error, /供应商未计费/);
  const [logged] = await sql`SELECT after FROM audit_log WHERE action='receipt.release' AND subject=${`receipt:${receipt!.id}`}`;
  assert.equal(logged!.after.billed, null);
});

test("body refresh retains the last good body on failure and rejects a late result after revision or withdrawal",async()=>{
  await getBoss();
  config.allowPrivateNetworkFetch=true;
  await sql`UPDATE sources SET site_fulltext=true WHERE id=${SOURCE}`;
  let held=false;let asked=gate<void>(),release=gate<void>();
  const content="An exact technical explanation with code, tables and article details. ".repeat(30);
  const server=createServer(async(_req,res)=>{if(held){asked.open();await release.promise;}res.setHeader("Content-Type","text/html");res.end(held?`<html><body><article><h1>Fetched version</h1><p>${content}</p></article></body></html>`:"<html><body>sign in</body></html>");});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  try {
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/article`;
    const input={sourceId:SOURCE,url,title:"Last good version",bodyText:"Last good body",bodyHtml:"<p>Last good body</p>",bodyStatus:"ok" as const,via:"fetch" as const};
    const {articleId}=await upsertMaterial(input);
    assert.equal(await canReadArticleBody(articleId),true);
    assert.equal(await extractArticleBody(articleId,{force:true,paidFallback:false}),"unconfirmed");
    assert.equal((await sql`SELECT body_html FROM articles WHERE id=${articleId}`)[0]!.body_html,"<p>Last good body</p>");
    held=true;
    let pending=extractArticleBody(articleId,{force:true,paidFallback:false});
    await asked.promise;
    await upsertMaterial({...input,title:"New current version",bodyText:"Current good body",bodyHtml:"<p>Current good body</p>"});
    release.open();assert.equal(await pending,"skipped");
    assert.equal((await sql`SELECT body_html FROM articles WHERE id=${articleId}`)[0]!.body_html,"<p>Current good body</p>");
    asked=gate<void>();release=gate<void>();pending=extractArticleBody(articleId,{force:true,paidFallback:false});
    await asked.promise;
    await setVisibility(articleId,{visibility:"withdrawn",version:0,reason:"permanent withdrawal"},"test");
    release.open();await pending;
    assert.equal(await canReadArticleBody(articleId),false);
    await upsertMaterial({...input,title:"Recaptured title"});
    assert.equal(await canReadArticleBody(articleId),false);
  }finally{release.open();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
