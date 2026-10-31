import {verifyReaderArchive} from "../modules/reader/archive/verify.ts";
import {closeDb} from "@agidawn/backend/db";
const args=process.argv.slice(2),index=args.indexOf("--data-dir");
if(index<0||args.length!==2||!args[index+1])throw new Error("usage: node scripts/verify-reader-archive.ts --data-dir <restored directory>");
try{console.log(JSON.stringify(await verifyReaderArchive(args[index+1])));}finally{await closeDb();}
