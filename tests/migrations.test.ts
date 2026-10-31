// Exercise migration failures against PostgreSQL: bounded locks, atomic bookkeeping, and invalid indexes.
import "./setup.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "../scripts/migrate.ts";
import { renameReaderBrand } from "../scripts/rename-reader-brand.ts";
import { closeDb } from "@agidawn/backend/db";

const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const roots: string[] = [];
after(async () => { await db.end(); await other.end(); await closeDb(); for (const root of roots) rmSync(root, { recursive: true, force: true }); });

test("brand maintenance preserves source settings, previews safely and rejects conflicts atomically", async () => {
  const [{ name }] = await db`SELECT current_database() AS name`;
  const old = { initialBackfillLimit: 17, initialBackfillMonths: 3 };
  await db`INSERT INTO sources (id,name,kind,config) VALUES
    ('brand-old','Old','rss',${db.json({feedUrl:"https://example.org/feed",_legacy:old})}),
    ('brand-same','Same','rss',${db.json({_legacy:old,_agidawn:old})}),
    ('brand-new','New','rss',${db.json({_agidawn:{initialBackfillLimit:9}})})`;
  await assert.rejects(renameReaderBrand({database:name,from:"_agidawn",apply:true}), /source namespace must differ/);
  await assert.rejects(renameReaderBrand({database:"wrong_database",from:"_legacy",apply:true}), /database name must match/);
  assert.equal((await renameReaderBrand({database:name,from:"_legacy"})).changed, 2);
  assert.equal((await db`SELECT 1 FROM sources WHERE id='brand-old' AND config ? '_legacy'`).length, 1);
  await db`INSERT INTO sources (id,name,kind,config) VALUES ('brand-conflict','Conflict','rss',${db.json({_legacy:old,_agidawn:{initialBackfillLimit:4}})})`;
  await assert.rejects(renameReaderBrand({database:name,from:"_legacy",apply:true}), /brand-conflict/);
  assert.equal((await db`SELECT 1 FROM sources WHERE id='brand-old' AND config ? '_legacy'`).length, 1);
  await db`DELETE FROM sources WHERE id='brand-conflict'`;
  assert.equal((await renameReaderBrand({database:name,from:"_legacy",apply:true})).changed, 2);
  assert.deepEqual((await db`SELECT config FROM sources WHERE id='brand-old'`)[0].config, {feedUrl:"https://example.org/feed",_agidawn:old});
  assert.deepEqual((await db`SELECT config FROM sources WHERE id='brand-same'`)[0].config, {_agidawn:old});
  assert.deepEqual((await db`SELECT config FROM sources WHERE id='brand-new'`)[0].config, {_agidawn:{initialBackfillLimit:9}});
  assert.equal((await renameReaderBrand({database:name,from:"_legacy",apply:true})).changed, 0);
  assert.equal((await db`SELECT 1 FROM audit_log WHERE action='reader.rename-brand'`).length, 2);
});

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "migrations-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

test("unsafe later files and duplicate module names fail before any change", async () => {
  await assert.rejects(runMigrations(db, fixture({
    "database/migrations/9000_first.sql": "CREATE TABLE migration_never_created (id int);",
    "modules/example/migrations/9001_unsafe.sql": "UPDATE articles SET title = 'bad';",
  })), /9001_unsafe/);
  assert.equal((await db`SELECT to_regclass('migration_never_created') AS name`)[0].name, null);
  await assert.rejects(runMigrations(db, fixture({
    "database/migrations/9000_duplicate.sql": "CREATE TABLE migration_never_created (id int);",
    "modules/example/migrations/9000_duplicate.sql": "CREATE TABLE another_never_created (id int);",
  })), /two migrations/);
});

test("an interrupted historical multi-statement transaction never commits its schema or ledger entry", async () => {
  await assert.rejects(runMigrations(db, fixture({
    "database/migrations/0051_atomic.sql": "CREATE TABLE migration_rolled_back (id int); ALTER TABLE migration_missing ADD COLUMN flag text;",
  })), /0051_atomic/);
  assert.equal((await db`SELECT to_regclass('migration_rolled_back') AS name`)[0].name, null);
  assert.equal((await db`SELECT 1 FROM schema_migrations WHERE name = '0051_atomic.sql'`).length, 0);
});

test("a busy table aborts the migration promptly and leaves the serving schema alone", async () => {
  await db`CREATE TABLE migration_locked (id int)`;
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const blocker = other.begin(async (tx) => {
    await tx`LOCK TABLE migration_locked IN ACCESS SHARE MODE`;
    acquired();
    await hold;
  });
  await ready;
  const start = Date.now();
  try {
    await assert.rejects(runMigrations(db, fixture({
      "database/migrations/9003_lock.sql": "ALTER TABLE migration_locked ADD COLUMN flag text;",
    })), /9003_lock.*lock timeout/s);
    assert.ok(Date.now() - start < 4000, "DDL must not queue behind a long read for the HTTP timeout");
  } finally { release(); await blocker; }
  assert.equal((await db`SELECT 1 FROM information_schema.columns WHERE table_name = 'migration_locked' AND column_name = 'flag'`).length, 0);
  assert.equal((await db`SELECT 1 FROM schema_migrations WHERE name = '9003_lock.sql'`).length, 0);
});

