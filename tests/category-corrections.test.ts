import {tag} from "./setup.ts";
import assert from "node:assert/strict";
import {after,test} from "node:test";
import {sql,closeDb} from "@agidawn/backend/db";
import {addCategory,renameCategory} from "@agidawn/backend/admin/categories";
import {listCategories} from "@agidawn/backend/publication/categories";
import {overrideFields} from "@agidawn/backend/admin/content";
import {upsertMaterial} from "@agidawn/backend/content/materials";
import {loadReaderList} from "@agidawn/backend/publication/pool";
import {listTopicSummaries} from "@agidawn/backend/publication/topics";
import {setVisibility} from "@agidawn/backend/admin/content";
import {applyReaderTaxonomy} from "../scripts/apply-reader-taxonomy.ts";
after(closeDb);
test("placeholder categories can be extended, renamed with CAS and assigned without changing article identity",async()=>{
  assert.ok((await listCategories()).some(c=>c.id==="uncategorized"&&c.name==="待分类"));
  const category=await addCategory({name:"Example "+tag()},"test"),source=tag();
  await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Category source','rss')`;
  const {articleId}=await upsertMaterial({sourceId:source,url:"https://example.org/"+source,title:"Categorized material",via:"fetch"});
  await overrideFields(articleId,{fields:{category:category.id},version:0,reason:"organize"},"test");
  assert.deepEqual((await loadReaderList({sourceId:source,category:category.id})).items.map(i=>i.id),[articleId]);
  await renameCategory(category.id,{name:"Renamed",expectedVersion:category.version},"test");
  await assert.rejects(renameCategory(category.id,{name:"Stale",expectedVersion:category.version},"test"),{code:"conflict"});
  await overrideFields(articleId,{fields:{category:null},version:1,reason:"uncategorize"},"test");
  assert.equal((await loadReaderList({sourceId:source,category:category.id})).items.length,0);
  assert.deepEqual((await loadReaderList({sourceId:source,category:"uncategorized"})).items.map(i=>i.id),[articleId]);
});

async function taxonomyFixture(){
  const source="taxonomy-"+tag(),name="Taxonomy "+tag();
  await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${source},'Taxonomy fixture','rss',ARRAY['inherited','entity:source'])`;
  const articles=[];
  for(let i=0;i<2;i++){
    const url=`https://example.org/${source}/${i}`;
    const {articleId}=await upsertMaterial({sourceId:source,url,title:"Retained original",bodyText:"Original body",bodyHtml:"<p>Original body</p>",bodyStatus:"ok",via:"fetch"});
    articles.push({id:articleId,url,sourceId:source,category:"agents",topics:i===0?["mcp-tool-use"]:["performance-cost"],provisional:i===1});
  }
  const [db]=await sql`SELECT current_database() AS name`;
  return {source,name,articles,database:db!.name as string,batch:{snapshotAt:"2026-10-27T22:17:57.628Z",categories:[{key:"agents",name}],articles:articles.map(({id,...article})=>article)}};
}

test("taxonomy preview is read only; application preserves manual fields, inherited and hidden tags and withdrawal",async()=>{
  const f=await taxonomyFixture(),first=f.articles[0]!;
  await overrideFields(first.id,{fields:{title:"Keep manual title",tags:["manual","entity:manual"]},version:0,reason:"manual"},"test");
  await setVisibility(first.id,{visibility:"withdrawn",version:1,reason:"keep withdrawn"},"test");
  const before=await sql`SELECT id,revision,body_revision,body_text,body_html FROM articles WHERE source_id=${f.source} ORDER BY id`;
  const revisionsBefore=await sql`SELECT * FROM article_revisions WHERE article_id=ANY(${f.articles.map(a=>a.id)}::text[]) ORDER BY article_id,revision`;
  const [auditsBefore]=await sql`SELECT count(*)::int AS n FROM audit_log`;
  const preview=await applyReaderTaxonomy(f.batch,{database:f.database});
  assert.equal(preview.changed,2);
  assert.equal(preview.applied,false);
  assert.equal((await sql`SELECT 1 FROM article_categories WHERE name=${f.name}`).length,0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log`)[0]!.n,auditsBefore!.n);
  const result=await applyReaderTaxonomy(f.batch,{database:f.database,apply:true});
  assert.equal(result.changed,2);
  const [category]=await sql`SELECT id FROM article_categories WHERE name=${f.name}`;
  const [p]=await sql`SELECT title,visibility,tags,category FROM publications WHERE article_id=${first.id}`;
  assert.equal(p!.title,"Keep manual title");assert.equal(p!.visibility,"withdrawn");assert.equal(p!.category,category!.id);
  assert.deepEqual(p!.tags,["manual","entity:manual","MCP 与工具调用"]);
  const second=f.articles[1]!;
  assert.deepEqual((await sql`SELECT tags FROM publications WHERE article_id=${second.id}`)[0]!.tags,["inherited","entity:source","性能与成本"]);
  assert.deepEqual((await loadReaderList({sourceId:f.source,category:category!.id,topic:"performance-cost"})).items.map(a=>a.id),[second.id]);
  assert.equal((await loadReaderList({sourceId:f.source,topic:"mcp-tool-use"})).items.length,0,"withdrawn material stays absent");
  assert.equal((await listTopicSummaries()).topics.find(t=>t.slug==="performance-cost")!.total,1);
  assert.deepEqual(await sql`SELECT id,revision,body_revision,body_text,body_html FROM articles WHERE source_id=${f.source} ORDER BY id`,before);
  assert.deepEqual(await sql`SELECT * FROM article_revisions WHERE article_id=ANY(${f.articles.map(a=>a.id)}::text[]) ORDER BY article_id,revision`,revisionsBefore);
  const [auditsApplied]=await sql`SELECT count(*)::int AS n FROM audit_log`;
  assert.equal((await applyReaderTaxonomy(f.batch,{database:f.database,apply:true})).changed,0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log`)[0]!.n,auditsApplied!.n);
});

