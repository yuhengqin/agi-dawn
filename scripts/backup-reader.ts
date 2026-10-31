import {installModules} from "@agidawn/backend/modules";
import {SERVER_MODULES} from "@agidawn/site/modules/server";
import {runBackup} from "@agidawn/backend/operations/backup";
import {closeDb} from "@agidawn/backend/db";
if(process.argv.slice(2).some(value=>value!=="--local-only"))throw new Error("usage: node scripts/backup-reader.ts [--local-only]");
installModules(SERVER_MODULES);
try{console.log(JSON.stringify(await runBackup(new Date(),{localOnly:process.argv.includes("--local-only")})));}finally{await closeDb();}
