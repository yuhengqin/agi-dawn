import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertLocalEnvironment,installLocalUnits,assertInstalledOwner} from '../scripts/local-reader.ts';

test('local services reject public addresses before installation',()=>{
  const env={SITE_URL:'http://localhost:3000',API_BASE_URL:'http://127.0.0.1:3001',DATABASE_URL:'postgres://127.0.0.1:55432/reader_dev'};
  assert.doesNotThrow(()=>assertLocalEnvironment(env));
  for(const key of Object.keys(env))assert.throws(()=>assertLocalEnvironment({...env,[key]:'http://example.com'}),/本机/);
});
test('generated Linux units are accepted by the installed systemd with a space in the worktree path',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader units '));
  try{
    const files=await installLocalUnits({unitDir:path.join(dir,'units'),root:dir,node:process.execPath,searchPath:'/usr/bin:/bin'});
    await promisify(execFile)('systemd-analyze',['--user','verify',...files]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('installation refuses another worktree without modifying any unit',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-units-'));
  try{
    await writeFile(path.join(dir,'agi-dawn-worker.service'),'# another service\n');
    await assert.rejects(installLocalUnits({unitDir:dir,root:'/tmp/current reader',node:process.execPath,searchPath:'/usr/bin'}),/归属/);
    assert.equal(await readFile(path.join(dir,'agi-dawn-worker.service'),'utf8'),'# another service\n');
    await assert.rejects(readFile(path.join(dir,'agi-dawn-api.service')),/ENOENT/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('service control rejects an installed unit belonging to another worktree',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-control-'));
  try{
    const file=path.join(dir,'agi-dawn.target');await writeFile(file,'# AGI黎明 local worktree: /tmp/other\n[Unit]\n');
    await assert.rejects(assertInstalledOwner(file,'/tmp/current'),/归属/);
    await assert.doesNotReject(assertInstalledOwner(file,'/tmp/other'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
