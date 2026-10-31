import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../../../apps/api/src/app.ts";
import { installModules } from "@agidawn/backend/modules";
import { closeDb, sql } from "@agidawn/backend/db";
import { config } from "@agidawn/backend/config";
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from "@agidawn/backend/admin/auth";
import { upsertMaterial,updatePresentation,captureStoredMaterial } from "@agidawn/backend/content/materials";
import { stopBoss } from "@agidawn/backend/jobs/queue";
import reader from "../server.ts";
import {overrideFields,setVisibility} from "@agidawn/backend/admin/content";
import {addCategory} from "@agidawn/backend/admin/categories";
import {tag} from "../../../tests/setup.ts";
import {currentSnapshot} from "../archive/snapshots.ts";
import {unzipSync,strFromU8} from 'fflate';

installModules([reader]);
const app = await buildApp();
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

test("owner state and notes require sessions, CSRF and optimistic versions", async () => {
  config.devAdmin = null;
  config.adminPassword = "reader-test-long-password";
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,site_fulltext) VALUES ('private-reader','Private source','rss','T1','editorial',true)`;
  const { articleId } = await upsertMaterial({ sourceId: "private-reader", title: "Private test", url: "https://example.com/private-reader", via: "fetch" });
  const base = `/api/admin/reader/articles/${articleId}`;
  assert.equal((await app.inject(base)).statusCode, 401);
  const { token } = await passwordLogin(config.adminPassword, "/admin/reader", "test");
  const cookie = `${SESSION_COOKIE}=${token}`;
  const principal = (await sessionPrincipal(cookie))!;
  const headers = { cookie, "x-csrf-token": principal.csrf };
  const empty = await app.inject({ url: base, headers });
  assert.equal(empty.headers["cache-control"], "no-store");
  assert.equal(empty.json().state.version, 0);
  assert.equal(empty.json().note.text, "");
  assert.equal((await app.inject({ method: "PUT", url: `${base}/note`, headers: { cookie }, payload: { expectedVersion: 0, text: "sentinel-private-note" } })).statusCode, 403);
  const save = (text: string) => app.inject({ method: "PUT", url: `${base}/note`, headers, payload: { expectedVersion: 0, text } });
  const results = await Promise.all([save("sentinel-private-note"), save("second draft")]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200,409]);
  const current = (await app.inject({ url: base, headers })).json();
  assert.equal(current.note.version, 1);
  const star = await app.inject({ method: "PATCH", url: `${base}/state`, headers, payload: { expectedVersion: 0, starred: true } });
  assert.equal(star.statusCode, 200);
  assert.equal(star.json().status, "to-read", "a star never changes reading status");
  const read = await app.inject({ method: "PATCH", url: `${base}/state`, headers, payload: { expectedVersion: 1, status: "read" } });
  assert.equal(read.statusCode, 200);
  assert.equal((await app.inject({ url: "/api/admin/reader/library?starred=true", headers })).json().items[0].id, articleId);
  const publicBody = (await app.inject(`/api/site/items/${articleId}`)).body;
  assert.ok(!publicBody.includes(current.note.text));
  assert.ok(!publicBody.includes('"starred"') && !publicBody.includes('"expectedVersion"'));
  assert.equal((await app.inject({ url: "/api/admin/reader/articles/unknown-reader", headers })).statusCode, 404);
});

async function ownerHeaders(){
  config.devAdmin=null;config.adminPassword="reader-test-long-password";
  const {token}=await passwordLogin(config.adminPassword,"/admin/reader","test");
  const cookie=`${SESSION_COOKIE}=${token}`;
  return {cookie,"x-csrf-token":(await sessionPrincipal(cookie))!.csrf};
}

const noteMetadata=(body:string)=>Object.fromEntries(body.split('\n').slice(1,body.split('\n').indexOf('---',1)).map(line=>{const at=line.indexOf(': ');return [line.slice(0,at),JSON.parse(line.slice(at+2))];}));
test('private Markdown export reads saved notes and current metadata without changing any article data',async()=>{
  const headers=await ownerHeaders(),source='note-export-'+tag(),category=await addCategory({name:'笔记分类 '+tag()},'test');
  const sourceName='Source "quoted"\n---\nnot_metadata: true';
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},${sourceName},'rss',ARRAY['Skills 与扩展'])`;
  const {articleId}=await upsertMaterial({sourceId:source,title:'Original title',url:`https://example.com/${source}`,author:'作者',publishedAt:new Date('2026-10-01T08:00:00Z'),via:'fetch'});
  await overrideFields(articleId,{fields:{title:'Corrected [title]',category:category.id},version:0,reason:'fixture'},'test');
  const saved='## 我的思考\n\n- 已保存笔记 **Markdown**\n```ts\nconst x = 1;\n```';
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${articleId},${saved})`;await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${articleId},true,'reading')`;
  const protectedRows=async()=>({articles:await sql`SELECT * FROM articles WHERE id=${articleId}`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=${articleId}`,state:await sql`SELECT * FROM reader_state WHERE article_id=${articleId}`,overrides:await sql`SELECT * FROM editorial_overrides WHERE article_id=${articleId}`,publications:await sql`SELECT * FROM publications WHERE article_id=${articleId}`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=${articleId}`,audits:await sql`SELECT * FROM audit_log ORDER BY id`});
  const before=await protectedRows(),route=`/api/admin/reader/articles/${articleId}/note.md`;
  const anonymous=await app.inject(route);assert.equal(anonymous.statusCode,401);assert.equal(anonymous.headers['cache-control'],'no-store');assert(!anonymous.body.includes(saved));
  const response=await app.inject({url:route,headers});assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers['content-type']!,/^text\/markdown; charset=utf-8/);assert.equal(response.headers['content-disposition'],`attachment; filename="reading-note-${articleId}.md"`);
  const metadata=noteMetadata(response.body);assert.equal(metadata.title,'Corrected [title]');assert.equal(metadata.source,sourceName);assert.equal(metadata.author,'作者');assert.equal(metadata.original_url,`https://example.com/${source}`);assert.equal(metadata.published_at,'2026-10-01T08:00:00.000Z');assert.equal(metadata.category,category.name);assert.deepEqual(metadata.topics,['Skills 与扩展']);assert.equal(metadata.reading_status,'reading');assert.equal(metadata.starred,true);assert.equal(metadata.note_version,1);assert(metadata.note_updated_at);assert(response.body.includes('阅读状态：在读'));assert(response.body.endsWith(saved+'\n'));assert.deepEqual(await protectedRows(),before);
  assert(!(await app.inject('/api/site/items/'+articleId)).body.includes(saved));
  await setVisibility(articleId,{visibility:'withdrawn',version:1,reason:'fixture'},'test');await sql`DELETE FROM publications WHERE article_id=${articleId}`;
  const privateOnly=await app.inject({url:route,headers});assert.equal(privateOnly.statusCode,200);assert.equal(noteMetadata(privateOnly.body).title,'Corrected [title]');assert.equal(noteMetadata(privateOnly.body).category,category.name);assert(privateOnly.body.includes(saved));
  assert.equal((await app.inject({url:'/api/admin/reader/articles/missing-export/note.md',headers})).statusCode,404);
});

test('export of an article without notes or publication time is explicit and never creates private rows',async()=>{
  const headers=await ownerHeaders(),source='empty-note-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Empty note source','rss')`;
  const {articleId}=await upsertMaterial({sourceId:source,title:'No saved note',url:`https://example.com/${source}`,via:'fetch'});
  const response=await app.inject({url:`/api/admin/reader/articles/${articleId}/note.md`,headers});assert.equal(response.statusCode,200,response.body);const metadata=noteMetadata(response.body);
  assert.equal(metadata.published_at,null);assert(metadata.collected_at);assert.equal(metadata.category,'待分类');assert.deepEqual(metadata.topics,[]);assert.equal(metadata.reading_status,'to-read');assert.equal(metadata.starred,false);assert.equal(metadata.note_version,0);assert.equal(metadata.note_updated_at,null);assert(response.body.includes('尚无已保存笔记'));
  assert.equal((await sql`SELECT 1 FROM reader_notes WHERE article_id=${articleId}`).length,0);assert.equal((await sql`SELECT 1 FROM reader_state WHERE article_id=${articleId}`).length,0);
});

test('batch note Markdown export contains exactly the selection and preserves all saved data',async()=>{
  const headers=await ownerHeaders(),source='bulk-note-export-'+tag();await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Batch export source','rss',ARRAY['Skills 与扩展'])`;
  const ids:string[]=[];for(let i=0;i<3;i++)ids.push((await upsertMaterial({sourceId:source,title:'Batch note '+i,url:`https://example.com/${source}/${i}`,bodyHtml:'<p>Never export body sentinel</p>',bodyText:'Never export body sentinel',bodyStatus:'ok',via:'fetch'})).articleId);
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${ids[0]!},'## Saved batch note\n\n原样保留 **Markdown**')`;await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${ids[0]!},true,'read')`;
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${ids[2]!},${' \t\n\u3000\ufeff'})`;
  const route='/api/admin/reader/notes/export.zip',payload={articleIds:[ids[1],ids[0]]};
  const protectedRows=async()=>({articles:await sql`SELECT * FROM articles WHERE source_id=${source} ORDER BY id`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,state:await sql`SELECT * FROM reader_state WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,overrides:await sql`SELECT * FROM editorial_overrides WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,publications:await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=ANY(${ids}::text[]) ORDER BY id`,audit:await sql`SELECT * FROM audit_log ORDER BY id`}),before=await protectedRows();
  assert.equal((await app.inject({method:'POST',url:route,payload})).statusCode,401);assert.equal((await app.inject({method:'POST',url:route,headers:{cookie:headers.cookie},payload})).statusCode,403);
  const response=await app.inject({method:'POST',url:route,headers,payload});assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['content-type'],'application/zip');assert.equal(response.headers['content-disposition'],'attachment; filename="reading-notes.zip"');
  const files=unzipSync(response.rawPayload);assert.deepEqual(Object.keys(files),payload.articleIds.map(id=>'reading-note-'+id+'.md'));
  for(const id of payload.articleIds){const single=await app.inject({url:'/api/admin/reader/articles/'+id+'/note.md',headers}),text=strFromU8(files['reading-note-'+id+'.md']!);assert.equal(text,single.body);assert(!text.includes('Never export body sentinel'));}
  assert(strFromU8(files['reading-note-'+ids[1]+'.md']!).includes('尚无已保存笔记'));
  const blank=await app.inject({method:'POST',url:route,headers,payload:{articleIds:[ids[2]]}});assert.equal(blank.statusCode,200);assert(strFromU8(unzipSync(blank.rawPayload)['reading-note-'+ids[2]+'.md']!).includes('尚无已保存笔记'),'whitespace-only notes have the same explicit empty marker');
  for(const input of [{articleIds:[]},{articleIds:[ids[0],ids[0]]},{articleIds:Array.from({length:101},(_,i)=>'item-'+i)},{articleIds:['bad/id']},{articleIds:[ids[0]],text:'unsaved draft'},{articles:ids},{articleIds:[null]}])assert.equal((await app.inject({method:'POST',url:route,headers,payload:input})).statusCode,400);
  const absent=await app.inject({method:'POST',url:route,headers,payload:{articleIds:[ids[0],'missing-note-export']}});assert.equal(absent.statusCode,404);assert(!String(absent.headers['content-type']).includes('zip'));assert(!absent.body.includes('Saved batch note'));
  assert.deepEqual(await protectedRows(),before);
});

