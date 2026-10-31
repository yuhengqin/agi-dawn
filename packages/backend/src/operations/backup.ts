// Database and file backups: a verified custom-format dump plus the uploaded files, sent
// to the existing object store (Tencent COS through its S3-compatible API, AWS Signature V4) under
// daily/ (Sundays also weekly/, the 1st also monthly/). A few local copies are kept.
import { execFile } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat,readFile,writeFile,rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { beijingDate, beijingWeekday } from "@agidawn/contracts/time";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { screenshotsForwarded } from "./feedback.ts";
import {serverModules} from "../modules.ts";

const run = promisify(execFile);
const KEEP_LOCAL = 3;

interface Store {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  endpoint: string;
}

/** Backups run where the object store is configured (production); development never uploads. */
export function backupConfigured(): boolean {
  return store() !== null;
}

/** The object store, from the environment (backend.env); named one by one so the template check sees them. */
function store(): Store | null {
  const secretId = process.env.DB_BACKUP_STORE_SECRET_ID;
  const secretKey = process.env.DB_BACKUP_STORE_SECRET_KEY;
  const bucket = process.env.DB_BACKUP_STORE_BUCKET;
  const region = process.env.DB_BACKUP_STORE_REGION;
  if (!secretId || !secretKey || !bucket || !region) return null;
  const domain = process.env.DB_BACKUP_STORE_DOMAIN;
  return { secretId, secretKey, bucket, region, endpoint: domain ? `https://${domain.replace(/^https?:\/\//, "")}` : `https://${bucket}.cos.${region}.myqcloud.com` };
}

const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** AWS Signature V4 headers for one S3 request. */
function signV4(opts: {
  method: string; url: URL; region: string; accessKey: string; secretKey: string; payloadHash: string; headers?: Record<string, string>;
}): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const service = "s3";
  const headers: Record<string, string> = { ...(opts.headers ?? {}), host: opts.url.host, "x-amz-content-sha256": opts.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalQuery = [...opts.url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonicalPath = opts.url.pathname.split("/").map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
  const canonical = [opts.method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), opts.payloadHash].join("\n");
  const scope = `${day}/${opts.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${opts.secretKey}`, day), opts.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

