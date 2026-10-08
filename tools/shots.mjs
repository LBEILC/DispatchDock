import { spawn } from 'node:child_process';
import electron from 'electron';
import { preferenceFixture } from './demo/preferences.mjs';
import path from 'node:path';
import { demo } from './demo/index.mjs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const fixture=await demo();
try {
  const out=path.resolve('app/dist/shots');
  const env={...await preferenceFixture(fixture.home),CODEX_DISPATCH_HOME:fixture.home,DISPATCHDOCK_SHOTS:out,DISPATCHDOCK_TEST_NODE:process.execPath};
  delete env.ELECTRON_RUN_AS_NODE;
  await unlink(path.join(out,'managed-exit-pending.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const child=spawn(electron,['.'],{env,stdio:'inherit',windowsHide:true,shell:false});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  if(code) process.exitCode=Number(code);
  else {
    const pending=JSON.parse(await readFile(path.join(out,'managed-exit-pending.json'),'utf8'));
    const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
    assert.equal(alive(pending.executor),true,'真实 Electron 退出后执行者仍存活');
    assert.equal(alive(pending.agent),true,'真实 Electron 退出后假 agent 仍存活');
    let end;
    for(let i=0;i<150;i++) {
      const text=await readFile(path.join(fixture.home,'runs.jsonl'),'utf8');
      const rows=text.slice(0,text.lastIndexOf('\n')).split('\n').filter(Boolean).map(JSON.parse);
      end=rows.find(r=>r.id===pending.id&&r.event==='end');
      if(end) { assert.equal(rows.filter(r=>r.id===pending.id&&r.event==='start').length,1);break; }
      await delay(100);
    }
    assert.equal(end?.exit,0,'真实软件退出后的任务正常结束');
    for(let i=0;i<50;i++) {
      const output=await readFile(path.join(fixture.home,'managed-exit-waiter.log'),'utf8');
      if(output.includes('exit=0 report=')) break;
      assert.ok(i<49,'等待者没有正常打印结束行');await delay(50);
    }
    await writeFile(path.join(out,'managed-exit.json'),JSON.stringify({platform:process.platform,appExit:0,executorAliveAfterAppExit:true,agentAliveAfterAppExit:true,taskExit:end.exit,waiterFinished:true},null,2));
    await unlink(path.join(out,'managed-exit-pending.json'));
    console.log('Windows 实测：真实 Electron 退出后，执行者与假 agent 仍存活，任务 end.exit=0，等待者正常结束。');
  }
} finally {await fixture.close();}