test('batch note export keeps one snapshot while notes and metadata change during the download',async()=>{
  const headers=await ownerHeaders(),source='note-snapshot-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Snapshot source','rss')`;
  const ids:string[]=[];for(let i=0;i<2;i++)ids.push((await upsertMaterial({sourceId:source,title:'Old metadata '+i,url:`https://example.com/${source}/${i}`,via:'fetch'})).articleId);
  await sql`INSERT INTO reader_notes(article_id,text) SELECT id,'Old saved note' FROM articles WHERE source_id=${source}`;
  let release:()=>void=()=>{},locked:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>locked=resolve);
  const writer=sql.begin(async db=>{await db`LOCK TABLE reader_notes IN ACCESS EXCLUSIVE MODE`;locked();await gate;await db`UPDATE reader_notes SET text='New saved note',version=version+1 WHERE article_id=ANY(${ids}::text[])`;await db`UPDATE publications SET title='New metadata' WHERE article_id=ANY(${ids}::text[])`;});
  await ready;const pending=app.inject({method:'POST',url:'/api/admin/reader/notes/export.zip',headers,payload:{articleIds:ids}});
  try{
    let waiting=false;for(let i=0;i<100;i++){waiting=(await sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM reader_notes%'`).length>0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));}assert(waiting,'export reached its saved-note read after establishing the snapshot');
  }finally{release();await writer;}
  const response=await pending;assert.equal(response.statusCode,200,response.body);const files=unzipSync(response.rawPayload);
  for(const [i,id] of ids.entries()){const text=strFromU8(files['reading-note-'+id+'.md']!);assert.equal(noteMetadata(text).title,'Old metadata '+i);assert(text.includes('Old saved note'));assert(!text.includes('New saved note'));}
  assert((await app.inject({url:'/api/admin/reader/articles/'+ids[0]+'/note.md',headers})).body.includes('New saved note'));
});

test('private reading positions use independent CAS and exact body identity across snapshots',async()=>{
  const headers=await ownerHeaders(),source='position-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Position source','rss')`;
  const input={sourceId:source,title:'Position article',url:`https://example.com/${source}`,bodyHtml:'<h2>First</h2><p>First text</p><h3>Next</h3><p>Last text</p>',bodyText:'First First text Next Last text',bodyStatus:'ok' as const,via:'fetch' as const};
  const {articleId}=await upsertMaterial(input),snapshot=(await currentSnapshot(articleId))!;
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${articleId},'Keep saved note')`;await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${articleId},true,'read')`;
  const route=(id:string)=>'/api/admin/reader/snapshots/'+id+'/position',url=route(snapshot.id),point={expectedVersion:0,anchor:'sec-2',offset:0.25,progress:0.65};
  assert.equal((await app.inject(url)).statusCode,401);assert.equal((await app.inject({method:'PUT',url,payload:point})).statusCode,401);assert.equal((await app.inject({method:'PUT',url,headers:{cookie:headers.cookie},payload:point})).statusCode,403);
  const empty=await app.inject({url,headers});assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.headers['cache-control'],'no-store');assert.deepEqual(empty.json(),{position:null,previous:null});
  const before=async()=>({articles:await sql`SELECT * FROM articles WHERE id=${articleId}`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=${articleId}`,state:await sql`SELECT * FROM reader_state WHERE article_id=${articleId}`,overrides:await sql`SELECT * FROM editorial_overrides WHERE article_id=${articleId}`,publications:await sql`SELECT * FROM publications WHERE article_id=${articleId}`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=${articleId}`,audit:await sql`SELECT * FROM audit_log ORDER BY id`}),protectedRows=await before();
  const competing=await Promise.all([point,{...point,offset:0.8}].map(payload=>app.inject({method:'PUT',url,headers,payload})));assert.deepEqual(competing.map(r=>r.statusCode).sort(),[200,409]);const saved=competing.find(r=>r.statusCode===200)!.json();assert.equal(saved.version,1);assert.equal(saved.snapshotId,snapshot.id);assert.equal(saved.anchor,'sec-2');assert(saved.updatedAt);assert.equal(saved.bodyRevision,snapshot.bodyRevision);assert.equal((await app.inject({url,headers})).json().position.version,1);assert.deepEqual(await before(),protectedRows,'position writes do not mutate other business or audit rows');
  for(const payload of [{...point,anchor:'sec-99'},{...point,anchor:'#versions'},{...point,offset:-0.1},{...point,progress:1.1},{...point,extra:true},{...point,expectedVersion:-1}])assert.equal((await app.inject({method:'PUT',url,headers,payload})).statusCode,400);
  const stale=await app.inject({method:'PUT',url,headers,payload:point});assert.equal(stale.statusCode,409);assert.deepEqual((await app.inject({url,headers})).json().position,saved);
  await sql`UPDATE articles SET author='Metadata update' WHERE id=${articleId}`;await sql.begin(tx=>captureStoredMaterial(tx,articleId));const renamed=(await currentSnapshot(articleId))!;assert.notEqual(renamed.id,snapshot.id);
  assert.deepEqual((await app.inject({url:route(renamed.id),headers})).json().position,saved,'identical saved HTML shares the position despite metadata changes');
  await sql.begin(tx=>updatePresentation(tx,articleId,{html:'<h2>Different layout</h2><p>Same semantic revision</p>'}));const changed=(await currentSnapshot(articleId))!;assert.equal(changed.bodyRevision,snapshot.bodyRevision);const different=(await app.inject({url:route(changed.id),headers})).json();assert.equal(different.position,null);assert.equal(different.previous.snapshotId,snapshot.id,'changed HTML never receives the old position automatically');
  const newPoint=await app.inject({method:'PUT',url:route(changed.id),headers,payload:{expectedVersion:0,anchor:null,offset:0.5,progress:0.5}});assert.equal(newPoint.statusCode,200,newPoint.body);assert.deepEqual((await app.inject({url,headers})).json().position,saved,'old body retains its position');
  const publicBody=(await app.inject('/api/site/items/'+articleId)).body;assert(!publicBody.includes('"position"'));assert(!publicBody.includes('"offset"'));
  const outlined=(await app.inject({url:'/api/admin/reader/snapshots/'+snapshot.id,headers})).json();assert.deepEqual(outlined.outline.map((x:{id:string;text:string})=>[x.id,x.text]),[['sec-1','First'],['sec-2','Next']]);assert(outlined.bodyHtml.includes('id="sec-2"'));
  assert.equal((await app.inject({url:route('missing-position'),headers})).statusCode,404);assert.equal((await app.inject({method:'PUT',url:route('missing-position'),headers,payload:point})).statusCode,404);
});

test('private outlines and allowed position anchors stay fixed as heading images become ready',async()=>{
  const headers=await ownerHeaders(),source='heading-image-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Heading image','rss')`;
  const {articleId}=await upsertMaterial({sourceId:source,title:'Image headings',url:`https://example.com/${source}`,bodyHtml:'<h2><img src="https://example.com/diagram.png" alt="Architecture"></h2><h2>Readable section</h2><p>Body</p>',bodyText:'Readable section Body',bodyStatus:'ok',via:'fetch'}),snapshot=(await currentSnapshot(articleId))!;
  const expected=[{id:'sec-2',text:'Readable section',level:2}];let version=0;
  for(const status of ['pending','failed','ready']){
    await sql`UPDATE reader_snapshot_assets SET status=${status} WHERE snapshot_id=${snapshot.id}`;
    const response=await app.inject({url:'/api/admin/reader/snapshots/'+snapshot.id,headers});assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json().outline,expected,status+' has the same readable heading identities');
    const current=await app.inject({url:'/api/admin/reader/articles/'+articleId,headers});assert.deepEqual(current.json().currentSnapshot.outline,expected);
    const saved=await app.inject({method:'PUT',url:'/api/admin/reader/snapshots/'+snapshot.id+'/position',headers,payload:{expectedVersion:version,anchor:expected[0]!.id,offset:0.2,progress:0.6}});assert.equal(saved.statusCode,200,saved.body);version=saved.json().version;
  }
});

