import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openWatch, shouldWatch, viewerTakesOver } from '../skills/codex-dispatch/lib/watch.mjs';
import { followProgress, latestProgress } from '../skills/codex-dispatch/codex-watch.mjs';

const watcher = fileURLToPath(new URL('../skills/codex-dispatch/codex-watch.mjs', import.meta.url));

function setup(t) {
  const base = fs.mkdtempSync(path.join(tmpdir(), 'dispatch-watch-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  return { base, env: { ...process.env, HOME: home, CODEX_DISPATCH_HOME: home, CODEX_NO_WATCH: '1' } };
}

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('等待测试进度超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function fakeOpen() {
  const child = new EventEmitter(); child.unref = () => {};
  let call;
  return { child, spawnProcess: (...args) => { call = args; return child; }, get call() { return call; } };
}

test('Windows 与 macOS 使用同样的窗口策略和查看器接管规则', t => {
  const { base } = setup(t);
  fs.writeFileSync(path.join(base, 'viewer.json'), JSON.stringify({ pid: 12345, suppressWatchWindow: true }));
  assert.equal(viewerTakesOver(base, pid => assert.equal(pid, 12345)), true);
  assert.equal(viewerTakesOver(base, () => { throw new Error('假进程已退出'); }), false);
  for (const platform of ['win32', 'darwin']) {
    for (const interactive of [true, false]) {
      for (const policy of ['auto', 'always', 'never']) {
        for (const takeover of [true, false]) {
          assert.equal(shouldWatch({ platform, interactive, policy, takeover }), !interactive && policy !== 'never' && (policy === 'always' || !takeover));
        }
      }
    }
  }
  assert.equal(shouldWatch({ platform: 'linux', interactive: false, policy: 'always', takeover: false }), false);
});

test('macOS 假 open 只接收 Terminal 和启动文件，失败回收启动文件', t => {
  const { base } = setup(t), fake = fakeOpen();
  const launcher = openWatch('测试', path.join(base, 'progress.log'), { platform: 'darwin', temporaryRoot: base, spawnProcess: fake.spawnProcess });
  assert.deepEqual(fake.call, ['/usr/bin/open', ['-a', 'Terminal', launcher], { detached: true, stdio: 'ignore', shell: false }]);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(launcher).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.dirname(launcher)).mode & 0o777, 0o700);
  }
  fake.child.emit('error', new Error('假 open 无法启动'));
  assert.equal(fs.existsSync(path.dirname(launcher)), false);
  const other = fakeOpen();
  const second = openWatch('测试', path.join(base, 'progress.log'), { platform: 'darwin', temporaryRoot: base, spawnProcess: other.spawnProcess });
  other.child.emit('exit', 1);
  assert.equal(fs.existsSync(path.dirname(second)), false);
});

test('macOS 回收一天前未启动的文件并保留其他临时目录内容', t => {
  const { base } = setup(t), stale = path.join(base, 'dispatchdock-watch-stale'), foreign = path.join(base, 'dispatchdock-watch-other');
  fs.mkdirSync(stale); fs.writeFileSync(path.join(stale, 'watch.command'), '旧启动文件');
  fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'keep.txt'), '其他文件');
  const old = new Date(Date.now() - 2 * 86_400_000);
  fs.utimesSync(stale, old, old); fs.utimesSync(foreign, old, old);
  const fake = fakeOpen();
  openWatch('测试', path.join(base, 'progress.log'), { platform: 'darwin', temporaryRoot: base, spawnProcess: fake.spawnProcess });
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), '其他文件');
});