test("taxonomy rejects invalid references, missing targets and incorrect database before any writes",async()=>{
  const f=await taxonomyFixture();
  await assert.rejects(applyReaderTaxonomy(f.batch,{database:"wrong_test",apply:true}),/database/i);
  await assert.rejects(applyReaderTaxonomy({...f.batch,articles:[{...f.batch.articles[0],topics:["missing-topic"]}]},{database:f.database,apply:true}),/主题/);
  await assert.rejects(applyReaderTaxonomy({...f.batch,articles:[{...f.batch.articles[0],url:"https://example.org/missing"}]},{database:f.database,apply:true}),/文章/);
  await assert.rejects(applyReaderTaxonomy({...f.batch,articles:[f.batch.articles[0],f.batch.articles[0]]},{database:f.database,apply:true}),/重复/);
  assert.equal((await sql`SELECT 1 FROM article_categories WHERE name=${f.name}`).length,0);
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=ANY(${f.articles.map(a=>a.id)}::text[])`).length,0);
});

test("taxonomy refuses an existing category conflict or tag overflow instead of replacing operator choices",async()=>{
  const f=await taxonomyFixture(),other=await addCategory({name:"Other "+tag()},"test");
  await overrideFields(f.articles[0]!.id,{fields:{category:other.id},version:0,reason:"already classified"},"test");
  await assert.rejects(applyReaderTaxonomy(f.batch,{database:f.database,apply:true}),/已有分类/);
  assert.equal((await sql`SELECT 1 FROM article_categories WHERE name=${f.name}`).length,0);
  const g=await taxonomyFixture();
  await overrideFields(g.articles[1]!.id,{fields:{tags:Array.from({length:20},(_,i)=>"keep-"+i)},version:0,reason:"keep tags"},"test");
  await assert.rejects(applyReaderTaxonomy(g.batch,{database:g.database,apply:true}),/20/);
  assert.equal((await sql`SELECT 1 FROM article_categories WHERE name=${g.name}`).length,0);
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${g.articles[0]!.id}`).length,0);
});

test("a later taxonomy audit failure rolls back categories, earlier articles and publication changes",async()=>{
  const f=await taxonomyFixture(),last=[...f.articles].sort((a,b)=>a.id.localeCompare(b.id)).at(-1)!;
  const before=await sql`SELECT article_id,category,tags,revision FROM publications WHERE source_id=${f.source} ORDER BY article_id`;
  const [auditsBefore]=await sql`SELECT count(*)::int AS n FROM audit_log`;
  await sql.unsafe(`CREATE FUNCTION refuse_taxonomy_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.subject = 'content:${last.id}' AND NEW.actor = 'reader-taxonomy' THEN RAISE EXCEPTION 'taxonomy audit unavailable'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER refuse_taxonomy_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_taxonomy_audit()");
  try{
    await assert.rejects(applyReaderTaxonomy(f.batch,{database:f.database,apply:true}),/taxonomy audit unavailable/);
    assert.equal((await sql`SELECT 1 FROM article_categories WHERE name=${f.name}`).length,0);
    assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=ANY(${f.articles.map(a=>a.id)}::text[])`).length,0);
    assert.deepEqual(await sql`SELECT article_id,category,tags,revision FROM publications WHERE source_id=${f.source} ORDER BY article_id`,before);
    assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log`)[0]!.n,auditsBefore!.n);
  }finally{await sql.unsafe("DROP TRIGGER refuse_taxonomy_audit ON audit_log; DROP FUNCTION refuse_taxonomy_audit()");}
});

test("taxonomy rolls back if pending source changes would alter publication visibility",async()=>{
  const f=await taxonomyFixture();
  // Source participation changes are republished asynchronously; keep the old projection here.
  await sql`UPDATE sources SET participation_mode='isolated' WHERE id=${f.source}`;
  await assert.rejects(applyReaderTaxonomy(f.batch,{database:f.database,apply:true}),/可见性/);
  assert.equal((await sql`SELECT 1 FROM article_categories WHERE name=${f.name}`).length,0);
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=ANY(${f.articles.map(a=>a.id)}::text[])`).length,0);
  assert.deepEqual((await sql`SELECT DISTINCT visibility FROM publications WHERE source_id=${f.source}`).map(p=>p.visibility),["public"]);
});