test('saved reader views retain six conditions, query new matches and delete only the view',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/views',source='views-'+tag(),category=await addCategory({name:'Views '+tag()},'test');
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'View source','rss',ARRAY['Skills 与扩展'])`;
  const make=async(title:string)=>{const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${tag()}`,title,bodyHtml:'<p>Saved view body</p>',bodyText:'Saved view body',bodyStatus:'ok',via:'fetch'});await overrideFields(articleId,{fields:{category:category.id},version:0,reason:'view fixture'},'test');return articleId;};
  const a=await make('memory view article'),b=await make('other view article');
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${a},'Private view note')`;await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${a},false,'to-read')`;
  const filters={q:'memory',sourceId:source,category:category.id,topic:'skills-extensions',starred:'false',status:'to-read'},name='Memory view '+tag();
  const created=await app.inject({method:'POST',url:route,headers,payload:{name:' '+name+' ',filters:{...filters,q:'  memory  '}}});assert.equal(created.statusCode,200,created.body);assert.equal(created.headers['cache-control'],'no-store');const view=created.json();
  assert.equal(view.name,name);assert.equal(view.version,1);assert.deepEqual(view.filters,filters);assert(view.id);assert(view.createdAt&&view.updatedAt);
  const get=await app.inject({url:route+'/'+view.id,headers});assert.equal(get.statusCode,200);assert.deepEqual(get.json(),view);
  const list=await app.inject({url:route,headers});assert.equal(list.headers['cache-control'],'no-store');assert(list.json().items.some((item:{id:string})=>item.id===view.id));
  const matches=async()=>{const response=await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams(view.filters),headers});assert.equal(response.statusCode,200,response.body);return response.json().items.map((item:{id:string})=>item.id).sort();};
  assert.deepEqual(await matches(),[a]);const c=await make('new memory view article');assert.deepEqual(await matches(),[a,c].sort(),'saved conditions query newly collected matching articles');
  await sql`UPDATE sources SET name='Renamed view source' WHERE id=${source}`;assert.deepEqual((await app.inject({url:route+'/'+view.id,headers})).json().filters,filters);
  const ids=[a,b,c],protectedRows=async()=>({articles:await sql`SELECT * FROM articles WHERE id=ANY(${ids}::text[]) ORDER BY id`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,state:await sql`SELECT * FROM reader_state WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,overrides:await sql`SELECT * FROM editorial_overrides WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,publications:await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=ANY(${ids}::text[]) ORDER BY id`});const before=await protectedRows();
  const rename=await app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload:{expectedVersion:1,name:'Renamed '+name}});assert.equal(rename.statusCode,200,rename.body);assert.equal(rename.json().id,view.id);assert.deepEqual(rename.json().filters,filters);assert.equal(rename.json().version,2);
  const update=await app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload:{expectedVersion:2,filters:{q:'other',sourceId:source}}});assert.equal(update.statusCode,200,update.body);assert.equal(update.json().name,'Renamed '+name);assert.deepEqual(update.json().filters,{q:'other',sourceId:source});
  const stale=await app.inject({method:'DELETE',url:route+'/'+view.id,headers,payload:{expectedVersion:2}});assert.equal(stale.statusCode,409);
  const deleted=await app.inject({method:'DELETE',url:route+'/'+view.id,headers,payload:{expectedVersion:3}});assert.equal(deleted.statusCode,200,deleted.body);assert.deepEqual(deleted.json(),{deleted:true});assert.equal((await app.inject({url:route+'/'+view.id,headers})).statusCode,404);
  assert.deepEqual(await protectedRows(),before);assert(!(await app.inject({url:route,headers})).json().items.some((item:{id:string})=>item.id===view.id));
  const auditRows=await sql`SELECT before,after FROM audit_log WHERE subject=${'reader-view:'+view.id}`;assert.equal(auditRows.length,4);assert(!JSON.stringify(auditRows).includes('memory'),'audit does not copy private query terms');
  const publicBody=(await app.inject('/api/site/items/'+a)).body;assert(!publicBody.includes(name));assert(!publicBody.includes('Private view note'));
});

test('saved reader views require authentication and CSRF and reject invalid or ambiguous conditions',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/views',valid={name:'Validation view '+tag(),filters:{}};
  for(const [method,url,payload] of [['GET',route,undefined],['GET',route+'/missing',undefined],['POST',route,valid],['PATCH',route+'/missing',{expectedVersion:1,name:'New'}],['DELETE',route+'/missing',{expectedVersion:1}]] as const){assert.equal((await app.inject({method,url,payload})).statusCode,401);if(method!=='GET')assert.equal((await app.inject({method,url,headers:{cookie:headers.cookie},payload})).statusCode,403);}
  const create=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:route,headers,payload});
  for(const payload of [{...valid,name:''},{...valid,name:'x'.repeat(61)},{...valid,name:'bad\nname'},{...valid,name:'bad\0name'},{...valid,filters:{q:'x'.repeat(201)}},{...valid,filters:{q:'one two three four five six seven'}},{...valid,filters:{q:'bad\0query'}},{...valid,filters:{sourceId:'missing-source'}},{...valid,filters:{category:'missing-category'}},{...valid,filters:{topic:'missing-topic'}},{...valid,filters:{starred:true}},{...valid,filters:{status:'done'}},{...valid,filters:{cursor:'old-page'}},{...valid,filters:{limit:40}},{...valid,filters:{articleIds:['any']}},{...valid,id:'chosen-id'}])assert.equal((await create(payload)).statusCode,400,JSON.stringify(payload));
  const added=await create({...valid,filters:{q:'   '}});assert.equal(added.statusCode,200,added.body);const view=added.json();assert.deepEqual(view.filters,{});
  const patch=(payload:Record<string,unknown>)=>app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload});
  for(const payload of [{expectedVersion:1},{expectedVersion:-1,name:'New'},{expectedVersion:1,name:'New',extra:true},{expectedVersion:1,filters:{topic:'missing-topic'}}])assert.equal((await patch(payload)).statusCode,400);
  const before=await sql`SELECT * FROM reader_saved_views WHERE id=${view.id}`,audits=await sql`SELECT * FROM audit_log WHERE subject=${'reader-view:'+view.id}`;
  const noChange=await patch({expectedVersion:1,name:' '+view.name+' ',filters:{q:' '}});assert.equal(noChange.statusCode,200,noChange.body);assert.equal(noChange.json().version,1);assert.deepEqual(await sql`SELECT * FROM reader_saved_views WHERE id=${view.id}`,before);assert.deepEqual(await sql`SELECT * FROM audit_log WHERE subject=${'reader-view:'+view.id}`,audits);
  assert.equal((await app.inject({method:'DELETE',url:route+'/'+view.id,headers,payload:{expectedVersion:1,articles:[]}})).statusCode,400);
  assert.equal((await app.inject({method:'PATCH',url:route+'/missing',headers,payload:{expectedVersion:1,name:'Missing'}})).statusCode,404);
});

test('saved view uniqueness, concurrent edits and audit failures preserve the previous record atomically',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/views',name='Atomic view '+tag(),create=(name:string)=>app.inject({method:'POST',url:route,headers,payload:{name,filters:{q:'initial'}}});
  const results=await Promise.all([create(name),create(' '+name+' ')]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);const view=results.find(r=>r.statusCode===200)!.json();
  const edits=await Promise.all([{name:'Renamed '+name},{filters:{q:'updated'}}].map(patch=>app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload:{expectedVersion:1,...patch}})));assert.deepEqual(edits.map(r=>r.statusCode).sort(),[200,409]);const current=edits.find(r=>r.statusCode===200)!.json();assert.equal(current.version,2);
  const other=await create('Other '+name);assert.equal(other.statusCode,200);
  assert.equal((await app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload:{expectedVersion:2,name:other.json().name}})).statusCode,409);
  const before=await sql`SELECT * FROM reader_saved_views ORDER BY id`,audits=await sql`SELECT * FROM audit_log WHERE action LIKE 'reader.view.%' ORDER BY id`;
  await sql.unsafe("CREATE FUNCTION refuse_view_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'reader.view.%' THEN RAISE EXCEPTION 'view audit unavailable'; END IF; RETURN NEW; END $$");await sql.unsafe('CREATE TRIGGER refuse_view_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_view_audit()');
  try{
    assert.equal((await create('Rollback '+name)).statusCode,500);
    assert.equal((await app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload:{expectedVersion:2,filters:{q:'never committed'}}})).statusCode,500);
    assert.equal((await app.inject({method:'DELETE',url:route+'/'+view.id,headers,payload:{expectedVersion:2}})).statusCode,500);
    assert.deepEqual(await sql`SELECT * FROM reader_saved_views ORDER BY id`,before);assert.deepEqual(await sql`SELECT * FROM audit_log WHERE action LIKE 'reader.view.%' ORDER BY id`,audits);
  }finally{await sql.unsafe('DROP TRIGGER refuse_view_audit ON audit_log; DROP FUNCTION refuse_view_audit()');}
  const competing=await Promise.all([app.inject({method:'PATCH',url:route+'/'+view.id,headers,payload:{expectedVersion:2,name:'Final '+name}}),app.inject({method:'DELETE',url:route+'/'+view.id,headers,payload:{expectedVersion:2}})]);
  assert.equal(competing.filter(r=>r.statusCode===200).length,1);assert(competing.every(r=>[200,404,409].includes(r.statusCode)));
});

test('managed topics rename without changing membership and newly created topics synchronize every reader entry',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/topics';
  assert.equal((await app.inject(route)).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:route,payload:{name:'No session',definition:'No session'}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:route,headers:{cookie:headers.cookie},payload:{name:'No CSRF',definition:'No CSRF'}})).statusCode,403);
  const source='topic-manager-'+tag();await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Managed topics','rss',ARRAY['MCP 与工具调用','Skills 与扩展','entity:keep'])`;
  const ids:string[]=[];for(let i=0;i<3;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'Managed topic '+i,bodyHtml:'<p>Saved topic body</p>',bodyText:'Saved topic body',bodyStatus:'ok',via:'fetch'})).articleId);
  await setVisibility(ids[1]!,{visibility:'withdrawn',version:0,reason:'fixture'},'test');await sql`DELETE FROM publications WHERE article_id=${ids[2]!}`;await sql`UPDATE sources SET enabled=false WHERE id=${source}`;
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${ids[0]!},'Private topic note')`;await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${ids[0]!},true,'reading')`;
  const protectedRows=async()=>({articles:await sql`SELECT * FROM articles WHERE id=ANY(${ids}::text[]) ORDER BY id`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=ANY(${ids}::text[]) ORDER BY id`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${ids}::text[])`,state:await sql`SELECT * FROM reader_state WHERE article_id=ANY(${ids}::text[])`});
  const original=await protectedRows(),publications=await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,overrides=await sql`SELECT * FROM editorial_overrides WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`;
  const get=async()=>{const response=await app.inject({url:route,headers});assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');return response.json().items;};
  const initial=(await get()).find((t:{slug:string})=>t.slug==='mcp-tool-use');assert(initial);assert.equal(initial.articleCount,2);
  const mapping=await sql`SELECT slug,tags FROM article_topics WHERE slug='mcp-tool-use'`;
  const name='Renamed MCP '+tag(),definition='Edited description for existing articles';
  const rename=await app.inject({method:'PATCH',url:route+'/mcp-tool-use',headers,payload:{name,definition,expectedVersion:initial.version}});assert.equal(rename.statusCode,200,rename.body);assert.equal(rename.json().slug,'mcp-tool-use');
  assert.deepEqual(await sql`SELECT slug,tags FROM article_topics WHERE slug='mcp-tool-use'`,mapping);
  assert.deepEqual(await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,publications);assert.deepEqual(await sql`SELECT * FROM editorial_overrides WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,overrides);
  const library=(await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({sourceId:source,topic:'mcp-tool-use'}),headers})).json();assert.equal(library.items.length,2);assert.equal(library.filters.topics.find((t:{slug:string})=>t.slug==='mcp-tool-use').name,name);
  const detail=(await app.inject({url:'/api/admin/reader/articles/'+ids[0],headers})).json();assert(detail.article.topicSlugs.includes('mcp-tool-use'));
  const publicTopics=(await app.inject('/api/site/topics')).json().topics;assert.equal(publicTopics.find((t:{slug:string})=>t.slug==='mcp-tool-use').name,name);assert.equal(publicTopics.find((t:{slug:string})=>t.slug==='mcp-tool-use').total,1);
  assert.equal(publicTopics.find((t:{slug:string})=>t.slug==='mcp-tool-use').definition,definition);
  assert.equal((await app.inject('/api/site/items/'+ids[0])).json().topics.find((t:{slug:string})=>t.slug==='mcp-tool-use').name,name);
  assert.equal((await app.inject('/api/site/search/suggestions')).json().topics.find((t:{slug:string})=>t.slug==='mcp-tool-use').name,name);
  const {seedTopics}=await import('../../../scripts/seed-topics.ts');await seedTopics();assert.equal((await get()).find((t:{slug:string})=>t.slug==='mcp-tool-use').name,name,'reinitialization never resets edited names');
  const created=await app.inject({method:'POST',url:route,headers,payload:{name:'MCP 与工具调用',definition:'Separate newly created topic'}});assert.equal(created.statusCode,200,created.body);const topic=created.json();assert.notEqual(topic.slug,'mcp-tool-use');assert.equal(topic.articleCount,0);
  await seedTopics();assert.equal((await get()).find((t:{slug:string})=>t.slug===topic.slug).articleCount,0,'reinitialization also preserves an old name reused for a new topic');
  assert.equal((await get()).find((t:{slug:string})=>t.slug==='mcp-tool-use').articleCount,2,'reusing an old name never captures its old articles');
  const single=await app.inject({method:'PATCH',url:'/api/admin/reader/articles/'+ids[0]+'/classification',headers,payload:{expectedVersion:0,category:null,topicSlugs:['mcp-tool-use','skills-extensions',topic.slug]}});assert.equal(single.statusCode,200,single.body);assert(single.json().topicSlugs.includes(topic.slug));
  const bulk=await app.inject({method:'PATCH',url:'/api/admin/reader/classification',headers,payload:{articles:[{id:ids[1],expectedVersion:1}],addTopicSlugs:[topic.slug],removeTopicSlugs:[]}});assert.equal(bulk.statusCode,200,bulk.body);
  const selected=(await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({sourceId:source,topic:topic.slug}),headers})).json();assert.equal(selected.items.length,2);assert(selected.filters.topics.some((t:{slug:string})=>t.slug===topic.slug));
  assert.equal((await get()).find((t:{slug:string})=>t.slug===topic.slug).articleCount,2);assert.equal((await get()).find((t:{slug:string})=>t.slug==='mcp-tool-use').articleCount,2);
  assert.equal((await app.inject('/api/site/articles?'+new URLSearchParams({topic:topic.slug}))).json().items.length,1);
  const publicItem=(await app.inject('/api/site/items/'+ids[0])).json();assert(publicItem.topics.some((t:{slug:string})=>t.slug===topic.slug));assert(!publicItem.tags.some((t:string)=>t.startsWith('topic:')));assert(!JSON.stringify(publicItem).includes('Private topic note'));
  assert.deepEqual(await protectedRows(),original);
});

test('topic edits validate names and versions and roll back when their audit fails',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/topics',name='Topic '+tag();
  const create=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:route,headers,payload});
  for(const payload of [{name:'',definition:'Valid'},{name:'x'.repeat(61),definition:'Valid'},{name:'Two\nlines',definition:'Valid'},{name:'Bad\0name',definition:'Valid'},{name,definition:''},{name,definition:'x'.repeat(2001)},{name,definition:'Bad\0description'},{name,definition:'Valid',slug:'chosen-slug'}])assert.equal((await create(payload)).statusCode,400);
  const added=await create({name,definition:'Initial definition'});assert.equal(added.statusCode,200,added.body);const topic=added.json();
  assert.equal((await create({name:' '+name+' ',definition:'Duplicate'})).statusCode,409);
  const change=(payload:Record<string,unknown>,slug=topic.slug)=>app.inject({method:'PATCH',url:route+'/'+slug,headers,payload});
  assert.equal((await change({name,definition:'Valid',expectedVersion:1},'unknown-topic')).statusCode,404);
  assert.equal((await change({name,definition:'Valid',expectedVersion:1,tags:[]})).statusCode,400);
  const results=await Promise.all(['One','Two'].map(definition=>change({name,definition,expectedVersion:1})));assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
  const before=await sql`SELECT * FROM article_topics WHERE slug=${topic.slug}`;
  await sql.unsafe(`CREATE FUNCTION refuse_topic_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject='topic:${topic.slug}' THEN RAISE EXCEPTION 'topic audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe('CREATE TRIGGER refuse_topic_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_topic_audit()');
  try{assert.equal((await change({name,definition:'Must roll back',expectedVersion:2})).statusCode,500);assert.deepEqual(await sql`SELECT * FROM article_topics WHERE slug=${topic.slug}`,before);}
  finally{await sql.unsafe('DROP TRIGGER refuse_topic_audit ON audit_log; DROP FUNCTION refuse_topic_audit()');}
});

