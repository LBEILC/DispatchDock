import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopTask } from '../skills/codex-dispatch/lib/stop.mjs';
import { registryWriter } from '../skills/codex-dispatch/lib/records.mjs';
import { killProcessTree } from '../skills/codex-dispatch/lib/process.mjs';
const script = new URL('../skills/codex-dispatch/codex-task.mjs', import.meta.url);
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'dispatchdock-stop-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const record = registryWriter(home), file = join(home, 'runs.jsonl');
  return { home, file, record, start: { event:'start', id:'sample', repo:home, name:'中文 空格', pid:process.pid, started:Date.now() } };
}
test('停止参数必须有且只有一个记录名', t => {
  const f = fixture(t);
  for (const args of [[], ['--name'], ['a','b'], ['']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(script), '--stop', ...args], { env:{...process.env,CODEX_DISPATCH_HOME:f.home}, encoding:'utf8',windowsHide:true });
    assert.equal(result.status,2); assert.equal(result.stderr.trim(),'用法：node codex-task.mjs --stop <记录名>');
  }
});
test('找不到、已经结束和身份不符不结束进程', async t => {
  const f = fixture(t), output = [], options = { log:s=>output.push(s), killTree:()=>assert.fail('不应结束进程') };
  assert.equal(await stopTask(f.home,f.home,'中文 空格',options),2);
  assert.equal(output.pop(),'停止：在当前仓库找不到记录 中文 空格');
  f.record(f.start);
  // 本测试进程命令行不包含派发入口；实际查询应拒绝它。
  assert.equal(await stopTask(f.home,f.home,'中文 空格',options),1);
  assert.equal(output.pop(),'停止：中文 空格 的进程已经不在了');
  for (const info of [null, { created:Date.now()+10000,command:'node codex-task.mjs' }, {created:null,command:'codex-task.mjs'}]) {
    assert.equal(await stopTask(f.home,f.home,'中文 空格',{...options,info:async()=>info}),1);
  }
  f.record({event:'end',id:'sample',exit:0});
  assert.equal(await stopTask(f.home,f.home,'中文 空格',options),0);
  assert.equal(output.pop(),'停止：中文 空格（已经结束）');
});
test('停止成功隔开尾部半行，失败不追加记录', async t => {
  const f=fixture(t); f.record(f.start); appendFileSync(f.file,'broken half');
  const before=readFileSync(f.file,'utf8'), output=[];
  const options={info:async()=>({created:0,command:'node codex-task.mjs'}),alive:async()=>true,log:s=>output.push(s)};
  assert.equal(await stopTask(f.home,f.home,'中文 空格',{...options,killTree:async()=>{throw Error('测试超时');}}),1);
  assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(output.pop(),'停止：中文 空格 没能停下（测试超时）');
  assert.equal(await stopTask(f.home,f.home,'中文 空格',{...options,killTree:async()=>{}}),0);
  assert.match(readFileSync(f.file,'utf8'),/broken half\n\{"v":1,"event":"interrupted"/);
});
test('平台树结束必须等待子孙退出，超时失败', async () => {
  const calls=[];
  await assert.rejects(killProcessTree(123456,{platform:'win32',timeout:30,list:async()=>[{pid:123456,parent:0,created:1},{pid:123457,parent:123456,created:2}],executeFile:async(...args)=>calls.push(args),alive:pid=>pid===123457}),/超时/);
  assert.deepEqual(calls[0].slice(0,2),['taskkill.exe',['/PID','123456','/T','/F']]);
});
test('进程树快照发现 PID 已复用时拒绝结束', async () => {
  await assert.rejects(killProcessTree(123456, { expectedCreated:1, list:async()=>[{pid:123456,parent:0,created:2}], executeFile:()=>assert.fail('不应结束进程') }), /身份已经变化/);
});
