// Discovery failure modes, specified before the implementation:
// - news activity invents lastmod dates for static pages, while corrections keep an old report date;
// - existing stories, translations, report corrections, withdrawals and merges are never notified;
// - unreleased selections or non-editorial sources leak into search discovery;
// - more than 10,000 changes at one timestamp are skipped or permanently starve later URLs;
// - dry runs, HTTP failures or module read failures acknowledge URLs that were never submitted;
// - the sitemap's display limits are mistaken for a removal from the full discovery inventory.
import './setup.ts';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { upsertMaterial } from '@agidawn/backend/content/materials';
import { publishArticle } from '@agidawn/backend/publication/publish';
import { sql, closeDb } from '@agidawn/backend/db';
import { config } from '@agidawn/backend/config';
import { installModules, type SitemapEntry } from '@agidawn/backend/modules';
import { loadDiscoveryEntries } from '@agidawn/backend/publication/sitemap';
import { submitIndexNow } from '@agidawn/backend/operations/indexnow';

const originalFetch = globalThis.fetch;
const originalEnabled = config.indexNowSubmitEnabled;
const originalKey = config.indexNowKey;
after(closeDb);
afterEach(async () => {
  globalThis.fetch = originalFetch;
  config.indexNowSubmitEnabled = originalEnabled;
  config.indexNowKey = originalKey;
  installModules([]);
  await sql`DELETE FROM settings WHERE key = 'indexnow.watermark'`;
});

function capture(status = 200) {
  const batches: string[][] = [];
  config.indexNowSubmitEnabled = true;
  config.indexNowKey = '0123456789abcdef0123456789abcdef';
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.indexnow.org/indexnow');
    batches.push(JSON.parse(String(init?.body)).urlList);
    return new Response('', { status });
  };
  return batches;
}

async function material(id: string, options: { source?: string } = {}) {
  const source = options.source ?? 'discovery-editorial';
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${source},${source},'rss','T1',${source === 'discovery-signal' ? 'hot_signal' : 'editorial'}) ON CONFLICT DO NOTHING`;
  const result=await upsertMaterial({sourceId:source,url:`https://example.org/${id}`,title:'公开报道',publishedAt:new Date('2026-10-01'),via:'fetch'});
  await sql`UPDATE publications SET indexable=true WHERE article_id=${result.articleId}`;
  return result.articleId;
}

test('discovery dates follow page content and publication scope', async () => {
  const visible=await material('dates-visible');
  const signal=await material('dates-signal', { source: 'discovery-signal' });
  const entries = await loadDiscoveryEntries(new Date('2026-10-09'));
  for (const loc of ['/', '/explore', '/explore?view=sources', '/changelog']) {
    assert.ok(entries.some(e => e.loc === loc), `${loc} is discoverable`);
    assert.equal(entries.find(e => e.loc === loc)?.lastmod, undefined, `${loc} must not borrow the news clock`);
  }
  assert.ok(entries.some(e => e.loc === '/items/'+visible));
  assert.ok(!entries.some(e => e.loc === '/all'));
  assert.ok(!entries.some(e => e.loc === '/items/'+signal));
});

test('dry runs leave changes pending, corrections and disappeared URLs are submitted again', async () => {
  const articleId=await material('changed-reader-item');
  config.indexNowSubmitEnabled = false;
  globalThis.fetch = async () => { throw new Error('dry run made a network request'); };
  assert.equal((await submitIndexNow()).status, 'disabled');
  assert.equal((await sql`SELECT 1 FROM settings WHERE key='indexnow.watermark'`).length, 0);
  const batches = capture();
  assert.equal((await submitIndexNow()).status, 'sent');
  assert.ok(batches[0]!.some(url => url.endsWith(`/items/${articleId}`)));
  assert.equal((await submitIndexNow()).status, 'empty');
  await sql`UPDATE articles SET title='更正后的原始标题' WHERE id=${articleId}`;
  await publishArticle(articleId);
  await submitIndexNow();
  assert.ok(batches[1]!.some(url => url.endsWith(`/items/${articleId}`)), 'a corrected article is resubmitted');
  await sql`UPDATE publications SET visibility='withdrawn',indexable=false,updated_at=now() WHERE article_id=${articleId}`;
  await submitIndexNow();
  assert.ok(batches[2]!.some(url => url.endsWith(`/items/${articleId}`)), 'a withdrawn URL needs a recrawl');
  assert.equal((await submitIndexNow()).status, 'empty');
});

test('batches over the service limit make progress even when every change has the same timestamp', async () => {
  let entries: SitemapEntry[] = Array.from({ length: 10_005 }, (_, n) => ({ loc: `/bulk/${String(n).padStart(5, '0')}`, lastmod: new Date('2026-10-01') }));
  installModules([{ name: 'bulk', sitemap: { entries: async () => entries } }]);
  const batches = capture();
  const first = await submitIndexNow();
  assert.equal(first.urls, 10_000);
  assert.equal(first.more, true);
  const second = await submitIndexNow();
  assert.equal(second.more, false);
  assert.ok(second.urls > 0);
  const submitted = new Set(batches.flat());
  assert.equal([...submitted].filter(url => new URL(url).pathname.startsWith('/bulk/')).length, 10_005);
  assert.equal((await submitIndexNow()).status, 'empty');
  entries = entries.slice(1);
  await submitIndexNow();
  assert.ok(batches.at(-1)!.some(url => url.endsWith('/bulk/00000')));
});

test('failed requests and failed inventories never acknowledge a batch', async () => {
  capture(503);
  assert.equal((await submitIndexNow()).status, 'failed');
  assert.equal((await sql`SELECT 1 FROM settings WHERE key='indexnow.watermark'`).length, 0);
  globalThis.fetch = async () => { throw new Error('transport failed'); };
  await assert.rejects(submitIndexNow(), /transport failed/);
  assert.equal((await sql`SELECT 1 FROM settings WHERE key='indexnow.watermark'`).length, 0);
  const batches = capture(202);
  assert.equal((await submitIndexNow()).status, 'sent', 'accepted is a receipt, not proof of indexing');
  const [before] = await sql`SELECT value FROM settings WHERE key='indexnow.watermark'`;
  installModules([{ name: 'broken', sitemap: { entries: async () => { throw new Error('module read failed'); } } }]);
  await assert.rejects(submitIndexNow(), /module read failed/);
  const [after] = await sql`SELECT value FROM settings WHERE key='indexnow.watermark'`;
  assert.deepEqual(after!.value, before!.value);
  assert.equal(batches.length, 1);
});
