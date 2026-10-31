// A local operational report. It never reads notes or returns article bodies.
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sql,closeDb} from '@agidawn/backend/db';
import {config} from '@agidawn/backend/config';
import {beijingDate} from '@agidawn/contracts/time';
import {currentSnapshot} from '../modules/reader/archive/snapshots.ts';

const reason=(message:string|null)=>{const status=message?.match(/HTTP (\d{3})/);return status?'HTTP '+status[1]:message?.includes('网络')?'网络请求失败':message?.includes('可靠正文')?'未取得可靠正文':'其他（见后台内容诊断）';};
export async function readerStatus(now=new Date(),startedAt=now){
  const sources=await sql<{id:string;name:string;enabled:boolean;health:string;intervalMinutes:number;lastFetchAt:Date|null;nextFetchAt:Date|null;articles:number;bodies:number;bodyPartial:number;bodyFailed:number;bodyRetrying:number}[]>`
    SELECT s.id,s.name,s.enabled,s.health,s.interval_minutes AS "intervalMinutes",s.last_fetch_at AS "lastFetchAt",s.next_fetch_at AS "nextFetchAt",
      count(a.id)::int AS articles,count(a.id) FILTER(WHERE a.body_status='ok')::int AS bodies,
      count(a.id) FILTER(WHERE a.body_status='ok' AND a.body_quality='partial')::int AS "bodyPartial",
      count(a.id) FILTER(WHERE a.processing_state='failed')::int AS "bodyFailed",
      count(a.id) FILTER(WHERE a.processing_state='new' AND a.processing_error IS NOT NULL)::int AS "bodyRetrying"
    FROM sources s LEFT JOIN articles a ON a.source_id=s.id GROUP BY s.id ORDER BY s.id`;
  const since=new Date(Math.max(startedAt.getTime(),now.getTime()-86400_000));
  const [fetches]=await sql`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE status='ok')::int AS ok,count(*) FILTER(WHERE status='failed')::int AS failed,coalesce(sum(new_count),0)::int AS created FROM fetch_runs WHERE started_at>=${since} AND started_at<=${now}`;
  const rows=await sql`SELECT id,source_id,processing_state,processing_error,processing_retry_at FROM articles WHERE processing_state='failed' OR processing_state='new' AND processing_error IS NOT NULL ORDER BY id LIMIT 200`;
  const failures=rows.map(row=>({articleId:row.id,sourceId:row.source_id,processingState:row.processing_state,retryAt:row.processing_retry_at,reason:reason(row.processing_error),diagnostic:'/admin/content/'+row.id}));
  const [assets]=await sql<{files:number;bytes:number}[]>`SELECT count(*)::int AS files,coalesce(sum(bytes),0)::float8 AS bytes FROM reader_assets`;
  const archives={complete:0,partial:0,pending:0,unmatched:0,failedImages:0,pendingImages:0};
  const articles=await sql`SELECT id FROM articles WHERE body_html IS NOT NULL AND body_revision IS NOT NULL ORDER BY id`;
  for(const article of articles){
    const snapshot=await currentSnapshot(article.id);
    if(!snapshot){archives.unmatched++;continue;}
    archives[snapshot.status]++;
    const [counts]=await sql`SELECT count(*) FILTER(WHERE status='failed')::int AS failed,count(*) FILTER(WHERE status='pending')::int AS pending FROM reader_snapshot_assets WHERE snapshot_id=${snapshot.id}`;
    archives.failedImages+=counts!.failed;archives.pendingImages+=counts!.pending;
  }
  const queues=await sql`SELECT name,state,count(*)::int AS count FROM pgboss.job WHERE state IN ('created','retry','active','failed') GROUP BY name,state ORDER BY name,state`;
  const elapsedHours=Math.max(0,(now.getTime()-startedAt.getTime())/3600_000);
  let backup:{at:string;target:string;manifest:string}|null=null;
  const backupDir=path.join(config.dataDir,'backups');
  for(const file of await readdir(backupDir).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;})){
    if(!file.includes('-group-')||!file.endsWith('.json'))continue;
    const value=JSON.parse(await readFile(path.join(backupDir,file),'utf8'));
    if(value.complete===true&&Number.isFinite(Date.parse(value.at))&&(!backup||value.at>backup.at))backup={at:value.at,target:value.target,manifest:file};
  }
  return {checkedAt:now.toISOString(),observation:{startedAt:startedAt.toISOString(),elapsedHours:Math.round(elapsedHours*100)/100,windowElapsed:elapsedHours>=168},sources,fetches:{since:since.toISOString(),...fetches},assets:assets!,archives,queues,failures,failureSampleLimit:200,backup};
}
async function main(){
  const dir=path.join(config.dataDir,'observation'),startFile=path.join(dir,'started.json');
  const write=process.argv.includes('--write');let startedAt=new Date();
  if(write){await mkdir(dir,{recursive:true});await writeFile(startFile,JSON.stringify({startedAt:startedAt.toISOString()}),{flag:'wx',mode:0o600}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='EEXIST')throw error;});}
  const saved=await readFile(startFile,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
  if(saved)startedAt=new Date(JSON.parse(saved).startedAt);
  const now=new Date(),report=await readerStatus(now,startedAt),body=JSON.stringify(report,null,2)+'\n';
  if(write){await writeFile(path.join(dir,beijingDate(now)+'.json'),body,{mode:0o600});await writeFile(path.join(dir,'latest.json'),body,{mode:0o600});}
  process.stdout.write(body);
}
if(import.meta.main)main().catch(()=>{console.error('本地观察报告生成失败，请检查数据库及备份清单；未输出私人数据。');process.exitCode=1;}).finally(closeDb);