/** A connection named the way pg_dump names itself, holding what a running dump holds: a snapshot and ACCESS SHARE on the table. */
async function runningDump(table: string) {
  const dump = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {}, connection: { application_name: "pg_dump" } });
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const held = dump.begin("ISOLATION LEVEL REPEATABLE READ", async (tx) => {
    await tx`LOCK TABLE ${tx(table)} IN ACCESS SHARE MODE`;
    acquired();
    await hold;
  });
  await ready;
  return { release, done: held.finally(() => dump.end()) };
}

test("a running backup dump is waited out instead of failing the release, for column and index changes", async () => {
  await db`CREATE TABLE migration_dumped (id int)`;
  const dump = await runningDump("migration_dumped");
  const finished = setTimeout(dump.release, 1500);
  try {
    assert.equal(await runMigrations(db, fixture({
      "database/migrations/9008_dumped_column.sql": "ALTER TABLE migration_dumped ADD COLUMN flag text;",
      "database/migrations/9009_dumped_index.sql": "CREATE INDEX CONCURRENTLY IF NOT EXISTS migration_dumped_idx ON migration_dumped (id);",
    }), { backupWaitMs: 10_000 }), 2);
  } finally { clearTimeout(finished); dump.release(); await dump.done; }
  assert.equal((await db`SELECT 1 FROM information_schema.columns WHERE table_name = 'migration_dumped' AND column_name = 'flag'`).length, 1);
  assert.equal((await db`SELECT indisvalid FROM pg_index WHERE indexrelid = 'migration_dumped_idx'::regclass`)[0].indisvalid, true);
});

test("a backup dump running past the wait fails the release before touching the schema", async () => {
  await db`CREATE TABLE migration_dump_stuck (id int)`;
  const dump = await runningDump("migration_dump_stuck");
  const start = Date.now();
  try {
    await assert.rejects(runMigrations(db, fixture({
      "database/migrations/9010_dump_stuck.sql": "ALTER TABLE migration_dump_stuck ADD COLUMN flag text;",
    }), { backupWaitMs: 1500 }), /9010_dump_stuck.*pg_dump/s);
    assert.ok(Date.now() - start < 6000, "the wait is bounded");
  } finally { dump.release(); await dump.done; }
  assert.equal((await db`SELECT 1 FROM information_schema.columns WHERE table_name = 'migration_dump_stuck' AND column_name = 'flag'`).length, 0);
  assert.equal((await db`SELECT 1 FROM schema_migrations WHERE name = '9010_dump_stuck.sql'`).length, 0);
});

test("concurrent module indexes apply and resume safely when only bookkeeping was interrupted", async () => {
  await db`CREATE TABLE migration_indexed (id int)`;
  await db`INSERT INTO migration_indexed VALUES (1), (2)`;
  await db`CREATE INDEX CONCURRENTLY migration_idx ON migration_indexed (id)`;
  const root = fixture({
    "modules/example/migrations/9004_index.sql": "CREATE INDEX CONCURRENTLY IF NOT EXISTS migration_idx ON migration_indexed (id);",
    "database/migrations/9005_column.sql": "ALTER TABLE migration_indexed ADD COLUMN flag boolean NOT NULL DEFAULT false;",
  });
  assert.equal(await runMigrations(db, root), 2);
  assert.equal(await runMigrations(db, root), 0);
  assert.equal((await db`SELECT indisvalid FROM pg_index WHERE indexrelid = 'migration_idx'::regclass`)[0].indisvalid, true);
  assert.equal((await db`SELECT flag FROM migration_indexed LIMIT 1`)[0].flag, false);
});

test("IF NOT EXISTS must not turn an invalid or wrong-table index into a successful migration", async () => {
  await db`CREATE TABLE migration_invalid (id int)`;
  await db`INSERT INTO migration_invalid VALUES (1), (1)`;
  await assert.rejects(db`CREATE UNIQUE INDEX CONCURRENTLY migration_invalid_idx ON migration_invalid (id)`);
  await assert.rejects(runMigrations(db, fixture({
    "database/migrations/9006_invalid.sql": "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS migration_invalid_idx ON migration_invalid (id);",
  })), /invalid.*DROP INDEX CONCURRENTLY/s);
  await assert.rejects(runMigrations(db, fixture({
    "database/migrations/9007_wrong_table.sql": "CREATE INDEX CONCURRENTLY IF NOT EXISTS migration_idx ON migration_invalid (id);",
  })), /different table/);
  assert.equal((await db`SELECT 1 FROM schema_migrations WHERE name IN ('9006_invalid.sql', '9007_wrong_table.sql')`).length, 0);
});