test('bulk classification changes only selected fields and preserves private data and full tags',async()=>{
  const headers=await ownerHeaders(),source='bulk-'+tag(),category=await addCategory({name:'Bulk '+tag()},'test');
  await sql`INSERT INTO sources(id,name,kind,tags,site_fulltext) VALUES(${source},'Bulk source','rss',ARRAY['MCP 与工具调用','Skills 与扩展','source-keep','entity:source'],true)`;
  const ids:string[]=[];
  for(let i=0;i<3;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'Bulk article '+i,bodyHtml:'<p>Saved body</p>',bodyText:'Saved body',bodyStatus:'ok',via:'fetch'})).articleId);
  const [a,b,c]=ids as [string,string,string];
  await overrideFields(a,{fields:{title:'Keep corrected title',summary:'Keep summary',tags:['MCP 与工具调用','Skills 与扩展','manual-keep','entity:manual']},version:0,reason:'fixture'},'test');
  await setVisibility(a,{visibility:'withdrawn',version:1,reason:'fixture'},'test');
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${a},'Private bulk note')`;
  await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${a},true,'reading')`;
  const protectedRows=async()=>({articles:await sql`SELECT * FROM articles WHERE id=ANY(${ids}::text[]) ORDER BY id`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,state:await sql`SELECT * FROM reader_state WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=ANY(${ids}::text[]) ORDER BY id`});
  const original=await protectedRows(),unselected=await sql`SELECT * FROM publications WHERE article_id=${c}`;
  const url='/api/admin/reader/classification',payload={articles:[{id:a,expectedVersion:2},{id:b,expectedVersion:0}],category:category.id,addTopicSlugs:['performance-cost'],removeTopicSlugs:['mcp-tool-use']};
  assert.equal((await app.inject({method:'PATCH',url,payload})).statusCode,401);
  assert.equal((await app.inject({method:'PATCH',url,headers:{cookie:headers.cookie},payload})).statusCode,403);
  const saved=await app.inject({method:'PATCH',url,headers,payload});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.headers['cache-control'],'no-store');
  assert.deepEqual(saved.json(),{selected:2,changed:2});
  const [first]=await sql`SELECT fields,visibility,version FROM editorial_overrides WHERE article_id=${a}`;
  assert.deepEqual(first!.fields,{title:'Keep corrected title',summary:'Keep summary',category:category.id,tags:['Skills 与扩展','manual-keep','entity:manual','性能与成本']});
  assert.equal(first!.visibility,'withdrawn');assert.equal(first!.version,3);
  const [second]=await sql`SELECT fields,version FROM editorial_overrides WHERE article_id=${b}`;
  assert.deepEqual(second!.fields,{category:category.id,tags:['Skills 与扩展','source-keep','entity:source','性能与成本']});assert.equal(second!.version,1);
  assert.deepEqual(await protectedRows(),original);assert.deepEqual(await sql`SELECT * FROM publications WHERE article_id=${c}`,unselected);
  const filtered=(await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({sourceId:source,category:category.id,topic:'performance-cost',q:'article'}),headers})).json();
  assert.deepEqual(filtered.items.map((item:{id:string})=>item.id),[b]);assert.equal(filtered.items[0].classificationVersion,1);
  const publicBody=(await app.inject('/api/site/items/'+b)).body;assert(publicBody.includes('Saved body'));assert(!publicBody.includes('Private bulk note'));assert(!publicBody.includes('classificationVersion'));
  const cleared=await app.inject({method:'PATCH',url,headers,payload:{articles:[{id:b,expectedVersion:1}],category:null,addTopicSlugs:[],removeTopicSlugs:[]}});
  assert.equal(cleared.statusCode,200,cleared.body);assert.equal((await sql`SELECT category FROM publications WHERE article_id=${b}`)[0]!.category,null);
});

test('bulk classification rejects ambiguous input and rolls back stale or oversized selections without freezing no-ops',async()=>{
  const headers=await ownerHeaders(),source='bulk-validation-'+tag();
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Bulk validation','rss',ARRAY['MCP 与工具调用','entity:keep'])`;
  const ids:string[]=[];for(let i=0;i<2;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'Bulk validation',via:'fetch'})).articleId);ids.sort();
  const [a,b]=ids as [string,string],articles=ids.map(id=>({id,expectedVersion:0})),url='/api/admin/reader/classification';
  const save=(payload:Record<string,unknown>)=>app.inject({method:'PATCH',url,headers,payload});
  const valid={articles,addTopicSlugs:['skills-extensions'],removeTopicSlugs:[]};
  for(const payload of [
    {...valid,articles:[]},{...valid,articles:[articles[0],articles[0]]},{...valid,articles:Array.from({length:101},(_,i)=>({id:'article-'+i,expectedVersion:0}))},
    {...valid,category:'missing-category'},{...valid,addTopicSlugs:['missing-topic']},{...valid,addTopicSlugs:['skills-extensions','skills-extensions']},
    {...valid,removeTopicSlugs:['skills-extensions']},{...valid,articles:[{id:a,expectedVersion:-1}]},{...valid,tags:[]},
    {...valid,addTopicSlugs:[],removeTopicSlugs:[]},
  ])assert.equal((await save(payload)).statusCode,400,JSON.stringify(payload));
  const noChange=await save({...valid,category:'uncategorized',addTopicSlugs:['mcp-tool-use'],removeTopicSlugs:['performance-cost']});
  assert.equal(noChange.statusCode,200,noChange.body);assert.deepEqual(noChange.json(),{selected:2,changed:0});
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=ANY(${ids}::text[])`).length,0,'no-op does not freeze source inheritance');
  const baseline=await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`;
  const missingResponse=await save({...valid,articles:[articles[0],{id:'missing-bulk-article',expectedVersion:0}]});assert.equal(missingResponse.statusCode,404);
  assert.deepEqual(await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,baseline);
  await overrideFields(b,{fields:{tags:Array.from({length:20},(_,i)=>'keep-'+i)},version:0,reason:'full tags'},'test');
  const overflow=await save({...valid,articles:[{id:a,expectedVersion:0},{id:b,expectedVersion:1}]});assert.equal(overflow.statusCode,400);
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${a}`).length,0);
  const stale=await save(valid);assert.equal(stale.statusCode,409);assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${a}`).length,0);
  const onlyCategory=await save({articles:[{id:b,expectedVersion:1}],category:null,addTopicSlugs:[],removeTopicSlugs:[]});
  assert.equal(onlyCategory.statusCode,200,onlyCategory.body);assert.equal(onlyCategory.json().changed,0,'category-only no-op leaves an already full tag set alone');
});

test('bulk classification audit failure and overlapping concurrent batches never partially commit',async()=>{
  const headers=await ownerHeaders(),source='bulk-atomic-'+tag();
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Bulk atomic','rss',ARRAY['entity:keep'])`;
  const ids:string[]=[];for(let i=0;i<2;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'Bulk atomic',via:'fetch'})).articleId);ids.sort();
  const url='/api/admin/reader/classification',articles=ids.map(id=>({id,expectedVersion:0})),payload={articles,addTopicSlugs:['skills-extensions'],removeTopicSlugs:[]};
  const before=await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`;
  await sql.unsafe(`CREATE FUNCTION refuse_bulk_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject='content:${ids[1]}' THEN RAISE EXCEPTION 'bulk audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe('CREATE TRIGGER refuse_bulk_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_bulk_audit()');
  try{
    assert.equal((await app.inject({method:'PATCH',url,headers,payload})).statusCode,500);
    assert.deepEqual(await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,before);
    assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=ANY(${ids}::text[])`).length,0);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=ANY(${ids.map(id=>'content:'+id)}::text[])`).length,0);
  }finally{await sql.unsafe('DROP TRIGGER refuse_bulk_audit ON audit_log; DROP FUNCTION refuse_bulk_audit()');}
  const results=await Promise.all([payload,{...payload,articles:[...articles].reverse(),addTopicSlugs:['performance-cost']}].map(payload=>app.inject({method:'PATCH',url,headers,payload})));
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
  const rows=await sql`SELECT fields,version FROM editorial_overrides WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`;
  assert.equal(rows.length,2);assert(rows.every(row=>row.version===1));assert.deepEqual(rows[0]!.fields,rows[1]!.fields,'one entire batch wins');
  assert(!Object.hasOwn(rows[0]!.fields,'category'),'topic-only change does not pin category');
});

