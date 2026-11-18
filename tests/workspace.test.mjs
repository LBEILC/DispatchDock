import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { writeTool, validFile, runCheck } from '../skills/codex-dispatch/workers/workspace.mjs';

async function fixture(t) { const base = await mkdtemp(path.join(tmpdir(), 'dispatchdock-write-')); t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5 })); const root = path.join(base, 'repo'); await mkdir(root); return { base, root }; }
const policy = files => ({ v: 1, files, checks: [] });
test('授权写入只影响明确文件，保留其他内容和可执行位', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'keep.txt'), '保留');
  assert.deepEqual(await writeTool(root, policy(['src/new.mjs']), { path: 'src/new.mjs', content: 'export const answer = 42;\n' }), { path: 'src/new.mjs', kind: 'add' });
  await assert.rejects(writeTool(root, policy(['src/new.mjs']), { path: 'keep.txt', content: '不允许' }), /清单/);
  assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), '保留');
  if (process.platform !== 'win32') { await chmod(path.join(root, 'src/new.mjs'), 0o755); await writeTool(root, policy(['src/new.mjs']), { path: 'src/new.mjs', content: 'changed' }); assert.equal((await stat(path.join(root, 'src/new.mjs'))).mode & 0o777, 0o755); }
});
test('可写路径拒绝系统保留名、敏感目录、链接与硬链接', async t => {
  const { base, root } = await fixture(t);
  for (const file of ['../x', '/x', '.env', '.git/config', 'a:stream', 'NUL.txt', '.git /config', 'AGENTS.md', 'nested/../file', 'x\\file']) assert.equal(validFile(file), false, file);
  await writeFile(path.join(base, 'outside.txt'), '原件');
  await symlink(base, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writeTool(root, policy(['linked/outside.txt']), { path: 'linked/outside.txt', content: '修改' }), /目录/);
  await link(path.join(base, 'outside.txt'), path.join(root, 'hard.txt'));
  await assert.rejects(writeTool(root, policy(['hard.txt']), { path: 'hard.txt', content: '修改' }), /普通文件/);
  assert.equal(await readFile(path.join(base, 'outside.txt'), 'utf8'), '原件');
});
test('授权检查通过参数数组运行，不继承任何 API 密钥', async t => {
  const { root } = await fixture(t);
  const result = await runCheck(root, { name: 'env', executable: process.execPath, args: ['-e', 'console.log(JSON.stringify({key:process.env.DEEPSEEK_API_KEY,arg:process.argv[1]}))', 'literal $(value)'], timeoutMs: 5000 }, { ...process.env, DEEPSEEK_API_KEY: 'fake-key' });
  assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { arg: 'literal $(value)' });
});
