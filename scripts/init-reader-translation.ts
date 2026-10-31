// Explicit setup, separate from online schema migrations. Does not send model requests.
import {sql,closeDb} from '@agidawn/backend/db';
import {initializeTranslationBudget} from '../modules/reader/translation/model.ts';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--database'||!args[1])throw new Error('usage: node --env-file=.env scripts/init-reader-translation.ts --database <reader database>');
try{
  const [row]=await sql`SELECT current_database() AS name,to_regclass('reader_translations') AS translations`;
  if(row!.name!==args[1]||!row!.translations)throw new Error('Database name must match and reader translation migration must be applied');
  await initializeTranslationBudget();
  console.log(JSON.stringify({database:row!.name,budget:'llm',existingLimitsPreserved:true}));
}finally{await closeDb();}