test('bulk reader state changes only selected private fields and preserves notes, classification and saved bodies',async()=>{
  const headers=await ownerHeaders(),source='bulk-state-'+tag(),category=await addCategory({name:'State '+tag()},'test');
  await sql`INSERT INTO sources(id,name,kind,tags,site_fulltext) VALUES(${source},'Bulk state','rss',ARRAY['Skills 与扩展','entity:keep'],true)`;
  const ids:string[]=[];for(let i=0;i<3;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'State article '+i,bodyHtml:'<p>Preserved saved body</p>',bodyText:'Preserved saved body',bodyStatus:'ok',via:'fetch'})).articleId);
  const [a,b,c]=ids as [string,string,string];
  await overrideFields(a,{fields:{title:'Corrected state title',summary:'Keep state summary',category:category.id,tags:['Skills 与扩展','manual-keep','entity:keep']},version:0,reason:'fixture'},'test');
  await setVisibility(b,{visibility:'withdrawn',version:0,reason:'fixture'},'test');await sql`UPDATE sources SET enabled=false WHERE id=${source}`;
  await sql`INSERT INTO reader_notes(article_id,text) VALUES(${a},'Private state note'),(${b},'Other private state note')`;
  await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${a},true,'reading'),(${c},true,'read')`;
  const protectedRows=async()=>({articles:await sql`SELECT * FROM articles WHERE id=ANY(${ids}::text[]) ORDER BY id`,notes:await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,overrides:await sql`SELECT * FROM editorial_overrides WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,publications:await sql`SELECT * FROM publications WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,snapshots:await sql`SELECT * FROM reader_snapshots WHERE article_id=ANY(${ids}::text[]) ORDER BY id`});
  const before=await protectedRows(),unselected=await sql`SELECT * FROM reader_state WHERE article_id=${c}`,url='/api/admin/reader/state';
  const payload={articles:[{id:a,expectedVersion:1},{id:b,expectedVersion:0}],starred:false};
  assert.equal((await app.inject({method:'PATCH',url,payload})).statusCode,401);
  assert.equal((await app.inject({method:'PATCH',url,headers:{cookie:headers.cookie},payload})).statusCode,403);
  const save=(payload:Record<string,unknown>)=>app.inject({method:'PATCH',url,headers,payload});
  const unstar=await save(payload);assert.equal(unstar.statusCode,200,unstar.body);assert.equal(unstar.headers['cache-control'],'no-store');assert.deepEqual(unstar.json(),{selected:2,changed:1});
  const state=async(id:string)=>(await app.inject({url:'/api/admin/reader/articles/'+id,headers})).json().state;
  assert.equal((await state(a)).status,'reading');assert.equal((await state(a)).starred,false);assert.equal((await state(a)).version,2);assert.equal((await state(b)).version,0);
  const read=await save({articles:[{id:a,expectedVersion:2},{id:b,expectedVersion:0}],status:'read'});assert.equal(read.statusCode,200,read.body);assert.deepEqual(read.json(),{selected:2,changed:2});
  assert.equal((await state(a)).starred,false);assert.equal((await state(b)).starred,false);
  const starred=await save({articles:[{id:a,expectedVersion:3},{id:b,expectedVersion:1}],starred:true});assert.equal(starred.statusCode,200,starred.body);assert.equal((await state(a)).status,'read');assert.equal((await state(b)).status,'read');
  const query=new URLSearchParams({sourceId:source,q:'body',starred:'true',status:'read',topic:'skills-extensions'});
  assert.deepEqual(new Set((await app.inject({url:'/api/admin/reader/library?'+query,headers})).json().items.map((item:{id:string})=>item.id)),new Set(ids));
  const reset=await save({articles:[{id:a,expectedVersion:4},{id:b,expectedVersion:2}],status:'to-read'});assert.equal(reset.statusCode,200,reset.body);assert.equal((await state(a)).starred,true);
  const reading=await save({articles:[{id:a,expectedVersion:5},{id:b,expectedVersion:3}],status:'reading'});assert.equal(reading.statusCode,200,reading.body);
  assert.deepEqual(await protectedRows(),before);assert.deepEqual(await sql`SELECT * FROM reader_state WHERE article_id=${c}`,unselected);
  const publicBody=(await app.inject('/api/site/items/'+a)).body;assert(!publicBody.includes('Private state note'));assert(!publicBody.includes('"starred"'));assert(!publicBody.includes('"status":"reading"'));
});

test('bulk reader state validates selections and checks even unchanged versions without creating default rows',async()=>{
  const headers=await ownerHeaders(),source='bulk-state-validation-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'State validation','rss')`;
  const ids:string[]=[];for(let i=0;i<2;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'State validation',via:'fetch'})).articleId);ids.sort();
  const [a,b]=ids as [string,string],articles=ids.map(id=>({id,expectedVersion:0})),url='/api/admin/reader/state';
  const save=(payload:Record<string,unknown>)=>app.inject({method:'PATCH',url,headers,payload}),valid={articles,starred:true};
  for(const payload of [{articles},{...valid,articles:[]},{...valid,articles:[articles[0],articles[0]]},{...valid,articles:Array.from({length:101},(_,i)=>({id:'state-'+i,expectedVersion:0}))},{...valid,articles:[{id:a,expectedVersion:-1}]},{...valid,articles:[{id:a,expectedVersion:0.5}]},{...valid,articles:[{id:'bad/id',expectedVersion:0}]},{...valid,articles:[{id:a,expectedVersion:0,extra:true}]},{...valid,starred:'true'},{...valid,status:'finished'},{...valid,status:null},{...valid,note:'never write this'},{...valid,category:null}])assert.equal((await save(payload)).statusCode,400,JSON.stringify(payload));
  const subjects=ids.map(id=>'article:'+id),noChange=await save({articles,starred:false,status:'to-read'});assert.equal(noChange.statusCode,200,noChange.body);assert.deepEqual(noChange.json(),{selected:2,changed:0});
  assert.equal((await sql`SELECT 1 FROM reader_state WHERE article_id=ANY(${ids}::text[])`).length,0);assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='reader.state' AND subject=ANY(${subjects}::text[])`).length,0);
  const missing=await save({...valid,articles:[articles[0],{id:'missing-state-article',expectedVersion:0}]});assert.equal(missing.statusCode,404);assert.equal((await sql`SELECT 1 FROM reader_state WHERE article_id=${a}`).length,0);
  await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${b},false,'reading')`;
  const stale=await save(valid);assert.equal(stale.statusCode,409);assert.equal((await sql`SELECT 1 FROM reader_state WHERE article_id=${a}`).length,0);
  const staleNoOp=await save({articles,starred:false});assert.equal(staleNoOp.statusCode,409,'unchanged fields still validate versions');
  const row=await sql`SELECT * FROM reader_state WHERE article_id=${b}`;
  const preserved=await save({articles:[articles[0],{id:b,expectedVersion:1}],starred:false});assert.equal(preserved.statusCode,200,preserved.body);assert.deepEqual(preserved.json(),{selected:2,changed:0});assert.deepEqual(await sql`SELECT * FROM reader_state WHERE article_id=${b}`,row);
});

test('bulk reader state audit failure and overlapping single or batch writes never partially commit',async()=>{
  const headers=await ownerHeaders(),source='bulk-state-atomic-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'State atomic','rss')`;
  const ids:string[]=[];for(let i=0;i<2;i++)ids.push((await upsertMaterial({sourceId:source,url:`https://example.com/${source}/${i}`,title:'State atomic',via:'fetch'})).articleId);ids.sort();
  const [a,b]=ids as [string,string],url='/api/admin/reader/state',articles=ids.map(id=>({id,expectedVersion:0})),payload={articles,starred:true,status:'read'};
  const save=(payload:Record<string,unknown>)=>app.inject({method:'PATCH',url,headers,payload}),subjects=ids.map(id=>'article:'+id);
  await sql.unsafe(`CREATE FUNCTION refuse_bulk_state_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject='article:${b}' AND NEW.action='reader.state' THEN RAISE EXCEPTION 'state audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe('CREATE TRIGGER refuse_bulk_state_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_bulk_state_audit()');
  try{assert.equal((await save(payload)).statusCode,500);assert.equal((await sql`SELECT 1 FROM reader_state WHERE article_id=ANY(${ids}::text[])`).length,0);assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='reader.state' AND subject=ANY(${subjects}::text[])`).length,0);}
  finally{await sql.unsafe('DROP TRIGGER refuse_bulk_state_audit ON audit_log; DROP FUNCTION refuse_bulk_state_audit()');}
  const batches=await Promise.all([save(payload),save({...payload,articles:[...articles].reverse(),starred:false,status:'reading'})]);assert.deepEqual(batches.map(r=>r.statusCode).sort(),[200,409]);
  const rows=await sql`SELECT starred,status,version FROM reader_state WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`;assert.equal(rows.length,2);assert.deepEqual(rows[0],rows[1]);assert.equal(rows[0]!.version,1);
  const competing=await Promise.all([save({articles:ids.map(id=>({id,expectedVersion:1})),starred:true,status:'to-read'}),app.inject({method:'PATCH',url:'/api/admin/reader/articles/'+b+'/state',headers,payload:{expectedVersion:1,starred:false,status:'read'}})]);assert.deepEqual(competing.map(r=>r.statusCode).sort(),[200,409]);
  const final=await sql`SELECT article_id,starred,status,version FROM reader_state WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`;
  if(competing[0]!.statusCode===200){assert(final.every(row=>row.starred&&row.status==='to-read'&&row.version===2));}
  else{assert.equal(final[0]!.version,1);assert.equal(final[1]!.version,2);assert.equal(final[1]!.starred,false);assert.equal(final[1]!.status,'read');}
  const counts=await sql`SELECT subject,count(*)::int AS count FROM audit_log WHERE action='reader.state' AND subject=ANY(${subjects}::text[]) GROUP BY subject`;
  assert.equal(counts.find(row=>row.subject==='article:'+a)!.count,final[0]!.version);assert.equal(counts.find(row=>row.subject==='article:'+b)!.count,final[1]!.version);
});

