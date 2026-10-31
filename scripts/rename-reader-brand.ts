// Explicit maintenance for stored source settings; historical article payloads stay unchanged.
import { parseArgs } from "node:util";
import { sql, closeDb } from "@agidawn/backend/db";
import { audit } from "@agidawn/backend/audit";

export async function renameReaderBrand(options: { database: string; from: string; apply?: boolean }) {
  if (!options.from || options.from === "_agidawn") throw new Error("source namespace must differ from _agidawn");
  const apply = options.apply === true;
  return sql.begin(apply ? "" : "read only", async tx => {
    const [database] = await tx`SELECT current_database() AS name`;
    if (database!.name !== options.database) throw new Error("database name must match --database");
    // Lock the rows used for the audit's before/after pair, so an admin edit cannot be overwritten.
    const rows = await tx<{ id: string; config: Record<string, unknown>; conflict: boolean }[]>`
      SELECT id,config,config ? '_agidawn' AND config->'_agidawn' IS DISTINCT FROM config->${options.from} AS conflict
      FROM sources WHERE config ? ${options.from} ORDER BY id ${apply ? tx`FOR UPDATE` : tx``}`;
    const conflicts = rows.filter(row => row.conflict).map(row => row.id);
    if (conflicts.length) throw new Error("conflicting source settings: " + conflicts.join(", "));
    if (apply) for (const row of rows) {
      const after: Record<string, unknown> = { ...row.config, _agidawn: row.config[options.from] };
      delete after[options.from];
      await tx`UPDATE sources SET config=${tx.json(after as never)},updated_at=now() WHERE id=${row.id}`;
      await audit("reader-upgrade", "reader.rename-brand", "source:" + row.id,
        "来源配置命名空间迁移为 _agidawn，保留配置值", row.config, after, { db: tx });
    }
    return { applied: apply, changed: rows.length };
  });
}

async function main() {
  const { values } = parseArgs({ options: { database: { type: "string" }, from: { type: "string" }, apply: { type: "boolean", default: false } }, strict: true, allowPositionals: false });
  if (!values.database || !values.from) throw new Error("用法：node --env-file=.env scripts/rename-reader-brand.ts --database reader_dev --from <旧配置命名空间> [--apply]");
  try { console.log(JSON.stringify(await renameReaderBrand({ database: values.database, from: values.from, apply: values.apply }))); }
  finally { await closeDb(); }
}
if (import.meta.main) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "品牌字段迁移失败"); process.exitCode = 1; });
