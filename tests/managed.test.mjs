import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createPlan, executePlan } from '../installer/lib/install.mjs';
import { createManaged } from '../app/src/main/managed.mjs';
import { handoff, terminalReader, managedEnvironment, validRequest } from '../skills/codex-dispatch/lib/managed.mjs';
import { registryWriter } from '../skills/codex-dispatch/lib/records.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = home => { try { const s = fs.readFileSync(path.join(home, 'runs.jsonl'), 'utf8'); return s.slice(0, s.lastIndexOf('\n')).split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
async function until(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = fn(); if (result) return result; await delay(25); }
  throw Error('隔离测试等待超时');
}
async function fixture(t, { exit = 0, duration = 150 } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatchdock-managed-'));
  const home = path.join(base, 'home'), repo = path.join(base, 'repo'), host = path.join(base, 'host');
  for (const dir of [home, repo, host]) fs.mkdirSync(dir);
  const env = { ...process.env, CODEX_DISPATCH_HOME: home, USERPROFILE: base, HOME: base, APPDATA: path.join(base, 'appdata'),
    CLAUDE_CONFIG_DIR: host, CODEX_HOME: path.join(base, 'codex'), XDG_CONFIG_HOME: path.join(base, 'xdg'), CODEX_NO_WATCH: '1' };
  for (const key of ['CODEX_DRY_RUN','CODEX_MODEL','CODEX_EFFORT','CODEX_TIER','CODEX_SANDBOX','CODEX_DISPATCH_TEST_AGENT','NODE_OPTIONS','ELECTRON_RUN_AS_NODE']) delete env[key];
  const agent = path.join(base, 'fake-agent.cjs');
  fs.writeFileSync(path.join(base, 'agent.json'), JSON.stringify({ exit, duration }));
  fs.writeFileSync(agent, `const fs=require('node:fs'),path=require('node:path');
if(process.argv.includes('--version')){console.log('codex-cli fake-managed');process.exit(0);}
let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{
const settings=JSON.parse(fs.readFileSync(path.join(__dirname,'agent.json'),'utf8'));
fs.writeFileSync(path.join(__dirname,'echo.json'),JSON.stringify({pid:process.pid,args:process.argv.slice(2),prompt,home:process.env.CODEX_HOME,key:process.env.OPENAI_API_KEY}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'隔离任务正在执行'}}));
setTimeout(()=>{fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'隔离汇报');process.exitCode=settings.exit;},settings.duration);
});`);
  const configFile = path.join(home, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ v: 1, managed: true, watchWindow: 'never', agents: { codex: { path: agent } } }));
  fs.writeFileSync(path.join(home, 'viewer.json'), JSON.stringify({ pid: process.pid, acceptsManaged: true, suppressWatchWindow: true }));
  executePlan(createPlan({ env, host: 'claude-code', skill: 'codex-dispatch' }), { env });
  const script = path.join(host, 'skills/codex-dispatch/codex-task.mjs');
  const children = new Set(), services = [];
  function launch(file = script, args = ['隔离任务', '--name', 'managed-test'], overrides = {}) {
    const child = spawn(process.execPath, [file, ...args], { cwd: repo, env: { ...env, ...overrides }, stdio: ['ignore','pipe','pipe','ipc'], windowsHide: true, shell: false });
    children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); });
    return child;
  }
  async function service() { const errors = []; const s = await createManaged(root, env, e => errors.push(e)); s.start(); services.push(s); return { s, errors }; }
  t.after(async () => {
    services.forEach(s => s.close());
    for (const child of children) if (child.exitCode === null && child.signalCode === null && alive(child.pid)) child.kill();
    // 只清理本 fixture 启动并记录的执行者，绝不按进程名终止。
    for (const r of rows(home).filter(r => r.event === 'start' && r.managed)) if (alive(r.pid)) {
      if (process.platform === 'win32') await execute('taskkill.exe', ['/PID', String(r.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      else process.kill(r.pid);
    }
    assert.ok(path.relative(os.tmpdir(), base).startsWith('dispatchdock-managed-'));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { base, home, repo, env, script, agent, configFile, launch, service };
}

test('托管完整流程：退出码、唯一清单、执行者 PID、预计算配置、进度和清理', async t => {
  const f = await fixture(t, { exit: 7 }); const { errors } = await f.service();
  const waiter = f.launch(f.script, ['隔离任务','补充说明','--name','managed-test','--model','explicit-model'], { CODEX_EFFORT: 'high' });
  const result = await waiter.done;
  assert.equal(result.code, 7, result.stderr);
  assert.match(result.stdout, /^记录名：managed-test\r?\n进度：/);
  assert.match(result.stdout, /托管：任务已交给 DispatchDock/);
  const records = rows(f.home); assert.deepEqual(records.map(r => r.event), ['start','spawned','end']);
  const [start, spawned, end] = records;
  assert.equal(start.managed, true); assert.notEqual(start.pid, waiter.pid); assert.equal(end.exit, 7);
  assert.equal(start.model, 'explicit-model'); assert.equal(start.effort, 'high');
  const echo = json(path.join(f.base, 'echo.json')); assert.equal(spawned.agentPid, echo.pid); assert.equal(echo.prompt, '任务：\n隔离任务\n补充说明'); assert.equal(echo.home, f.env.CODEX_HOME);
  const progress = fs.readFileSync(start.progress, 'utf8'); assert.equal((progress.match(/托管：任务已交给/g) || []).length, 1); assert.match(progress.trimEnd(), /=== Codex 结束：exit=7.*===$/);
  await until(() => fs.readdirSync(path.join(f.home, 'managed')).length === 0); assert.deepEqual(errors, []);
});

for (const kind of ['outside','modified','node']) test(`托管拒绝 ${kind}：等待者立即回退且只运行一次`, async t => {
  const f = await fixture(t);
  let script = f.script;
  if (kind === 'outside') script = path.join(root, 'skills/codex-dispatch/codex-task.mjs');
  if (kind === 'modified') fs.appendFileSync(path.join(path.dirname(script), 'lib/progress.mjs'), '\n// 隔离测试修改\n');
  const waiter = f.launch(script);
  await until(() => fs.existsSync(path.join(f.home, 'managed')) && fs.readdirSync(path.join(f.home, 'managed')).some(s => s.endsWith('.request.json')));
  if (kind === 'node') {
    const requestFile = path.join(f.home, 'managed', fs.readdirSync(path.join(f.home, 'managed')).find(s => s.endsWith('.request.json')));
    fs.writeFileSync(requestFile, JSON.stringify({ ...json(requestFile), node: path.join(f.base, 'missing/node.exe') }));
  }
  const before = Date.now(); await f.service();
  const result = await waiter.done;
  assert.equal(result.code, 0, result.stderr); assert.ok(Date.now() - before < 4000);
  assert.match(result.stdout, kind === 'node' ? /没有接手（node 路径无效）/ : /没有接手（派发脚本不是由 DispatchDock 安装的，或者被改过）/);
  const all = rows(f.home); assert.deepEqual(all.map(r => r.event), ['start','spawned','end']); assert.equal(all[0].managed, undefined); assert.equal(all[0].pid, waiter.pid);
  assert.match(fs.readFileSync(all[0].progress, 'utf8'), /改为直接运行/);
});

test('五秒超时：收回请求并直接运行', async t => {
  const f = await fixture(t), before = Date.now(), waiter = f.launch();
  const result = await waiter.done;
  assert.equal(result.code, 0, result.stderr); assert.ok(Date.now() - before >= 5000); assert.ok(Date.now() - before < 9000);
  assert.match(result.stdout, /没有接手（超时）/); assert.equal(rows(f.home)[0].pid, waiter.pid);
  assert.ok(fs.readdirSync(path.join(f.home, 'managed')).some(s => s.endsWith('.withdrawn.json')));
  await f.service(); await until(() => !fs.readdirSync(path.join(f.home, 'managed')).length);
});

test('认领后执行者启动失败写 rejected，等待者立即回退且只运行一份', async t => {
  const f = await fixture(t), waiter = f.launch();
  const requestFile = await until(() => {
    const dir = path.join(f.home, 'managed');
    if (!fs.existsSync(dir)) return null;
    const name = fs.readdirSync(dir).find(s => s.endsWith('.request.json')); return name && path.join(dir, name);
  });
  const invalidNode = path.join(f.base, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.writeFileSync(invalidNode, '本文件不是可执行程序');
  fs.writeFileSync(requestFile, JSON.stringify({ ...json(requestFile), node: invalidNode }));
  const before = Date.now();
  await f.service();
  const rejected = requestFile.replace('.request.json', '.rejected.json');
  assert.match(json(rejected).reason, /启动 Codex 失败/);
  const result = await waiter.done;
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /没有接手（启动 Codex 失败/);
  assert.ok(Date.now() - before < 4000);
  assert.deepEqual(rows(f.home).map(r => r.event), ['start','spawned','end']); assert.equal(rows(f.home)[0].pid, waiter.pid);
  assert.equal(rows(f.home)[0].managed, undefined);
});

async function requestFrom(f) {
  return until(() => {
    const dir = path.join(f.home, 'managed');
    if (!fs.existsSync(dir)) return null;
    const name = fs.readdirSync(dir).find(s => s.endsWith('.request.json'));
    return name && path.join(dir, name);
  });
}

test('请求不写密钥，执行者从软件继承密钥并用请求覆盖普通环境', async t => {
  const f = await fixture(t);
  f.env.OPENAI_API_KEY = 'fake-monitor-key';
  const waiter = f.launch(f.script, ['隔离任务'], { OPENAI_API_KEY: 'fake-waiter-key', CODEX_HOME: path.join(f.base, 'request-codex') });
  const file = await requestFrom(f), text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /OPENAI_API_KEY|fake-monitor-key|fake-waiter-key/);
  assert.equal(validRequest({ ...json(file), env: { ...json(file).env, OPENAI_API_KEY: 'fake' } }), false);
  await f.service(); assert.equal((await waiter.done).code, 0);
  const echo = json(path.join(f.base, 'echo.json'));
  assert.equal(echo.key, 'fake-monitor-key'); assert.equal(echo.home, path.join(f.base, 'request-codex'));
});

test('认领后未启动：超时收回直接运行，迟到执行者不写任何记录', async t => {
  const f = await fixture(t), waiter = f.launch(f.script, ['隔离任务'], { CODEX_DISPATCH_TEST_START_TIMEOUT_MS: '150' });
  const file = await requestFrom(f), claimed = file.replace('.request.json', '.claimed.json');
  fs.renameSync(file, claimed);
  const before = Date.now(), result = await waiter.done;
  assert.equal(result.code, 0, result.stderr); assert.ok(Date.now() - before >= 150);
  assert.match(result.stdout, /没有接手（软件没有启动任务）/);
  assert.ok(fs.existsSync(claimed.replace('.claimed.json', '.withdrawn.json')));
  const records = fs.readFileSync(path.join(f.home, 'runs.jsonl'), 'utf8');
  const files = fs.readdirSync(path.join(f.repo, '.codex-runs')).map(name => [name, fs.readFileSync(path.join(f.repo, '.codex-runs', name), 'utf8')]);
  const late = await f.launch(f.script, ['--run-request', claimed]).done;
  assert.equal(late.code, 0); assert.equal(late.stdout, ''); assert.equal(late.stderr, '');
  assert.equal(fs.readFileSync(path.join(f.home, 'runs.jsonl'), 'utf8'), records);
  for (const [name, value] of files) assert.equal(fs.readFileSync(path.join(f.repo, '.codex-runs', name), 'utf8'), value);
  assert.deepEqual(rows(f.home).map(r => r.event), ['start','spawned','end']);
});

for (const executorFirst of [true, false]) test(`执行者与收回竞争：执行者先取得运行权=${executorFirst}`, async t => {
  const f = await fixture(t, { duration: 300 });
  const waiter = f.launch(f.script, ['隔离任务'], { CODEX_DISPATCH_TEST_START_TIMEOUT_MS: executorFirst ? '1500' : '100' });
  const file = await requestFrom(f), claimed = file.replace('.request.json', '.claimed.json');
  fs.renameSync(file, claimed);
  if (!executorFirst) await until(() => fs.existsSync(claimed.replace('.claimed.json', '.withdrawn.json')));
  const executor = f.launch(f.script, ['--run-request', claimed]);
  const [a, b] = await Promise.all([waiter.done, executor.done]);
  assert.equal(a.code, 0, a.stderr); assert.equal(b.code, 0, b.stderr);
  assert.deepEqual(rows(f.home).map(r => r.event), ['start','spawned','end']);
  assert.equal(rows(f.home)[0].pid, executorFirst ? executor.pid : waiter.pid);
  assert.equal(fs.existsSync(claimed.replace('.claimed.json', '.running.json')), executorFirst);
});

test('认领后收到拒绝立即回退，不等启动兜底期限', async t => {
  const f = await fixture(t), waiter = f.launch();
  const file = await requestFrom(f), claimed = file.replace('.request.json', '.claimed.json');
  fs.renameSync(file, claimed); await delay(150);
  const rejected = claimed.replace('.claimed.json', '.rejected.json');
  fs.renameSync(claimed, rejected);
  fs.writeFileSync(rejected + '.tmp', JSON.stringify({ ...json(rejected), reason: '隔离测试拒绝' }));
  fs.renameSync(rejected + '.tmp', rejected);
  const before = Date.now(), result = await waiter.done;
  assert.equal(result.code, 0); assert.ok(Date.now() - before < 4000);
  assert.match(result.stdout, /任务已交给 DispatchDock/); assert.match(result.stdout, /没有接手（隔离测试拒绝）/);
  assert.equal(rows(f.home).filter(r => r.event === 'start').length, 1);
});

test('收回与执行者改名并发发生，始终只运行一份', async t => {
  const f = await fixture(t);
  const gate = path.join(f.base, 'executor-gate.mjs');
  fs.writeFileSync(gate, `import {run} from ${JSON.stringify(new URL('../skills/codex-dispatch/lib/run.mjs', import.meta.url).href)};
import {codex} from ${JSON.stringify(new URL('../skills/codex-dispatch/adapters/codex.mjs', import.meta.url).href)};
process.send('ready');process.once('message',async file=>{process.disconnect();process.exitCode=await run({adapter:codex,scriptPath:${JSON.stringify(f.script)},args:['--run-request',file]});});`);
  for (let i = 0; i < 3; i++) {
    const executor = f.launch(gate, []);
    await new Promise(resolve => executor.once('message', resolve));
    const waiter = f.launch(f.script, ['隔离任务','--name',`concurrent-${i}`], { CODEX_DISPATCH_TEST_START_TIMEOUT_MS: '100' });
    const file = await requestFrom(f), request = json(file), claimed = file.replace('.request.json', '.claimed.json');
    fs.renameSync(file, claimed);
    await delay(100); executor.send(claimed);
    const [a, b] = await Promise.all([waiter.done, executor.done]);
    assert.equal(a.code, 0, a.stderr); assert.equal(b.code, 0, b.stderr);
    const records = rows(f.home).filter(r => r.id === request.id);
    assert.deepEqual(records.map(r => r.event), ['start','spawned','end']);
    assert.ok([executor.pid,waiter.pid].includes(records[0].pid));
  }
});

test('执行者使用请求快照：认领前更改默认配置，不影响本次参数与指定 agent', async t => {
  const f = await fixture(t), waiter = f.launch(f.script, ['隔离任务','--model','snapshot-model']);
  await until(() => fs.existsSync(path.join(f.home, 'managed')) && fs.readdirSync(path.join(f.home, 'managed')).some(s => s.endsWith('.request.json')));
  fs.writeFileSync(f.configFile, JSON.stringify({v:1,managed:false,agents:{codex:{path:path.join(f.base,'missing-agent.exe'),model:'changed-model',sandbox:'read-only'}}}));
  await f.service(); assert.equal((await waiter.done).code,0);
  const start = rows(f.home)[0]; assert.equal(start.model,'snapshot-model'); assert.equal(start.sandbox,'workspace-write'); assert.equal(start.managed,true);
});

test('角色文件消失时拒绝请求，不产生托管执行记录', async t => {
  const f = await fixture(t), role = path.join(f.repo, 'role.md'); fs.writeFileSync(role, '# 角色：测试角色');
  const waiter = f.launch(f.script, ['隔离任务','--role','role.md']);
  await until(() => fs.existsSync(path.join(f.home, 'managed')) && fs.readdirSync(path.join(f.home, 'managed')).some(s => s.endsWith('.request.json')));
  fs.unlinkSync(role); await f.service();
  const result = await waiter.done; assert.equal(result.code,0); assert.match(result.stdout,/没有接手（请求文件无效）/);
  assert.equal(rows(f.home)[0].managed,undefined);
});

test('认领和收回竞争：两种获胜顺序都只有一个执行所有者', async t => {
  const f = await fixture(t);
  for (const claimFirst of [true, false]) {
    const id = 'race-' + claimFirst, name = id, dir = path.join(f.home, 'managed'); fs.mkdirSync(dir, { recursive: true });
    const r = { v:1,id,at:Date.now(),script:f.script,node:process.execPath,repo:f.repo,name,args:{task:'隔离任务',extra:'',role:null,spec:null},settings:{model:null,effort:null,tier:null,sandbox:'workspace-write',path:f.agent},dispatcher:{host:'unknown',session:null},env:managedEnvironment(f.env) };
    let owners = 0;
    const pending = handoff(f.home, r, () => {}, { timeout: claimFirst ? 100 : 0, interval: 5 });
    const claim = () => { try { fs.renameSync(path.join(dir,id+'.request.json'),path.join(dir,id+'.claimed.json')); owners++; registryWriter(f.home)({event:'end',id,exit:0,at:Date.now(),minutes:0}); } catch(e) { assert.equal(e.code,'ENOENT'); } };
    claim(); const outcome = await pending; if ('reason' in outcome) owners++;
    assert.equal(owners,1); assert.equal('exit' in outcome,claimFirst);
  }
});

for (const mode of ['off','dead','legacy','dry']) test(`不满足托管条件 ${mode}：没有请求或托管输出`, async t => {
  const f = await fixture(t);
  if (mode === 'off') fs.writeFileSync(f.configFile, JSON.stringify({ ...json(f.configFile), managed:false }));
  if (mode === 'dead') fs.writeFileSync(path.join(f.home,'viewer.json'),JSON.stringify({pid:2147483647,acceptsManaged:true}));
  if (mode === 'legacy') fs.writeFileSync(path.join(f.home,'viewer.json'),JSON.stringify({pid:process.pid}));
  const result = await f.launch(f.script, ['隔离任务'], mode === 'dry' ? {CODEX_DRY_RUN:'1'} : {}).done;
  assert.equal(result.code,0,result.stderr); assert.doesNotMatch(result.stdout,/托管：/); assert.equal(fs.existsSync(path.join(f.home,'managed')),false);
  assert.equal(rows(f.home).length,mode==='dry'?0:3);
});

test('请求校验、环境白名单、完整行读取和启动清理', async t => {
  const f=await fixture(t),dir=path.join(f.home,'managed');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'old.tmp'),'old');fs.utimesSync(path.join(dir,'old.tmp'),new Date(0),new Date(0));
  fs.writeFileSync(path.join(dir,'bad.request.json'),'{}');
  await f.service();
  assert.equal(fs.existsSync(path.join(dir,'old.tmp')),false);assert.equal(json(path.join(dir,'bad.rejected.json')).reason,'请求文件无效');
  assert.equal(validRequest({v:1}),false);
  assert.deepEqual(managedEnvironment({Path:'fake',NODE_OPTIONS:'injected',ELECTRON_RUN_AS_NODE:'1',UNRELATED:'no'}),{PATH:'fake'});
  const file=path.join(f.home,'runs.jsonl'),read=terminalReader(f.home,'half');
  fs.writeFileSync(file,'{"v":1,"event":"end","id":"half","exit":0}');assert.equal(read(),null);fs.appendFileSync(file,'\n');assert.equal(read().exit,0);
});

test('Windows 实测：终止假派活方整棵进程树，执行者和假 agent 继续到 end', { skip:process.platform!=='win32' }, async t => {
  const f=await fixture(t,{duration:2500});await f.service();
  const hostFile=path.join(f.base,'fake-host.mjs');
  fs.writeFileSync(hostFile,`import {spawn} from 'node:child_process';const child=spawn(process.execPath,[${JSON.stringify(f.script)},'隔离任务'],{stdio:'inherit',windowsHide:true,shell:false});child.on('close',code=>process.exit(code));`);
  const host=f.launch(hostFile,[]);
  const started=await until(()=>rows(f.home).find(r=>r.event==='spawned'));
  await until(()=>fs.existsSync(path.join(f.base,'echo.json')));
  const executor=rows(f.home)[0];
  await execute('taskkill.exe',['/PID',String(host.pid),'/T','/F'],{windowsHide:true});
  assert.equal(alive(host.pid),false);assert.equal(alive(executor.pid),true);assert.equal(alive(started.agentPid),true);
  const end=await until(()=>rows(f.home).find(r=>r.event==='end'));assert.equal(end.exit,0);
  t.diagnostic('taskkill.exe /PID <本测试假派活方 PID> /T /F：派活方与等待者退出；执行者、假 agent 存活；唯一 end.exit=0。');
});

test('Windows 实测：关闭软件认领进程，托管任务仍正常完成', { skip:process.platform!=='win32' }, async t => {
  const f=await fixture(t,{duration:1800}),monitorFile=path.join(f.base,'fake-monitor.mjs');
  fs.writeFileSync(monitorFile,`import {createManaged} from ${JSON.stringify(new URL('../app/src/main/managed.mjs',import.meta.url).href)};import fs from 'node:fs';const service=await createManaged(${JSON.stringify(root)});service.start();fs.writeFileSync(${JSON.stringify(path.join(f.home,'viewer.json'))},JSON.stringify({pid:process.pid,acceptsManaged:true,suppressWatchWindow:true}));process.send('ready');process.on('message',()=>{service.close();fs.unlinkSync(${JSON.stringify(path.join(f.home,'viewer.json'))});process.disconnect();});`);
  const monitor=f.launch(monitorFile,[]);await new Promise(resolve=>monitor.once('message',resolve));
  const waiter=f.launch();await until(()=>fs.existsSync(path.join(f.base,'echo.json')));
  const [executor,agent]=rows(f.home);monitor.send('close');assert.equal((await monitor.done).code,0);
  assert.equal(alive(executor.pid),true);assert.equal(alive(agent.agentPid),true);
  assert.equal((await waiter.done).code,0);assert.equal(rows(f.home).at(-1).exit,0);
  t.diagnostic('向独立假监控进程发送 close，关闭认领服务并正常退出：执行者与假 agent 存活，等待者 exit=0，唯一 end.exit=0。');
});
