import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { reverseRows, findStart, waitForTask } from '../skills/codex-dispatch/lib/wait.mjs';
import { pidAlive, processCreated, taskAlive } from '../skills/codex-dispatch/lib/process.mjs';

const entry = fileURLToPath(new URL('../skills/codex-dispatch/codex-task.mjs', import.meta.url));
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), 'dispatchdock-wait-'));
  const repo = join(base, '示例 仓库'), home = join(base, 'home'), children = [];
  fs.mkdirSync(repo); fs.mkdirSync(home);
  const file = join(home, 'runs.jsonl');
  const env = { ...process.env, CODEX_DISPATCH_HOME: home };
  for (const key of Object.keys(env)) if (/^CODEX_/.test(key) && key !== 'CODEX_DISPATCH_HOME') delete env[key];
  const append = row => fs.appendFileSync(file, JSON.stringify({ v: 1, ...row }) + '\n');
  const start = (overrides = {}) => ({ event: 'start', id: 'sample', repo, name: '中文任务', pid: 2147483647,
    started: Date.now(), report: join(repo, 'report.md'), events: join(repo, 'events.jsonl'), ...overrides });
  function launch(args = ['--wait', '中文任务'], nodeArgs = []) {
    const child = spawn(process.execPath, [...nodeArgs, entry, ...args], { cwd: repo, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); child.output = ''; let stderr = '';
    child.stdout.on('data', b => child.output += b); child.stderr.on('data', b => stderr += b);
    child.done = new Promise((res, rej) => { child.on('error', rej); child.on('close', code => res({ code, stdout: child.output, stderr })); });
    return child;
  }
  async function fake() {
    const child = spawn(process.execPath, ['-e', 'process.send("ready");setInterval(()=>{},1000)'], { env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    children.push(child); child.done = once(child, 'close'); await once(child, 'message'); return child;
  }
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.all(children.map(child => child.done));
    assert.equal(dirname(base), resolve(tmpdir()));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { base, repo, home, file, env, append, start, launch, fake };
}
async function until(fn) {
  const deadline = Date.now() + 15000;
  while (!fn()) { if (Date.now() > deadline) throw Error('等待测试条件超时'); await delay(20); }
}

for (const code of [0, 7]) test(`已结束 exit=${code}：输出原因和结果，所有文件保持只读`, async t => {
  const f = fixture(t), start = f.start();
  f.append(start); f.append({ event: 'end', id: start.id, exit: code });
  fs.writeFileSync(start.events, '{"kind":"error","text":"原因一\\n详细"}\n坏行\n{"kind":"error","text":"原因二"}\n');
  fs.writeFileSync(join(f.home, 'config.json'), '无效配置');
  const before = [f.file, start.events, join(f.home, 'config.json')].map(file => [file, fs.readFileSync(file), fs.statSync(file).mtimeMs]);
  const result = await f.launch().done;
  assert.equal(result.code, code, result.stderr);
  assert.equal(result.stdout, `等待：中文任务（已结束）\n${code ? '出错：原因一 详细\n出错：原因二\n' : ''}exit=${code} report=${start.report}\n`);
  for (const [file, content, mtime] of before) { assert.deepEqual(fs.readFileSync(file), content); assert.equal(fs.statSync(file).mtimeMs, mtime); }
  assert.deepEqual(fs.readdirSync(f.repo), ['events.jsonl']);
});

test('已中断和事件文件缺失：退出 1 并输出结束行', async t => {
  const f = fixture(t); f.append(f.start()); f.append({ event: 'interrupted', id: 'sample', signal: 'SIGTERM' });
  const result = await f.launch().done;
  assert.equal(result.code, 1); assert.match(result.stdout, /（已结束）\nexit=1 report=/); assert.equal(result.stderr, '');
});

test('同一任务同时有 end 和 interrupted 时优先采用 end', async t => {
  const f = fixture(t); f.append(f.start());
  f.append({ event: 'end', id: 'sample', exit: 0 }); f.append({ event: 'interrupted', id: 'sample', signal: 'SIGTERM' });
  const result = await f.launch().done; assert.equal(result.code, 0); assert.match(result.stdout, /exit=0 report=/);
});

test('同一仓库的符号链接和实际路径能找到同一任务', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), alias = join(f.base, '仓库 别名');
  fs.symlinkSync(f.repo, alias, 'dir');
  f.append(f.start({ repo: alias })); f.append({ event: 'end', id: 'sample', exit: 7 });
  assert.equal(findStart(f.file, fs.realpathSync(f.repo), '中文任务').id, 'sample');
  const before = fs.readFileSync(f.file), result = await f.launch().done;
  assert.equal(result.code, 7, result.stderr);
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('真实派发入口使用假 agent：重新等待的失败输出与原派发逐字一致', async t => {
  const f = fixture(t), agent = join(f.base, 'fake-agent.mjs');
  fs.writeFileSync(agent, `if(process.argv.includes('--version')) console.log('codex-cli fake');
else { console.log(JSON.stringify({type:'error',message:'模拟失败原因'})); process.exitCode=7; }`);
  Object.assign(f.env, { CODEX_DISPATCH_TEST_AGENT: agent, CODEX_NO_WATCH: '1' });
  fs.writeFileSync(join(f.home, 'config.json'), '{"v":1}');
  const dispatched = await f.launch(['隔离任务', '--name', '中文任务']).done;
  const waited = await f.launch().done;
  assert.equal(dispatched.code, 7, dispatched.stderr); assert.equal(waited.code, dispatched.code);
  assert.match(dispatched.stdout, /出错：模拟失败原因/);
  assert.equal(waited.stdout.split('\n').slice(1).join('\n'), dispatched.stdout.slice(dispatched.stdout.indexOf('出错：')));
});

test('找不到记录和未指定记录名的空仓库：退出 2，不创建任何文件', async t => {
  const f = fixture(t);
  for (const args of [['--wait', '不存在'], ['--wait']]) {
    const result = await f.launch(args).done; assert.equal(result.code, 2);
    assert.equal(result.stdout, `等待：在当前仓库找不到记录${args[1] ? ' ' + args[1] : ''}\n`);
  }
  assert.deepEqual(fs.readdirSync(f.home), []); assert.deepEqual(fs.readdirSync(f.repo), []);
});

test('最近 start、自动选名、重名序号、跨仓库同名和尾部半行', async t => {
  const f = fixture(t);
  for (const [id, name, repo, exit] of [['old', '中文任务', f.repo, 7], ['new', '中文任务', f.repo, 0], ['numbered', '中文任务-2', f.repo, 3], ['other', '中文任务-2', join(f.base, 'other'), 9]]) {
    f.append(f.start({ id, name, repo })); f.append({ event: 'end', id, exit });
  }
  fs.appendFileSync(f.file, JSON.stringify({ v: 1, ...f.start({ id: 'partial', name: '半行' }) }));
  for (const [args, code, name] of [[['--wait'], 3, '中文任务-2'], [['--wait', '中文任务'], 0, '中文任务'], [['--wait', '中文任务-2'], 3, '中文任务-2']]) {
    const result = await f.launch(args).done; assert.equal(result.code, code); assert.ok(result.stdout.startsWith(`等待：${name}（已结束）`));
  }
});

for (const managed of [false, true]) test(`等待进行中任务到结束，managed=${managed}，半行结束记录不提前生效`, async t => {
  const f = fixture(t), fake = await f.fake();
  f.append(f.start({ pid: fake.pid, managed }));
  const waiter = f.launch(); await until(() => waiter.output.includes('（进行中）'));
  fs.appendFileSync(f.file, '{"v":1,"event":"end","id":"sample","exit":4}');
  await delay(100); assert.equal(waiter.exitCode, null);
  fs.appendFileSync(f.file, '\n');
  const result = await waiter.done; assert.equal(result.code, 4); assert.match(result.stdout, /exit=4 report=/);
  assert.equal(pidAlive(fake.pid), true);
});

test('进行中任务写入 interrupted 后返回 1', async t => {
  const f = fixture(t), fake = await f.fake(); f.append(f.start({ pid: fake.pid }));
  const waiter = f.launch(); await until(() => waiter.output.includes('（进行中）'));
  f.append({ event: 'interrupted', id: 'sample', signal: 'SIGTERM' });
  const result = await waiter.done; assert.equal(result.code, 1); assert.match(result.stdout, /exit=1 report=/);
});

test('进程消失无记录，以及等待过程中消失：只报告中断，不写清单', async t => {
  const f = fixture(t); f.append(f.start());
  let result = await f.launch().done; assert.equal(result.code, 1); assert.match(result.stdout, /任务进程已经不在了/);
  const fake = await f.fake(); f.append(f.start({ id: 'live', pid: fake.pid }));
  const waiter = f.launch(); await until(() => waiter.output.includes('（进行中）'));
  const before = fs.readFileSync(f.file); fake.kill(); await fake.done;
  result = await waiter.done; assert.equal(result.code, 1); assert.match(result.stdout, /任务进程已经不在了/);
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('本机进程启动时间识别 PID 复用，未知时间退回存活检查', async t => {
  const f = fixture(t), fake = await f.fake(), created = await processCreated(fake.pid);
  assert.ok(Number.isFinite(created), '本机必须能查询假进程的启动时间');
  f.append(f.start({ pid: fake.pid, started: created - 10000 }));
  const result = await f.launch().done; assert.equal(result.code, 1); assert.match(result.stdout, /任务进程已经不在了/);
  assert.equal(pidAlive(fake.pid), true);
  assert.equal(await taskAlive({ pid: fake.pid, started: 0 }, { created: async () => null }), true);
  assert.equal(await taskAlive({ pid: 0, started: 0 }), false);
  t.diagnostic('本机查询假 agent 创建时间成功；早于创建时间的 start 被判为 PID 复用；未停止假 agent。');
});

test('终止等待者不影响假任务，也不改记录', async t => {
  const f = fixture(t), fake = await f.fake(); f.append(f.start({ pid: fake.pid, managed: true }));
  const before = fs.readFileSync(f.file), waiter = f.launch(); await until(() => waiter.output.includes('（进行中）'));
  waiter.kill(); await waiter.done;
  assert.equal(pidAlive(fake.pid), true); assert.deepEqual(fs.readFileSync(f.file), before);
  f.append({ event: 'end', id: 'sample', exit: 0 }); assert.equal((await f.launch().done).code, 0);
});

test('查询进程时写入结束记录，优先返回真实结果', async t => {
  const f = fixture(t); f.append(f.start()); const logs = [];
  const code = await waitForTask(f.home, f.repo, '中文任务', { log: line => logs.push(line), alive: async () => { f.append({ event: 'end', id: 'sample', exit: 0 }); return false; } });
  assert.equal(code, 0); assert.equal(logs[0], '等待：中文任务（已结束）');
});

test('倒序读取跨块中文、坏行、未知版本和大清单；小堆内存仍能查到尾部任务', async t => {
  const f = fixture(t), row = { v: 1, ...f.start({ title: '中文'.repeat(40000) }) };
  fs.writeFileSync(f.file, JSON.stringify(row) + '\n坏行\n{"v":2,"event":"start"}\n半行');
  assert.deepEqual([...reverseRows(f.file)], [row]); assert.equal(findStart(f.file, f.repo).id, row.id);
  const fd = fs.openSync(f.file, 'w');
  try {
    const block = '{"v":1,"event":"unknown","text":"'.padEnd(1023, 'x') + '"}\n';
    const chunk = block.repeat(1024);
    for (let i = 0; i < 48; i++) fs.writeSync(fd, chunk);
  } finally { fs.closeSync(fd); }
  f.append(f.start()); f.append({ event: 'end', id: 'sample', exit: 0 });
  const result = await f.launch(['--wait'], ['--max-old-space-size=24']).done;
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /等待：中文任务（已结束）/);
});