test('private keyword search spans displayed fields and saved notes without exposing them publicly',async()=>{
  const headers=await ownerHeaders(),source='search-'+tag();
  await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'Private search','rss',false)`;
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/${source}`,title:'Alpha article',excerpt:'Beta summary',bodyHtml:'<p>'+('preface '.repeat(2000))+'Gamma bodytail &amp; decoded</p>',bodyText:'Stale semantic text',bodyStatus:'ok',via:'fetch'});
  const base='/api/admin/reader/articles/'+articleId;
  const saveNote=(version:number,text:string)=>app.inject({method:'PUT',url:base+'/note',headers,payload:{expectedVersion:version,text}});
  assert.equal((await saveNote(0,'Delta 私人思考 100% _literal_ C:\\tools <img src=x onerror=alert(1)>')).statusCode,200);
  const search=async(q:string)=>{const response=await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({sourceId:source,q}),headers});assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');return response.json().items;};
  for(const [q,field] of [['ALPHA','title'],['beta','summary'],['gamma','body'],['DELTA','note'],['私人思考Delta','note'],['100%','note'],['_literal_','note'],['C:\\tools','note']]){
    const items=await search(q!);assert.deepEqual(items.map((a:{id:string})=>a.id),[articleId]);
    const match=items[0].matches.find((m:{field:string})=>m.field===field);assert(match);assert([...match.snippet].length<=160);
  }
  const tail=(await search('gamma'))[0].matches.find((m:{field:string})=>m.field==='body');assert.match(tail.snippet,/Gamma bodytail & decoded/);assert(tail.snippet.startsWith('…'));
  assert.deepEqual((await search('alpha delta'))[0].matches.map((m:{field:string})=>m.field),['title','note']);
  assert.deepEqual(await search('alpha missingword'),[]);assert.deepEqual(await search('Stale'),[]);
  assert.deepEqual((await search('   '))[0].matches,[]);
  await overrideFields(articleId,{fields:{title:'Renamed title',summary:''},version:0,reason:'search fields'} ,'test');
  assert.deepEqual(await search('alpha'),[]);assert.deepEqual(await search('beta'),[]);assert.equal((await search('renamed')).length,1);
  assert.equal((await saveNote(1,'Epsilon revised note')).statusCode,200);assert.deepEqual(await search('delta'),[]);assert.equal((await search('epsilon')).length,1);
  assert.equal((await saveNote(2,'')).statusCode,200);assert.deepEqual(await search('epsilon'),[]);
  for(const q of ['gamma','delta','Epsilon']){const response=await app.inject('/api/site/articles?'+new URLSearchParams({q}));assert(!response.json().items.some((a:{id:string})=>a.id===articleId));}
  const publicDetail=(await app.inject('/api/site/items/'+articleId)).body;assert(!publicDetail.includes('Gamma bodytail'));assert(!publicDetail.includes('Epsilon revised note'));assert(!publicDetail.includes('matches'));
  assert.equal((await app.inject('/api/admin/reader/library?q=delta')).statusCode,401);
});

test('private body search follows the exact current saved presentation and excludes historical or missing snapshots',async()=>{
  const headers=await ownerHeaders(),source='search-body-'+tag();
  await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES(${source},'Search body','rss',false)`;
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/${source}`,title:'Changing body',bodyHtml:'<p>Historicalword</p>',bodyText:'Historicalword',bodyStatus:'ok',via:'fetch'});
  const search=async(q:string)=>{const response=await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({sourceId:source,q}),headers});assert.equal(response.statusCode,200,response.body);return response.json().items;};
  assert.equal((await search('historicalword')).length,1);
  await sql.begin(tx=>updatePresentation(tx,articleId,{html:'<p>Open<strong>AI</strong> Currentword &amp; 新内容</p><pre><code><span>foo</span><span>.</span><span>bar</span></code></pre><p>Nextword</p>',quality:'partial'}));
  for(const q of ['OpenAI','foo.bar'])assert.equal((await search(q)).length,1,'inline markup preserves visible word continuity');
  assert.deepEqual(await search('barNextword'),[],'block boundaries separate words');
  assert.equal((await sql`SELECT body_text FROM articles WHERE id=${articleId}`)[0]!.body_text,'Historicalword');
  assert.deepEqual(await search('historicalword'),[]);assert.equal((await search('currentword 新内容')).length,1);
  await sql`UPDATE articles SET author='Renamed author' WHERE id=${articleId}`;
  assert.deepEqual(await search('currentword'),[],'metadata hash changes invalidate the old representation even at the same body revision');
  await sql.begin(tx=>captureStoredMaterial(tx,articleId));
  assert.equal((await search('currentword')).length,1,'recapturing the current metadata restores body search');
  const snapshot=(await currentSnapshot(articleId))!;assert(snapshot);assert.notEqual(snapshot.status,'complete');
  await sql`DELETE FROM reader_snapshots WHERE id=${snapshot.id}`;
  assert.deepEqual(await search('currentword'),[],'a historical snapshot cannot stand in for the missing current snapshot');
  assert.equal((await search('changing')).length,1,'metadata remains searchable without a saved current body');
});

test('keyword search combines five filters across batches and binds normalized words to pagination',async()=>{
  const headers=await ownerHeaders(),source='search-pages-'+tag(),category=await addCategory({name:'Search '+tag()},'test');
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Search pages','rss',ARRAY['MCP 与工具调用'])`;
  const rows=Array.from({length:125},(_,i)=>({id:source+'-'+String(i).padStart(3,'0'),source_id:source,identity_key:source+':'+i,url:`https://example.com/${source}/${i}`,title:i<3?'Needle match '+i:'Unrelated '+i,discovered_at:new Date('2026-10-28T00:00:00Z'),timeline_at:new Date('2026-10-28T00:00:00Z')}));
  await sql`INSERT INTO articles ${sql(rows)}`;
  await sql`INSERT INTO publications(article_id,source_id,title,url,channel,first_party,eligible,category,tags,visibility,timeline_at,sort_at,discovered_at) SELECT id,source_id,title,url,'news',true,true,${category.id},ARRAY['MCP 与工具调用'],'withdrawn',discovered_at,discovered_at,discovered_at FROM articles WHERE source_id=${source}`;
  await sql`INSERT INTO reader_state(article_id,starred,status) SELECT id,true,'read' FROM articles WHERE source_id=${source}`;
  await sql`UPDATE sources SET enabled=false WHERE id=${source}`;
  const query={sourceId:source,category:category.id,topic:'mcp-tool-use',starred:'true',status:'read',q:'needle',limit:'1'};
  const get=(q:Record<string,string>)=>app.inject({url:'/api/admin/reader/library?'+new URLSearchParams(q),headers});
  const ids:string[]=[];let cursor:string|null=null;
  do{const response=await get({...query,...(cursor?{cursor}:{})});assert.equal(response.statusCode,200,response.body);const data=response.json();ids.push(...data.items.map((a:{id:string})=>a.id));assert(data.items.every((a:{withdrawn:boolean})=>a.withdrawn));cursor=data.nextCursor;}while(cursor);
  assert.deepEqual(ids,rows.slice(0,3).map(a=>a.id).reverse(),'matches beyond the first100 candidates are all reached');
  const first=(await get(query)).json();assert.equal((await get({...query,q:'unrelated',cursor:first.nextCursor})).statusCode,400);
  assert.equal((await get({...query,q:'  NEEDLE  ',cursor:first.nextCursor})).statusCode,200,'equivalent normalized words keep their cursor');
  for(const patch of [{q:'x'.repeat(201)},{q:'a b c d e f g'},{q:'nul\0term'}])assert.equal((await get({...query,...patch})).statusCode,400);
  assert.equal((await app.inject({url:'/api/admin/reader/library?q=one&q=two',headers})).statusCode,400);
  assert.deepEqual((await get({...query,starred:'false'})).json().items,[]);
});

test('note review composes every library filter, previews saved text and pages at database precision',async()=>{
  const headers=await ownerHeaders(),source='note-review-'+tag(),category=await addCategory({name:'Review '+tag()},'test');
  await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Review source','rss')`;
  const rows=Array.from({length:105},(_,i)=>({id:source+'-'+String(i).padStart(3,'0'),source_id:source,identity_key:source+':'+i,url:`https://example.com/${source}/${i}`,title:'Review article '+i,discovered_at:new Date('2026-10-28T00:00:00Z'),timeline_at:new Date('2026-10-28T00:00:00Z')}));
  await sql`INSERT INTO articles ${sql(rows)}`;
  await sql`INSERT INTO publications(article_id,source_id,title,url,channel,first_party,eligible,category,tags,visibility,timeline_at,sort_at,discovered_at) SELECT id,source_id,title,url,'news',true,true,${category.id},ARRAY['MCP 与工具调用'],'withdrawn',discovered_at,discovered_at,discovered_at FROM articles WHERE source_id=${source}`;
  await sql`INSERT INTO reader_state(article_id,starred,status) SELECT id,true,'read' FROM articles WHERE source_id=${source}`;
  await sql`INSERT INTO reader_notes(article_id,text,updated_at) SELECT id,CASE WHEN right(id,3) IN ('000','001','002') THEN ${'Review-sentinel <script>saved</script> '+ '😀'.repeat(180)} ELSE 'Other saved text' END,'2026-10-28T12:00:00.123456Z'::timestamptz + right(id,3)::int * interval '1 microsecond' FROM articles WHERE source_id=${source}`;
  await sql`UPDATE reader_notes SET text=CASE right(article_id,3) WHEN '102' THEN '' ELSE E'\t\n　 ﻿' END WHERE article_id=ANY(${rows.slice(102,104).map(r=>r.id)}::text[])`;
  await sql`DELETE FROM reader_notes WHERE article_id=${rows[104]!.id}`;
  const query={sourceId:source,category:category.id,topic:'mcp-tool-use',starred:'true',status:'read',hasNote:'true',sort:'note-updated'},route='/api/admin/reader/library?';
  const get=(patch:Record<string,string>={})=>app.inject({url:route+new URLSearchParams({...query,...patch}),headers});
  const before=await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${rows.map(r=>r.id)}::text[]) ORDER BY article_id`;
  const first=await get({limit:'1'});assert.equal(first.statusCode,200,first.body);assert.equal(first.headers['cache-control'],'no-store');assert.equal(first.json().items[0].id,rows[101]!.id);
  for(const patch of [{hasNote:'false'},{sort:'collected'}] as Array<Record<string,string>>)assert.equal((await get({...patch,limit:'1',cursor:first.json().nextCursor})).statusCode,400);
  const readAll=async(extra:Record<string,string>)=>{const found:any[]=[];let cursor:string|null=null;do{const response=await get({...extra,...(cursor?{cursor}:{})});assert.equal(response.statusCode,200,response.body);const data=response.json();found.push(...data.items);cursor=data.nextCursor;assert(found.length<=105);}while(cursor);return found;};
  const all=await readAll({limit:'2'});assert.deepEqual(all.map(r=>r.id),rows.slice(0,102).reverse().map(r=>r.id));
  const matches=await readAll({q:'review-sentinel',limit:'1'});assert.deepEqual(matches.map(r=>r.id),rows.slice(0,3).reverse().map(r=>r.id),'keyword scanning reaches notes after the first100 candidates');
  assert(matches[0].note.snippet.startsWith('Review-sentinel <script>saved</script>'));assert([...matches[0].note.snippet].length<=160);assert.equal(matches[0].note.updatedAt,'2026-10-28T12:00:00.123Z');
  const absent=await readAll({hasNote:'false',limit:'1'});assert.deepEqual(absent.map(r=>r.id),rows.slice(102).reverse().map(r=>r.id));assert(absent.every(r=>r.note===null));
  const mixed=await readAll({hasNote:'false',sort:'collected',limit:'1'});assert.deepEqual(mixed.map(r=>r.id),absent.map(r=>r.id));
  for(const patch of [{hasNote:'yes'},{sort:'recent'}] as Array<Record<string,string>>)assert.equal((await get(patch)).statusCode,400);
  assert.deepEqual(await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${rows.map(r=>r.id)}::text[]) ORDER BY article_id`,before);
  assert(!(await app.inject('/api/site/items/'+rows[0]!.id)).body.includes('Review-sentinel'));
  const noFilter=await app.inject({url:route+new URLSearchParams({sourceId:source,sort:'note-updated',limit:'100'}),headers});const next=await app.inject({url:route+new URLSearchParams({sourceId:source,sort:'note-updated',limit:'100',cursor:noFilter.json().nextCursor}),headers});assert.deepEqual([...noFilter.json().items,...next.json().items].map(r=>r.id),[...rows.slice(0,102).reverse(),...rows.slice(102).reverse()].map(r=>r.id));
});

