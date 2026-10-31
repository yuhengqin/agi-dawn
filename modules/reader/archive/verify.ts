import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {sql,type Db} from "@agidawn/backend/db";
import {config} from "@agidawn/backend/config";
import {assetFile} from "./assets.ts";
/** No physical GC: every ready reference, including history, must survive a paired restore. */
export async function verifyReaderArchive(dataDir=config.dataDir,db:Db=sql) {
  const rows=await db`SELECT DISTINCT a.* FROM reader_assets a JOIN reader_snapshot_assets sa ON sa.asset_hash=a.hash WHERE sa.status='ready'`;
  let bytes=0;
  for(const row of rows) {
    const file=assetFile(row.path,dataDir),info=await stat(file);
    if(info.size!==Number(row.bytes))throw new Error("archive image size mismatch: "+row.hash);
    const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);
    if(hash.digest("hex")!==row.hash)throw new Error("archive image checksum mismatch: "+row.hash);
    bytes+=Number(row.bytes);
  }
  return {assets:rows.length,bytes};
}