test('查看最近 200 行、追加 UTF-8、截断与停止读取', async t => {
  const { base } = setup(t), file = path.join(base, 'progress.log');
  fs.writeFileSync(file, Array.from({ length: 250 }, (_, index) => `第 ${index + 1} 行\n`).join(''));
  let output = '';
  const stop = followProgress(file, { write: text => { output += text; } }, 10);
  t.after(stop);
  assert.equal(output, Array.from({ length: 200 }, (_, index) => `第 ${index + 51} 行\n`).join(''));
  const bytes = Buffer.from('追加中文\n');
  fs.appendFileSync(file, bytes.subarray(0, 2));
  await new Promise(resolve => setTimeout(resolve, 30));
  fs.appendFileSync(file, bytes.subarray(2));
  await until(() => output.endsWith('追加中文\n'));
  assert.ok(!output.includes('\ufffd'));
  fs.writeFileSync(file, '截断后\n');
  await until(() => output.endsWith('截断后\n'));
  stop(); const before = output;
  fs.appendFileSync(file, '不再读取\n');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(output, before);
});

test('手动查看按修改时间选最新日志，空仓库正常退出', async t => {
  const { base, env } = setup(t);
  const empty = spawnSync(process.execPath, [watcher, base], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(empty.status, 0, empty.stderr); assert.match(empty.stdout, /还没有任务进度/);
  const directory = path.join(base, '.codex-runs'); fs.mkdirSync(directory);
  const old = path.join(directory, 'a.progress.log'), recent = path.join(directory, 'b.progress.log');
  fs.writeFileSync(old, '旧进度\n'); fs.utimesSync(old, new Date(0), new Date(0)); fs.writeFileSync(recent, '新进度\n');
  assert.equal(latestProgress(base), recent);
  const child = spawn(process.execPath, [watcher, base], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = ''; child.stdout.on('data', data => { output += data; });
  await until(() => output.includes('新进度'));
  const closed = once(child, 'close'); child.kill(); await closed;
});

test('手动查看支持技能入口的符号链接路径', { skip: process.platform === 'win32' }, t => {
  const { base, env } = setup(t), link = path.join(base, '查看 入口.mjs');
  fs.symlinkSync(watcher, link);
  const result = spawnSync(process.execPath, [link, base], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /还没有任务进度/);
});

test('macOS 启动文件正确处理特殊路径，关闭查看器不影响独立假任务', { skip: process.platform === 'win32' }, async t => {
  const { base, env } = setup(t);
  const root = path.join(base, "中文 空格 ' \" $ ` 目录"); fs.mkdirSync(root);
  const file = path.join(root, "进度 ' \" $ ` .log"), heartbeat = path.join(root, 'heartbeat');
  fs.writeFileSync(file, '初始进度\n');
  const taskScript = path.join(root, 'fake-task.mjs');
  fs.writeFileSync(taskScript, "import { writeFileSync, appendFileSync } from 'node:fs'; let count = 0; setInterval(() => { writeFileSync(process.argv[3], String(++count)); appendFileSync(process.argv[2], '假任务进度 ' + count + '\\n'); }, 30);\n");
  const task = spawn(process.execPath, [taskScript, file, heartbeat], { env, stdio: 'ignore' });
  t.after(() => { if (task.exitCode === null) task.kill(); });
  const fake = fakeOpen(), marker = path.join(base, 'injected');
  const launcher = openWatch(`中文 ' \" $ \` $(touch ${marker})`, file, { platform: 'darwin', temporaryRoot: root, spawnProcess: fake.spawnProcess });
  // 只在测试内用 sh 执行生成文件，绝不调用真实 open 或打开用户的 Terminal。
  const child = spawn('/bin/sh', [launcher], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  await until(() => output.includes('假任务进度'));
  assert.equal(errors, ''); assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.dirname(launcher)), false);
  const closed = once(child, 'close'); child.kill('SIGHUP'); await closed;
  const before = Number(fs.readFileSync(heartbeat, 'utf8'));
  await until(() => Number(fs.readFileSync(heartbeat, 'utf8')) > before);
  assert.equal(task.exitCode, null);
  const taskClosed = once(task, 'close'); task.kill(); await taskClosed;
});