test('library date ranges include whole Beijing days and compose search, filters, sorting and precise pagination',async()=>{
  const headers=await ownerHeaders(),source='date-range-'+tag(),category=await addCategory({name:'Dates '+tag()},'test');
  await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Date source','rss')`;
  const times=['2024-02-28T15:59:59.999999Z','2024-02-28T16:00:00Z','2024-02-29T01:00:00Z','2024-02-29T15:59:59.999999Z','2024-02-29T16:00:00Z','2024-03-01T00:00:00Z','2024-03-02T00:00:00Z'];
  const ids=times.map((_,i)=>source+'-'+i);
  for(let i=0;i<ids.length;i++)await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES(${ids[i]!},${source},${ids[i]!},${'https://example.com/'+ids[i]},'Date-sentinel article',${times[i]!}::text::timestamptz,${times[i]!}::text::timestamptz)`;
  await sql`INSERT INTO publications(article_id,source_id,title,url,channel,first_party,eligible,category,tags,visibility,timeline_at,sort_at,discovered_at) SELECT id,source_id,title,url,'news',true,true,${category.id},ARRAY['MCP 与工具调用'],'public',discovered_at,discovered_at,discovered_at FROM articles WHERE source_id=${source}`;
  await sql`INSERT INTO reader_state(article_id,starred,status) SELECT id,true,'read' FROM articles WHERE source_id=${source}`;
  const noteTimes=[times[4]!,times[3]!,times[1]!,times[2]!,times[0]!,times[2]!];
  for(let i=0;i<noteTimes.length;i++)await sql`INSERT INTO reader_notes(article_id,text,updated_at) VALUES(${ids[i]!},${i===5?' \t\n\u3000\ufeff':'Saved date-sentinel note'},${noteTimes[i]!}::text::timestamptz)`;
  const query={sourceId:source,category:category.id,topic:'mcp-tool-use',starred:'true',status:'read',q:'date-sentinel',dateFrom:'2024-02-29',dateTo:'2024-02-29'};
  const get=(extra:Record<string,string>={})=>app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({...query,...extra}),headers});
  const protectedRows=async()=>({notes:await sql`SELECT * FROM reader_notes WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,states:await sql`SELECT * FROM reader_state WHERE article_id=ANY(${ids}::text[]) ORDER BY article_id`,articles:await sql`SELECT * FROM articles WHERE source_id=${source} ORDER BY id`,audits:await sql`SELECT * FROM audit_log ORDER BY id`}),before=await protectedRows();
  const readAll=async(extra:Record<string,string>={})=>{const found:string[]=[];let cursor:string|null=null;do{const result=await get({...extra,limit:'1',...(cursor?{cursor}:{})});assert.equal(result.statusCode,200,result.body);found.push(...result.json().items.map((item:{id:string})=>item.id));cursor=result.json().nextCursor;assert(found.length<=ids.length);}while(cursor);return found;};
  assert.deepEqual(await readAll(),[ids[3],ids[2],ids[1]]);
  assert.deepEqual(await readAll({dateField:'note-updated',hasNote:'true'}),[ids[3],ids[2],ids[1]]);
  assert.deepEqual(await readAll({dateField:'note-updated',sort:'note-updated'}),[ids[1],ids[3],ids[2]]);
  assert.deepEqual(await readAll({dateField:'note-updated',hasNote:'false'}),[]);
  const upper=(await get({dateField:'note-updated',dateFrom:''}));assert.equal(upper.statusCode,400,'empty API dates must be omitted, not interpreted as invalid timestamps');
  const oneSided=async(field:string,bound:Record<string,string>)=>{const result=await app.inject({url:'/api/admin/reader/library?'+new URLSearchParams({sourceId:source,dateField:field,...bound}),headers});assert.equal(result.statusCode,200,result.body);return result.json().items.map((item:{id:string})=>item.id);};
  assert.deepEqual(await oneSided('collected',{dateTo:'2024-02-29'}),[ids[3],ids[2],ids[1],ids[0]]);
  assert.deepEqual(await oneSided('collected',{dateFrom:'2024-03-01'}),[ids[6],ids[5],ids[4]]);
  assert.deepEqual(await oneSided('note-updated',{dateTo:'2024-02-29'}),[ids[4],ids[3],ids[2],ids[1]],'upper-only note dates exclude blank and missing notes');
  assert.deepEqual(await readAll({topic:'skills-extensions'}),[]);
  const first=await get({limit:'1'});assert(first.json().nextCursor);
  for(const patch of [{dateFrom:'2024-02-28'},{dateTo:'2024-03-01'},{dateField:'note-updated'}] as Record<string,string>[])assert.equal((await get({...patch,limit:'1',cursor:first.json().nextCursor})).statusCode,400);
  for(const patch of [{dateFrom:'2023-02-29'},{dateTo:'2024-02-30'},{dateFrom:'0000-01-01'},{dateFrom:'2024-2-29'},{dateTo:'2024-02-28'},{dateField:'published'},{dateFrom:'2024-02-29T00:00:00Z'}] as Record<string,string>[])assert.equal((await get(patch)).statusCode,400,JSON.stringify(patch));
  assert.equal((await app.inject('/api/admin/reader/library?dateFrom=2024-02-29')).statusCode,401);
  assert.deepEqual(await protectedRows(),before);
});

test('named views persist fixed date ranges and reject invalid replacements without changing the saved view',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/views',name='Fixed dates '+tag(),filters={q:'review',hasNote:'true',sort:'note-updated',dateField:'note-updated',dateFrom:'2024-02-29',dateTo:'2024-03-06'};
  const response=await app.inject({method:'POST',url:route,headers,payload:{name,filters}});assert.equal(response.statusCode,200,response.body);const saved=response.json();assert.deepEqual(saved.filters,filters);
  const update=(value:Record<string,string>,expectedVersion=1)=>app.inject({method:'PATCH',url:route+'/'+saved.id,headers,payload:{expectedVersion,filters:value}});
  for(const invalid of [{...filters,dateTo:'2024-02-28'},{...filters,dateFrom:'2023-02-29'},{...filters,dateField:'unknown'}])assert.equal((await update(invalid)).statusCode,400);
  assert.deepEqual((await app.inject({url:route+'/'+saved.id,headers})).json(),saved);
  const next=await update({...filters,dateField:'collected'});assert.equal(next.statusCode,200,next.body);assert.equal(next.json().version,2);assert.deepEqual(next.json().filters,{q:'review',hasNote:'true',sort:'note-updated',dateFrom:'2024-02-29',dateTo:'2024-03-06'});
  assert.equal((await update({...filters,dateField:'collected'},2)).json().version,2);
  const clear=await update({q:'review',dateField:'note-updated'},2);assert.equal(clear.statusCode,200,clear.body);assert.deepEqual(clear.json().filters,{q:'review'});
});

test('named note review views retain new conditions while legacy and default views stay stable',async()=>{
  const headers=await ownerHeaders(),route='/api/admin/reader/views',name='Note review '+tag();
  const create=async(filters:Record<string,string>)=>{const response=await app.inject({method:'POST',url:route,headers,payload:{name:name+tag(),filters}});assert.equal(response.statusCode,200,response.body);return response.json();};
  const legacy=await create({q:'legacy'}),review=await create({q:'note',hasNote:'true',sort:'note-updated'});assert.deepEqual(review.filters,{q:'note',hasNote:'true',sort:'note-updated'});
  const patch=(id:string,expectedVersion:number,filters:Record<string,string>)=>app.inject({method:'PATCH',url:route+'/'+id,headers,payload:{expectedVersion,filters}});
  const same=await patch(legacy.id,1,{q:'legacy',sort:'collected'});assert.equal(same.statusCode,200,same.body);assert.equal(same.json().version,1);assert.deepEqual(same.json().filters,{q:'legacy'});
  const changed=await patch(review.id,1,{q:'note',hasNote:'false',sort:'note-updated'});assert.equal(changed.statusCode,200,changed.body);assert.equal(changed.json().version,2);assert.equal(changed.json().filters.hasNote,'false');
  const sorted=await patch(review.id,2,{q:'note',hasNote:'false',sort:'collected'});assert.equal(sorted.json().version,3);assert.deepEqual(sorted.json().filters,{q:'note',hasNote:'false'});
  assert.deepEqual((await app.inject({url:route+'/'+legacy.id,headers})).json(),legacy);
});

test('collected-time keysets preserve microseconds in default and tied note sorting',async()=>{
  const headers=await ownerHeaders(),source='note-ties-'+tag();await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Precise source','rss')`;
  const rows=Array.from({length:6},(_,i)=>({id:source+'-'+i,source_id:source,identity_key:source+':'+i,url:`https://example.com/${source}/${i}`,title:'Precision article',discovered_at:new Date('2026-10-28T00:00:00Z'),timeline_at:new Date('2026-10-28T00:00:00Z')}));await sql`INSERT INTO articles ${sql(rows)}`;
  await sql`UPDATE articles SET discovered_at='2026-10-28T00:00:00.123456Z'::timestamptz+right(id,1)::int*interval '1 microsecond' WHERE source_id=${source}`;
  await sql`INSERT INTO reader_notes(article_id,text,updated_at) SELECT id,'Saved precision note','2026-10-28T12:00:00Z' FROM articles WHERE id=ANY(${rows.slice(0,3).map(r=>r.id)}::text[])`;
  for(const sort of ['collected','note-updated'])for(const q of ['', 'precision']){
    const ids:string[]=[];let cursor:string|null=null;do{const query=new URLSearchParams({sourceId:source,sort,limit:'1',...(q?{q}:{}),...(cursor?{cursor}:{})}),response=await app.inject({url:'/api/admin/reader/library?'+query,headers});assert.equal(response.statusCode,200,response.body);ids.push(...response.json().items.map((item:{id:string})=>item.id));cursor=response.json().nextCursor;assert(ids.length<=6);}while(cursor);
    assert.deepEqual(ids,(sort==='collected'?[...rows].reverse():[...rows.slice(0,3).reverse(),...rows.slice(3).reverse()]).map(r=>r.id));
  }
});