async function fileSha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function upload(s: Store, key: string, file: string, sha: string, size: number) {
  const url = new URL(`${s.endpoint}/${key}`);
  const headers = signV4({ method: "PUT", url, region: s.region, accessKey: s.secretId, secretKey: s.secretKey, payloadHash: sha, headers: { "content-length": String(size), "content-type": "application/octet-stream" } });
  const res = await fetch(url, { method: "PUT", headers, body: createReadStream(file) as never, duplex: "half", signal: AbortSignal.timeout(60 * 60_000) } as RequestInit);
  if (!res.ok) throw new Error(`backup upload ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

export async function runBackup(now = new Date(),options:{localOnly?:boolean}={}) {
  const s = options.localOnly?null:store();
  const dir = path.join(config.dataDir, "backups");
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/\D/g, "")+"-"+randomUUID();
  // Named after the database ("news_db" → news-db-…), so two databases backed up into one store stay apart.
  const name = sql.options.database.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dump = path.join(dir, `${name}-${stamp}.dump`);
  // execFile includes argv in failures. Give libpq credentials through its environment so neither
  // process listings nor a failed job's stored error contain them; keep other connection options.
  const connection = new URL(config.databaseUrl);
  const env = { ...process.env,
    ...(connection.username ? { PGUSER: decodeURIComponent(connection.username) } : {}),
    ...(connection.password ? { PGPASSWORD: decodeURIComponent(connection.password) } : {}),
  };
  connection.username = connection.password = "";
  // libpq decodes percent escapes but not form-style '+'. Keep non-credential options byte-for-byte.
  connection.search = connection.search.slice(1).split("&").filter(option => {
    const separator = option.indexOf("=");
    const key = decodeURIComponent(option.slice(0, separator));
    if (key !== "user" && key !== "password") return true;
    env[key === "user" ? "PGUSER" : "PGPASSWORD"] = decodeURIComponent(option.slice(separator + 1));
    return false;
  }).join("&");
  await run("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--file", dump, connection.href], { env, maxBuffer: 16 * 1024 * 1024 });
  // Verify before shipping: the archive must list cleanly.
  await run("pg_restore", ["--list", dump], { maxBuffer: 64 * 1024 * 1024 });
  for(const module of serverModules())await module.backupVerify?.(config.dataDir);
  const files = path.join(dir, `${name}-files-${stamp}.tar.gz`);
  // An empty archive only when there is nothing to keep. A failure to read or pack existing files is
  // tried once more and otherwise reported: the database dump still ships, but the run fails.
  const kept: string[] = [];
  // Feedback screenshots only waiting to be forwarded are not kept (once forwarded, only the Feishu image
  // key remains). Without the internal chat they stay here for good, referred to as local: files.
  const roots=[...new Set([...(screenshotsForwarded()?["uploads"]:["uploads","feedback-screenshots"]),...serverModules().flatMap(module=>module.backupDirectories??[])])];
  for (const d of roots) {
    if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(d))throw new Error("invalid module backup directory");
    const info = await stat(path.join(config.dataDir, d)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) continue;
    if (!info.isDirectory()) throw new Error(`backup ${d} path is not a directory`);
    kept.push(d);
  }
  let filesError: string | null = null;
  const frozen:string[]=[];
  const walk=async(relative:string):Promise<void>=>{
    frozen.push(relative);
    const entries=await readdir(path.join(config.dataDir,relative),{withFileTypes:true});
    for(const entry of entries){
      if(entry.name.startsWith(".tmp-"))continue;
      const child=path.posix.join(relative,entry.name);
      if(entry.isSymbolicLink())throw new Error("backup cannot include a symbolic link: "+child);
      if(entry.isDirectory())await walk(child);else if(entry.isFile())frozen.push(child);else throw new Error("backup cannot include special file: "+child);
    }
  };
  for(const root of kept)await walk(root);
  const list=path.join(dir,`${name}-${stamp}.files-list`);
  await writeFile(list,frozen.length?frozen.join("\0")+"\0":"",{mode:0o600});
  try {
    const pack = () => run("tar", ["-czf", files, "-C", config.dataDir,"--null","--no-recursion","--files-from",list]);
    await pack().catch(() => pack()).catch((error: unknown) => {
      // tar's own words: the message starts with the whole command line, which can fill the excerpt.
      const stderr = (error as { stderr?: unknown })?.stderr;
      filesError = String(typeof stderr === "string" && stderr.trim() ? stderr.trim() : error instanceof Error ? error.message : error).slice(0, 300);
    });
  }finally{await rm(list,{force:true});}
  const out: Array<{ key: string; bytes: number; sha256: string }> = [];
  const today = beijingDate(now);
  const prefixes = ["daily"];
  if (beijingWeekday(today) === "星期日") prefixes.push("weekly");
  if (today.endsWith("-01")) prefixes.push("monthly");
  for (const file of filesError ? [dump] : [dump, files]) {
    const size = (await stat(file)).size;
    const sha = await fileSha256(file);
    for (const p of prefixes) {
      // One prefix per retention class (daily/, weekly/, monthly/): a store's lifecycle rules can expire
      // each on its own schedule.
      const key = `${p}/${path.basename(file)}`;
      if (s) await upload(s, key, file, sha, size);
      out.push({ key: s ? key : `local-only:${path.basename(file)}`, bytes: size, sha256: sha });
    }
  }
  let group:{manifest:string;dump:string;files:string}|undefined;
  const complete=!filesError&&!!(s||options.localOnly);
  if(complete){
    const manifest=path.join(dir,`${name}-group-${stamp}.json`);
    const artifacts=await Promise.all([dump,files].map(async file=>({file:path.basename(file),bytes:(await stat(file)).size,sha256:await fileSha256(file)})));
    const bytes=Buffer.from(JSON.stringify({formatVersion:1,at:now.toISOString(),complete:true,target:s?"object-store":"local-only",database:sql.options.database,artifacts},null,2));
    const pending=manifest+".pending";await writeFile(pending,bytes,{mode:0o600});
    if(s)for(const prefix of prefixes){const key=prefix+"/"+path.basename(manifest);await upload(s,key,pending,hex(bytes),bytes.length);out.push({key,bytes:bytes.length,sha256:hex(bytes)});}
    await rename(pending,manifest);group={manifest,dump,files};
    const groups=await Promise.all((await readdir(dir)).filter(file=>file.startsWith(name+"-group-")&&file.endsWith(".json")).map(async file=>({file,mtime:(await stat(path.join(dir,file))).mtimeMs})));
    groups.sort((a,b)=>b.mtime-a.mtime||b.file.localeCompare(a.file));
    for(const {file:old} of groups.slice(KEEP_LOCAL)){
      const record=JSON.parse(await readFile(path.join(dir,old),"utf8"));
      for(const artifact of record.artifacts){if(path.basename(artifact.file)!==artifact.file)throw new Error("invalid backup artifact path");await rm(path.join(dir,artifact.file),{force:true});}
      await rm(path.join(dir,old),{force:true});
    }
  }
  const summary = { at: now.toISOString(), uploaded: !!s && !filesError,complete,group,objects: out, ...(filesError ? { filesError } : {}) };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('backup.last', ${sql.json(summary as never)}, 'backup')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  if (!s&&!options.localOnly) throw new Error("backup made locally but not uploaded: object store credentials are not configured");
  if (filesError) throw new Error(`database backed up, but the file archive failed: ${filesError}`);
  return summary;
}
