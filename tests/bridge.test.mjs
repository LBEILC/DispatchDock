import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { bridgeEvents } from '../skills/codex-dispatch/adapters/bridge.mjs';
import { resolveSettings } from '../skills/codex-dispatch/lib/config.mjs';
import { parseArgs } from '../skills/codex-dispatch/lib/options.mjs';

const entry = fileURLToPath(new URL('../skills/codex-dispatch/codex-task.mjs', import.meta.url));
const rows = file => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'dispatchdock-bridge-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const home = path.join(root, 'home'); mkdirSync(home);
  const worker = path.join(root, 'worker with spaces.mjs');
  writeFileSync(worker, `let s='';for await(const chunk of process.stdin)s+=chunk;const r=JSON.parse(s);console.log(JSON.stringify({kind:'say',text:JSON.stringify({r,args:process.argv.slice(2),parent:process.env.DISPATCH_PARENT_ID})}));`);
  const config = value => writeFileSync(path.join(home, 'config.json'), JSON.stringify(value));
  const env = { ...process.env, CODEX_DISPATCH_HOME: home, CODEX_NO_WATCH: '1' };
  for (const key of Object.keys(env)) if (/^CODEX_(?:DRY_RUN|MODEL|EFFORT|TIER|SANDBOX)|^DISPATCH_/.test(key)) delete env[key];
  config({ v: 1, agents: { example: { path: worker, args: ['literal spaces', '$(no-shell)'], model: 'sample-model' } } });
  const run = args => spawnSync(process.execPath, [entry, '只读检查', '--name', 'bridge', '--agent', 'example', ...args], { cwd: root, env, encoding: 'utf8', timeout: 15000, windowsHide: true, shell: false });
  return { root, home, config, worker, run, env };
}

test('任意指挥方派给桥接执行端：结构化输入、父任务、字面参数、事件与汇报', t => {
  const f = fixture(t), result = f.run(['--host', 'codex', '--parent', 'supervisor-123']);
  assert.equal(result.status, 0, result.stderr);
  const [start, spawned, end] = rows(path.join(f.home, 'runs.jsonl'));
  assert.equal(start.agent, 'example'); assert.equal(start.parent, 'supervisor-123'); assert.equal(start.dispatcher.host, 'codex');
  assert.equal(start.sandbox, 'read-only'); assert.equal(end.exit, 0); assert.ok(spawned.agentPid);
  const echo = JSON.parse(readFileSync(start.report, 'utf8'));
  assert.equal(echo.r.v, 1); assert.equal(echo.r.repo, realpathSync(f.root)); assert.match(echo.r.prompt, /只读检查/);
  assert.equal(echo.r.settings.model, 'sample-model'); assert.equal(echo.parent, start.id);
  assert.deepEqual(echo.args, ['literal spaces', '$(no-shell)']);
  assert.deepEqual(rows(start.events).map(e => e.kind), ['say']);
});

test('桥接执行端配置缺失仍产生失败结束记录', t => {
  const f = fixture(t); f.config({ v: 1 });
  const result = f.run([]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /agents.example.path/);
  assert.deepEqual(rows(path.join(f.home, 'runs.jsonl')).map(row => row.event), ['start', 'end']);
});

test('下级再次派发自动继承当前任务 ID，形成可核对的父子关系', t => {
  const f = fixture(t), lower = path.join(f.root, 'lower.mjs');
  writeFileSync(lower, `process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({kind:'say',text:'子任务完成'})));`);
  writeFileSync(f.worker, `import {spawnSync} from 'node:child_process';process.stdin.resume();process.stdin.on('end',()=>{const r=spawnSync(process.execPath,[process.argv[2],'子任务','--agent','lower','--host','example','--name','child'],{env:process.env,encoding:'utf8',shell:false,windowsHide:true});console.log(JSON.stringify({kind:'say',text:'已检查子任务退出码 '+r.status}));process.exitCode=r.status;});`);
  f.config({ v: 1, agents: { example: { path: f.worker, args: [entry] }, lower: { path: lower } } });
  const result = f.run(['--host', 'codex']);
  assert.equal(result.status, 0, result.stderr);
  const starts = rows(path.join(f.home, 'runs.jsonl')).filter(row => row.event === 'start');
  assert.equal(starts.length, 2); assert.equal(starts[1].parent, starts[0].id);
  assert.equal(starts[1].dispatcher.host, 'example'); assert.equal(starts[1].agent, 'lower');
  assert.equal(readFileSync(starts[1].report, 'utf8'), '子任务完成');
});

test('非 Codex 执行端的模型与参数独立，不继承 CODEX_MODEL', () => {
  const config = { v: 1, agents: { example: { model: 'own', args: ['x'] }, codex: { model: 'other' } } };
  const state = resolveSettings(config, { agent: 'example' }, { CODEX_MODEL: 'ignore', DISPATCH_EXAMPLE_MODEL: 'env-model' });
  assert.equal(state.settings.model, 'env-model'); assert.equal(state.settings.sandbox, 'read-only');
  assert.equal(resolveSettings(config, { agent: 'example', model: 'explicit' }).settings.model, 'explicit');
  assert.throws(() => resolveSettings({ agents: { example: { args: 'unsafe string' } } }, { agent: 'example' }), /字符串数组/);
  for (const args of [['--agent', '../bad'], ['--host', 'with space'], ['--parent', 'bad\nvalue']]) assert.throws(() => parseArgs(['task', ...args]));
  assert.equal(parseArgs(['task', '--host', 'future-agent']).opts.host, 'future-agent');
  assert.equal(resolveSettings({}, { agent: 'deepseek' }, { DEEPSEEK_MODEL: 'env-ds' }).settings.model, 'env-ds');
  assert.equal(resolveSettings({}, { agent: 'deepseek' }, { DEEPSEEK_MODEL: 'env-ds', DISPATCH_DEEPSEEK_MODEL: 'explicit-ds' }).settings.model, 'explicit-ds');
});

test('桥接事件忽略损坏、未知和类型错误输入，不允许覆盖公共层序号', () => {
  for (const event of [null, [], {}, { kind: 'file', files: [null] }, { kind: 'plan', items: [{ text: 1 }] }, { kind: 'turn', usage: { input: -1, output: 2 } }, { kind: 'cmd', phase: 'end', id: 'c', command: 'x' }]) assert.deepEqual(bridgeEvents(JSON.stringify(event)), []);
  assert.deepEqual(bridgeEvents('{"kind":"say","text":"OK","seq":999,"v":999}'), [{ kind: 'say', text: 'OK' }]);
  assert.deepEqual(bridgeEvents('plain text'), [{ kind: 'text', text: 'plain text' }]);
});
