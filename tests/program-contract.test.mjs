import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkEnvironment, runProgram } from '../skills/codex-dispatch/lib/program.mjs';

// 测试用系统临时目录当工作目录，跑完清理；所有子进程都是 node 自身的 -e 脚本，不碰真实 agent。
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dispatchdock-program-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}

// 用 node 跑一段脚本，只保留最基本的环境（白名单里的 PATH/TEMP 等），避免继承本机模型凭据。
function node(script, env = checkEnvironment()) {
  return [process.execPath, ['-e', script], env];
}

// 让子进程按块写出文本：每块单独 write，避免一次写出时缓冲区切分不可控。
function chunkedScript(chunks) {
  return chunks.map(chunk => `process.stdout.write(${JSON.stringify(chunk)});`).join('');
}

test('真实子进程的非零退出码原样返回，不抛错', async t => {
  const root = await fixture(t);
  const [executable, args] = node(`process.stderr.write('失败原因\\n'); process.exit(3);`);
  const result = await runProgram(executable, args, { root, timeoutMs: 30000 });
  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
  assert.equal(result.stderr, '失败原因\n');
});

test('输出超过上限时只保留尾部并标记截断', async t => {
  const root = await fixture(t);
  const maxOutput = 1024;
  const head = 'H'.repeat(maxOutput * 2);
  const tail = 'T'.repeat(maxOutput * 2);
  // 分两块写：开头一大段 H，结尾一大段 T。无论 Pipe 怎么切分数据，保留尾部的结果里
  // 只可能出现尾部窗口内的内容，H 段整体落在窗口之外，必须被裁掉。
  const script = chunkedScript([head, tail]);
  const [executable, args] = node(script);
  const result = await runProgram(executable, args, { root, maxOutput, timeoutMs: 30000 });
  assert.equal(result.code, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.stdout.length, maxOutput, 'stdout 没有按上限裁剪');
  // 保留的是尾巴：窗口只留得下 1024 个字符，正好是 T 段的最末 1024 个。
  assert.equal(result.stdout, 'T'.repeat(maxOutput), 'stdout 没有保留尾部');
  // 头部第一块必须以独立标记确认被丢弃：H 段任意位置都不该出现（H 段总长 2×上限，超出窗口）。
  assert.ok(!result.stdout.includes('H'), 'stdout 保留了开头而不是尾部');

  // stderr 用另一半标记，验证两路各自截断、各自标记。
  const stderrScript = [
    `process.stderr.write(${JSON.stringify('S'.repeat(maxOutput * 2))});`,
    `process.stderr.write(${JSON.stringify('E'.repeat(maxOutput * 2))});`,
  ].join('');
  const [errExecutable, errArgs] = node(stderrScript);
  const errResult = await runProgram(errExecutable, errArgs, { root, maxOutput, timeoutMs: 30000 });
  assert.equal(errResult.code, 0);
  assert.equal(errResult.truncated, true);
  assert.equal(errResult.stderr.length, maxOutput, 'stderr 没有按上限裁剪');
  assert.equal(errResult.stderr, 'E'.repeat(maxOutput), 'stderr 没有保留尾部');
  assert.ok(!errResult.stderr.includes('S'), 'stderr 保留了开头而不是尾部');
});

test('输出未超过上限时不标记截断', async t => {
  const root = await fixture(t);
  const [executable, args] = node(`process.stdout.write('短输出');`);
  const result = await runProgram(executable, args, { root, maxOutput: 1024, timeoutMs: 30000 });
  assert.equal(result.truncated, false);
  assert.equal(result.stdout, '短输出');
});

test('进程超时被结束并返回 124', async t => {
  const root = await fixture(t);
  const started = Date.now();
  const [executable, args] = node(`process.stdout.write('开始\\n'); setTimeout(() => {}, 60000);`);
  const result = await runProgram(executable, args, { root, timeoutMs: 800 });
  assert.equal(result.code, 124);
  assert.equal(result.timedOut, true);
  assert.equal(result.truncated, false);
  assert.ok(result.stdout.includes('开始'));
  // 超时后应该及时返回，而不是等子进程自己跑完。
  assert.ok(Date.now() - started < 30000, '超时后没有及时返回');
});

test('checkEnvironment 删除 API 凭据但保留 PATH 与 TEMP', async t => {
  const root = await fixture(t);
  const temp = tmpdir();
  const env = {
    PATH: path.dirname(process.execPath),
    TEMP: temp,
    TMP: temp,
    ...(process.platform === 'win32' ? { PATHEXT: '.EXE;.CMD', SystemRoot: process.env.SystemRoot } : { TMPDIR: temp }),
    OPENAI_API_KEY: 'fake-openai-key',
    CODEX_API_KEY: 'fake-codex-key',
    API_KEY: 'fake-generic-key',
    GITHUB_TOKEN: 'fake-token',
    AWS_SECRET_ACCESS_KEY: 'fake-secret',
    CODEX_DISPATCH_HOME: path.join(root, 'home'),
  };
  const stripped = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'CODEX_DISPATCH_HOME'];
  const cleaned = checkEnvironment(env);
  for (const key of stripped) assert.equal(key in cleaned, false, key);
  assert.equal(cleaned.PATH, env.PATH);
  assert.equal(cleaned.TEMP, env.TEMP);
  if (process.platform === 'win32') { assert.equal(cleaned.PATHEXT, env.PATHEXT); assert.equal(cleaned.SystemRoot, env.SystemRoot); }
  else assert.equal(cleaned.TMPDIR, env.TMPDIR);

  // 真实子进程核对：凭据确实没传进去，PATH/TEMP 还在（Windows 的 PATH/TEMP 大小写不同也能取到）。
  const probe = [
    `process.stdout.write(JSON.stringify({`,
    `key: process.env.OPENAI_API_KEY ?? null,`,
    `token: process.env.GITHUB_TOKEN ?? null,`,
    `path: Boolean(process.env.PATH),`,
    `temp: Boolean(process.env.TEMP ?? process.env.TMPDIR),`,
    `}));`,
  ].join('');
  const result = await runProgram(process.execPath, ['-e', probe], { root, env: cleaned, timeoutMs: 30000 });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { key: null, token: null, path: true, temp: true });
});
