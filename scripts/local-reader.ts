// Linux user services for this worktree. systemd owns supervision and journal retention.
import {execFile} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {parseEnv,promisify} from 'node:util';
const run=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const loopback=new Set(['localhost','127.0.0.1','[::1]']);
const unitNames=['agi-dawn.target','agi-dawn-api.service','agi-dawn-web.service','agi-dawn-worker.service','agi-dawn-backup.service','agi-dawn-observe.service','agi-dawn-backup.timer','agi-dawn-observe.timer'];
export async function assertInstalledOwner(file:string,expectedRoot:string){
  const body=await readFile(file,'utf8');
  if(!body.startsWith(`# AGI黎明 local worktree: ${expectedRoot}\n`))throw new Error('已安装服务归属其他工作副本，拒绝操作');
}
export function assertLocalEnvironment(env:Record<string,string|undefined>){
  for(const key of ['SITE_URL','API_BASE_URL','DATABASE_URL']){
    let url:URL;try{url=new URL(env[key]??'');}catch{throw new Error(`${key} 必须配置为本机地址`);}
    if(!loopback.has(url.hostname))throw new Error(`${key} 必须使用本机地址`);
  }
}
const quote=(value:string)=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%')+'"';
interface UnitOptions {unitDir:string;root:string;node:string;searchPath:string}
export async function installLocalUnits(options:UnitOptions){
  const {unitDir,root,node,searchPath}=options;
  if([root,node,searchPath].some(value=>/[\r\n\0]/.test(value)))throw new Error('服务路径含不支持的控制字符');
  const owner=`# AGI黎明 local worktree: ${root}\n`;
  const command=(file:string,args:string[]=[])=>[node,'--env-file='+path.join(root,'.env'),file,...args].map(value=>quote(value.replace(/\$/g,()=> '$$'))).join(' ');
  const service=(title:string,file:string,args:string[]=[],once=false)=>`${owner}[Unit]\nDescription=AGI黎明 ${title}\nPartOf=agi-dawn.target\nStartLimitIntervalSec=0\n\n[Service]\nType=${once?'oneshot':'simple'}\nWorkingDirectory=${root.replace(/%/g,'%%')}\nEnvironment=${quote('PATH='+searchPath)}\nEnvironment=NODE_ENV=production API_HOST=127.0.0.1 WEB_HOST=127.0.0.1 FEISHU_INTERNAL_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false\nExecStart=${command(file,args)}\n${once?'':'Restart=on-failure\nRestartSec=5\n'}TimeoutStopSec=90\nUMask=0077\n`;
  const timer=(title:string,time:string)=>`${owner}[Unit]\nDescription=AGI黎明 ${title}\nPartOf=agi-dawn.target\n\n[Timer]\nOnCalendar=*-*-* ${time} Asia/Shanghai\nPersistent=true\n`;
  const units:Record<string,string>={
    'agi-dawn-api.service':service('API','apps/api/src/main.ts'),
    'agi-dawn-web.service':service('Web','apps/web/server.ts'),
    'agi-dawn-worker.service':service('Worker','apps/worker/src/main.ts'),
    'agi-dawn-backup.service':service('local backup','scripts/backup-reader.ts',['--local-only'],true),
    'agi-dawn-observe.service':service('observation','scripts/reader-status.ts',['--write'],true),
    'agi-dawn-backup.timer':timer('daily local backup','04:10:00'),
    'agi-dawn-observe.timer':timer('daily observation','20:00:00'),
    'agi-dawn.target':`${owner}[Unit]\nDescription=AGI黎明 local reader\nWants=agi-dawn-api.service agi-dawn-web.service agi-dawn-worker.service agi-dawn-backup.timer agi-dawn-observe.timer\n\n[Install]\nWantedBy=default.target\n`,
  };
  // Validate every existing unit before writing any of them.
  for(const name of Object.keys(units)){
    const previous=await readFile(path.join(unitDir,name),'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
    if(previous!==null&&!previous.startsWith(owner))throw new Error(`${name} 归属其他工作副本或服务，拒绝覆盖`);
  }
  await mkdir(unitDir,{recursive:true});
  for(const [name,body] of Object.entries(units))await writeFile(path.join(unitDir,name),body,{mode:0o600});
  return Object.keys(units).map(name=>path.join(unitDir,name));
}
async function main(){
  const action=process.argv[2];
  const ctl=async(...args:string[])=>{const result=await run('systemctl',['--user',...args]);if(result.stdout)process.stdout.write(result.stdout);};
  if(['start','stop','restart','status','logs'].includes(action??'')){
    const loaded=(await run('systemctl',['--user','show',...unitNames,'--property=FragmentPath','--value'])).stdout.split('\n').filter(Boolean);
    if(loaded.length!==unitNames.length)throw new Error('请先从本工作副本执行install');
    for(const file of loaded)await assertInstalledOwner(file,root);
  }
  if(action==='install'||action==='start'||action==='restart'){
    const env=parseEnv(await readFile(path.join(root,'.env'),'utf8'));assertLocalEnvironment(env);
    const [major,minor,patch]=process.versions.node.split('.').map(Number);
    if(major!<24||major===24&&(minor!<22||minor===22&&patch!<1))throw new Error('请使用Node24.22.1或更新版本');
  }
  if(action==='install'){
    const unitDir=path.join(process.env.XDG_CONFIG_HOME??path.join(homedir(),'.config'),'systemd/user');
    const files=await installLocalUnits({unitDir,root,node:process.execPath,searchPath:process.env.PATH??'/usr/bin:/bin'});
    await run('systemd-analyze',['--user','verify',...files]);await ctl('daemon-reload');console.log(`已安装 ${files.length} 个本机服务/定时器`);
  }else if(action==='start'){
    await run('docker',['start','article-reader-pg']);await ctl('enable','--now','agi-dawn.target');
  }else if(action==='restart'||action==='stop')await ctl(action,'agi-dawn.target');
  else if(action==='status')await ctl('show','agi-dawn-api.service','agi-dawn-web.service','agi-dawn-worker.service','agi-dawn-backup.timer','agi-dawn-observe.timer','--property=Id,ActiveState,SubState,MainPID,NRestarts,NextElapseUSecRealtime');
  else if(action==='logs'){const result=await run('journalctl',['--user','-u','agi-dawn-api','-u','agi-dawn-web','-u','agi-dawn-worker','-n','100','--no-pager']);process.stdout.write(result.stdout);}
  else throw new Error('用法: node scripts/local-reader.ts install|start|stop|restart|status|logs');
}
if(import.meta.main)main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'本机服务操作失败');process.exitCode=1;});