test("private library intersects five filters, keeps withdrawn/default-state articles and binds pagination",async()=>{
  const headers=await ownerHeaders(),source="library-"+tag(),other="other-"+tag();
  const category=await addCategory({name:"Library "+tag()},"test"),alternative=await addCategory({name:"Alternative "+tag()},"test");
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Library source','rss',ARRAY['MCP 与工具调用']),(${other},'Other source','rss',ARRAY['Skills 与扩展'])`;
  const ids:string[]=[];
  for(let i=0;i<5;i++){
    const id=(await upsertMaterial({sourceId:i===3?other:source,url:`https://example.com/${source}/${i}`,title:"Library "+i,via:"fetch"})).articleId;ids.push(id);
    if(i!==2)await overrideFields(id,{fields:{category:i===4?alternative.id:category.id},version:0,reason:"fixture"},"test");
    if(i<2)await sql`INSERT INTO reader_state(article_id,starred,status) VALUES(${id},true,'read')`;
  }
  await sql`UPDATE articles SET discovered_at='2026-10-28T00:00:00Z' WHERE source_id IN (${source},${other})`;
  await setVisibility(ids[1]!,{visibility:"withdrawn",version:1,reason:"private history"},"test");
  await sql`UPDATE sources SET enabled=false WHERE id=${source}`;
  const query=new URLSearchParams({sourceId:source,category:category.id,topic:"mcp-tool-use",starred:"true",status:"read",limit:"1"});
  const route="/api/admin/reader/library?";
  assert.equal((await app.inject(route+query)).statusCode,401);
  const get=(q:URLSearchParams)=>app.inject({url:route+q,headers});
  const response=await get(query);assert.equal(response.statusCode,200,response.body);
  const first=response.json();assert.equal(first.items.length,1);assert.ok(first.nextCursor);
  assert.ok(first.filters.sources.some((s:{id:string})=>s.id===source),"disabled sources retain their history filter");
  const second=await get(new URLSearchParams({...Object.fromEntries(query),cursor:first.nextCursor}));
  assert.equal(second.statusCode,200,second.body);
  assert.deepEqual([...first.items,...second.json().items].map(a=>a.id).sort(),ids.slice(0,2).sort());
  assert.ok([...first.items,...second.json().items].some(a=>a.withdrawn));assert.equal(second.json().nextCursor,null);
  for(const patch of [{sourceId:other},{category:alternative.id},{topic:"skills-extensions"},{starred:"false"},{status:"reading"},{limit:"2"}] as Array<Record<string,string>>){
    assert.equal((await get(new URLSearchParams({...Object.fromEntries(query),cursor:first.nextCursor,...patch}))).statusCode,400,"old cursor cannot change filters");
  }
  for(const patch of [{cursor:"broken"},{sourceId:"unknown-source"},{category:"unknown-category"},{topic:"unknown-topic"},{sourceId:""}] as Array<Record<string,string>>){
    assert.equal((await get(new URLSearchParams({...Object.fromEntries(query),...patch}))).statusCode,400);
  }
  assert.equal((await app.inject({url:route+`sourceId=${source}&sourceId=${other}`,headers})).statusCode,400);
  const defaults=await get(new URLSearchParams({sourceId:source,category:"uncategorized",starred:"false",status:"to-read"}));
  assert.equal(defaults.statusCode,200,defaults.body);
  assert.deepEqual(defaults.json().items.map((a:{id:string})=>a.id),[ids[2]]);
  assert.equal(defaults.json().items[0].state.version,0);
  await sql`DELETE FROM publications WHERE article_id=${ids[2]!}`;
  assert.deepEqual((await get(new URLSearchParams({sourceId:source,category:"uncategorized",starred:"false",status:"to-read"}))).json().items.map((a:{id:string})=>a.id),[ids[2]],"unpublished material remains in the private library");
  const empty=await get(new URLSearchParams({sourceId:source,category:category.id,topic:"skills-extensions"}));
  assert.deepEqual(empty.json().items,[]);
});

test("classification audit failure rolls back topic changes and the publication projection",async()=>{
  const headers=await ownerHeaders(),source="class-audit-"+tag();
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Audit source','rss',ARRAY['keep-tag'])`;
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/${source}`,title:"Classification rollback",via:"fetch"});
  const before=await sql`SELECT * FROM publications WHERE article_id=${articleId}`;
  await sql.unsafe(`CREATE FUNCTION refuse_reader_classification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject='content:${articleId}' THEN RAISE EXCEPTION 'classification audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER refuse_reader_classification_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_reader_classification_audit()");
  try{
    const response=await app.inject({method:"PATCH",url:`/api/admin/reader/articles/${articleId}/classification`,headers,payload:{expectedVersion:0,category:null,topicSlugs:["mcp-tool-use"]}});
    assert.equal(response.statusCode,500);
    assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${articleId}`).length,0);
    assert.deepEqual(await sql`SELECT * FROM publications WHERE article_id=${articleId}`,before);
  }finally{await sql.unsafe("DROP TRIGGER refuse_reader_classification_audit ON audit_log; DROP FUNCTION refuse_reader_classification_audit()");}
});

test("article topic selection preserves other tags and fields, supports clearing and shares classification CAS",async()=>{
  const headers=await ownerHeaders(),source="selection-"+tag();
  await sql`INSERT INTO sources(id,name,kind,tags,site_fulltext) VALUES(${source},'Selection source','rss',ARRAY['MCP 与工具调用','source-keep','entity:source'],false)`;
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/${source}`,title:"Original selection",bodyHtml:"<p>Original body</p>",bodyText:"Original body",bodyStatus:"ok",via:"fetch"});
  const base="/api/admin/reader/articles/"+articleId,route=base+"/classification";
  const category=await addCategory({name:"Selection "+tag()},"test");
  const original=await sql`SELECT * FROM articles WHERE id=${articleId}`;
  const snapshots=await sql`SELECT id,body_revision,representation_hash FROM reader_snapshots WHERE article_id=${articleId} ORDER BY id`;
  const initial=(await app.inject({url:base,headers})).json().article;
  assert.deepEqual(initial.topicSlugs,["mcp-tool-use"]);
  const payload={expectedVersion:0,category:category.id,topicSlugs:["skills-extensions","performance-cost"]};
  assert.equal((await app.inject({method:"PATCH",url:route,payload})).statusCode,401);
  assert.equal((await app.inject({method:"PATCH",url:route,headers:{cookie:headers.cookie},payload})).statusCode,403);
  const save=(body:Record<string,unknown>)=>app.inject({method:"PATCH",url:route,headers,payload:body});
  const saved=await save(payload);assert.equal(saved.statusCode,200,saved.body);
  assert.equal(saved.json().classificationVersion,1);
  assert.deepEqual(saved.json().topicSlugs.sort(),["performance-cost","skills-extensions"]);
  assert.deepEqual((await sql`SELECT tags FROM publications WHERE article_id=${articleId}`)[0]!.tags,["source-keep","entity:source","Skills 与扩展","性能与成本"]);
  await overrideFields(articleId,{fields:{title:"Keep title",summary:"Keep summary",tags:["manual-keep","entity:manual","MCP 与工具调用"]},version:1,reason:"manual fields"},"test");
  await setVisibility(articleId,{visibility:"withdrawn",version:2,reason:"keep withdrawal"},"test");
  const cleared=await save({expectedVersion:3,category:null,topicSlugs:[]});assert.equal(cleared.statusCode,200,cleared.body);
  assert.deepEqual(cleared.json().topicSlugs,[]);
  const [p]=await sql`SELECT title,summary,visibility,tags,category FROM publications WHERE article_id=${articleId}`;
  assert.deepEqual({...p},{title:"Keep title",summary:"Keep summary",visibility:"withdrawn",tags:["manual-keep","entity:manual"],category:null});
  assert.deepEqual(await sql`SELECT * FROM articles WHERE id=${articleId}`,original);
  assert.deepEqual(await sql`SELECT id,body_revision,representation_hash FROM reader_snapshots WHERE article_id=${articleId} ORDER BY id`,snapshots);
  await overrideFields(articleId,{fields:{tags:Array.from({length:20},(_,i)=>"keep-"+i)},version:4,reason:"full tag set"},"test");
  for(const body of [
    {expectedVersion:5,category:null,topicSlugs:["missing"]},
    {expectedVersion:5,category:null,topicSlugs:["mcp-tool-use","mcp-tool-use"]},
    {expectedVersion:5,category:null,topicSlugs:["skills-extensions"]},
    {expectedVersion:5,category:null,topicSlugs:[],tags:[]},
  ])assert.equal((await save(body)).statusCode,400);
  const concurrent=await Promise.all([save({expectedVersion:5,category:category.id,topicSlugs:[]}),save({expectedVersion:5,category:null,topicSlugs:[]})]);
  assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,409]);
  assert.equal((await app.inject({url:base,headers})).json().article.classificationVersion,6);
});

test("categories start with a placeholder and newly added categories can be assigned, filtered and renamed",async()=>{
  const initial=await app.inject("/api/site/categories");
  assert.equal(initial.statusCode,200);
  assert.deepEqual(initial.json().items.find((c:{id:string})=>c.id==="uncategorized"),{id:"uncategorized",name:"待分类",version:0});
  assert.equal((await app.inject({method:"POST",url:"/api/admin/categories",payload:{name:"工程实践"}})).statusCode,401);
  const {token}=await passwordLogin(config.adminPassword!,"/admin/reader","test");
  const cookie=`${SESSION_COOKIE}=${token}`,principal=(await sessionPrincipal(cookie))!;
  const headers={cookie,"x-csrf-token":principal.csrf};
  const added=await app.inject({method:"POST",url:"/api/admin/categories",headers,payload:{name:"工程实践"}});
  assert.equal(added.statusCode,200);
  const category=added.json();
  const {articleId}=await upsertMaterial({sourceId:"private-reader",title:"Categorized article",url:"https://example.com/category",via:"fetch"});
  await overrideFields(articleId,{fields:{category:category.id},reason:"classification",version:0},"test");
  const filtered=await app.inject(`/api/site/articles?category=${category.id}`);
  assert.deepEqual(filtered.json().items.map((x:{id:string})=>x.id),[articleId]);
  const rename=await app.inject({method:"PATCH",url:`/api/admin/categories/${category.id}`,headers,payload:{name:"工程方法",expectedVersion:1}});
  assert.equal(rename.statusCode,200);
  assert.equal((await app.inject("/api/site/categories")).json().items.find((x:{id:string})=>x.id===category.id).name,"工程方法");
  assert.equal((await app.inject({method:"PATCH",url:`/api/admin/categories/${category.id}`,headers,payload:{name:"old window",expectedVersion:1}})).statusCode,409);
  assert.equal((await app.inject("/api/site/articles?category=nonexistent")).statusCode,400);
});

test('private article reading selects the exact current representation while public fulltext stays off',async()=>{
  await sql`INSERT INTO sources(id,name,kind,site_fulltext) VALUES ('same-page-reader','Private source','rss',false)`;
  const material={sourceId:'same-page-reader',url:'https://example.com/same-page',title:'Same page',bodyText:'private-body-sentinel',bodyHtml:'<p>private-body-sentinel</p>',bodyStatus:'ok' as const,via:'fetch' as const};
  const {articleId}=await upsertMaterial(material);
  await upsertMaterial({...material,bodyHtml:'<p><strong>private-body-sentinel</strong></p>'});
  const route='/api/admin/reader/articles/'+articleId;
  assert.equal((await app.inject(route)).statusCode,401);
  const {token}=await passwordLogin(config.adminPassword!,'/admin/reader','test');
  const response=await app.inject({url:route,headers:{cookie:`${SESSION_COOKIE}=${token}`}});
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.json().currentSnapshot.bodyHtml, '<p><strong>private-body-sentinel</strong></p>');
  assert.ok(!(await app.inject('/api/site/items/'+articleId)).body.includes('private-body-sentinel'));
  await sql`UPDATE articles SET author='New unrecorded metadata' WHERE id=${articleId}`;
  assert.equal((await app.inject({url:route,headers:{cookie:`${SESSION_COOKIE}=${token}`}})).json().currentSnapshot,null,'never substitute an older unmatched snapshot');
});
