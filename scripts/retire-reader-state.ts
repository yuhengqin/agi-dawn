// Explicit maintenance for this reader deployment's new database, never a production AGIDawn upgrade.
import {sql,closeDb} from "@agidawn/backend/db";
import {audit} from "@agidawn/backend/audit";

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--database"||!args[1])throw new Error("usage: node scripts/retire-reader-state.ts --database <new reader database name>");
try {
  const [database]=await sql`SELECT current_database() AS name,to_regclass('analyses') AS old_analysis`;
  if(database!.name!==args[1]||database!.old_analysis)throw new Error("database name must match and reader retirement migrations must already be applied");
  // llm is retained for the reader's automatic body translations.
  const services=["embedding","zhipu","deepseek","dashscope","mimo"];
  const result=await sql.begin(async tx=>{
    const settings=await tx`DELETE FROM settings WHERE key LIKE 'models.%' OR key LIKE 'model.circuit.%'
      OR key=ANY(${services.map(service=>"provider.stop."+service)}::text[]) RETURNING key`;
    const budgets=await tx`DELETE FROM budgets WHERE service=ANY(${services}::text[]) RETURNING service`;
    const removed={settings:settings.map(row=>row.key),budgets:budgets.map(row=>row.service)};
    if(settings.length||budgets.length)await audit("reader-upgrade","reader.retire-state","database:"+database!.name,
      "已确认文章阅读站新库：清理退休模型配置与预算，保留付费回执历史",removed,{settings:0,budgets:0},{db:tx});
    return {settings:settings.length,budgets:budgets.length};
  });
  console.log(JSON.stringify(result));
} finally {await closeDb();}
