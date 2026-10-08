import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateRawSync, crc32 } from 'node:zlib';
import { packSkills, zip } from '../tools/pack-skills.mjs';
import { exportPublic } from '../tools/export-public.mjs';

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'dispatchdock-release-'));
  t.after(() => { assert.equal(path.dirname(base), path.resolve(tmpdir())); rmSync(base, { recursive: true, force: true, maxRetries: 5 }); });
  const root = path.join(base, 'repo'), out = path.join(base, 'public'); mkdirSync(root);
  const put = (name, bytes) => { const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes); };
  const git = args => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true }); assert.equal(result.status, 0, result.stderr); };
  return { base, root, out, put, git };
}
test('公开导出只包含跟踪文件，排除内部目录、忽略文件与未跟踪文件', async t => {
  const s = fixture(t); s.git(['init', '-q']);
  for (const name of ['keep.txt', 'docs/protocol.md', 'docs/internal.md', 'docs/handoff.md', 'docs/specs/a.md', '.claude/a.md', 'ignored.txt']) s.put(name, '公开内容');
  s.put('docs/internal.md', '```forbidden\nsynthetic-private-token\n```\n');
  s.put('.gitignore', 'ignored.txt\n');
  s.git(['add', '--', 'keep.txt', 'docs/protocol.md', 'docs/internal.md', 'docs/handoff.md', 'docs/specs/a.md', '.claude/a.md', '.gitignore']);
  s.git(['add', '-f', '--', 'ignored.txt']); s.put('untracked.txt', '不公开');
  const result = await exportPublic(s.root, s.out, () => {});
  assert.deepEqual(result.files, ['.gitignore', 'docs/protocol.md', 'keep.txt']);
  assert.equal(readFileSync(path.join(s.out, 'keep.txt'), 'utf8'), '公开内容');
  await assert.rejects(exportPublic(s.root, s.out, () => {}), /为空目录/);
});
test('公开扫描大小写不敏感，文本有行号，二进制也扫描且不泄露原文', async t => {
  const s = fixture(t); s.git(['init', '-q']);
  s.put('docs/internal.md', '```forbidden\nsynthetic-private-token\nsynthetic\\s+across\n```\n');
  s.put('text.txt', '第一行\nSYNTHETIC-PRIVATE-TOKEN\nsynthetic\nacross\n');
  s.put('image.bin', Buffer.from('\0synthetic-private-token\xff', 'latin1'));
  s.git(['add', '--', 'docs/internal.md', 'text.txt', 'image.bin']);
  await assert.rejects(exportPublic(s.root, s.out, () => {}), error => {
    assert.match(error.message, /text.txt:2：规则 1/); assert.match(error.message, /image.bin：规则 1（二进制）/);
    assert.match(error.message, /text.txt:3：规则 2/);
    assert.doesNotMatch(error.message, /synthetic-private-token/i); return true;
  });
  assert.equal(existsSync(s.out), false);
});
test('公开清单不存在时提示跳过；损坏清单必须失败', async t => {
  const s = fixture(t); s.git(['init', '-q']); s.put('ok.txt', 'ok'); s.git(['add', '--', 'ok.txt']);
  const logs = []; await exportPublic(s.root, s.out, line => logs.push(line));
  assert.equal(logs[0], '没有内部禁用词清单，跳过扫描');
  s.put('docs/internal.md', '```forbidden\n[\n```\n');
  await assert.rejects(exportPublic(s.root, path.join(s.base, 'invalid'), () => {}), /规则 1 无效/);
});

// 用中央目录独立读取 ZIP，并同时核对本地头、CRC 与解压长度。
function extract(bytes, target) {
  const end = bytes.length - 22; assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  let at = bytes.readUInt32LE(end + 16); const names = [];
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const length = bytes.readUInt16LE(at + 28), name = bytes.subarray(at + 46, at + 46 + length).toString('utf8');
    const local = bytes.readUInt32LE(at + 42); assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt16LE(local + 6), 0x800); assert.equal(bytes.readUInt16LE(at + 10), 8);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = inflateRawSync(bytes.subarray(start, start + bytes.readUInt32LE(at + 20)));
    assert.equal(raw.length, bytes.readUInt32LE(at + 24)); assert.equal(crc32(raw), bytes.readUInt32LE(at + 16));
    assert.ok(!name.includes('..') && !path.isAbsolute(name));
    const file = path.join(target, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, raw); names.push(name);
    at += 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  assert.equal(at, end); return names;
}
test('技能 ZIP 解压后无需依赖即可 --yes 安装并 --status 确认两个宿主', async t => {
  const s = fixture(t), source = path.resolve('.');
  const result = await packSkills(source, path.join(s.base, 'release'));
  const bytes = readFileSync(path.join(s.base, 'release', result.filename));
  const unpacked = path.join(s.base, 'unpacked'), names = extract(bytes, unpacked);
  assert.ok(names.includes('LICENSE')); assert.ok(names.includes('installer/install.mjs'));
  assert.ok(names.every(name => /^(skills\/|installer\/|package.json$|LICENSE$|THIRD_PARTY_NOTICES.md$|README(?:.en)?.md$)/.test(name)));
  const env = { ...process.env, CODEX_DISPATCH_HOME: path.join(s.base, 'dispatch'), USERPROFILE: path.join(s.base, 'user'), HOME: path.join(s.base, 'user'),
    APPDATA: path.join(s.base, 'appdata'), CLAUDE_CONFIG_DIR: path.join(s.base, 'claude'), CODEX_HOME: path.join(s.base, 'codex'), XDG_CONFIG_HOME: path.join(s.base, 'xdg') };
  for (const dir of [env.CLAUDE_CONFIG_DIR, path.join(env.APPDATA, 'devin'), path.join(env.XDG_CONFIG_HOME, 'devin')]) mkdirSync(dir, { recursive: true });
  const run = args => { const r = spawnSync(process.execPath, ['installer/install.mjs', ...args], { cwd: unpacked, env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  run(['--yes']); const status = run(['--status']);
  // 版本号取 package.json，升版本时不用改测试
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const installed = name => status.split('\n').filter(line => line.trim().split(/\s+/).join(' ') === `${name} ${version}`).length;
  assert.equal(installed('codex-dispatch'), 2);
  assert.equal(installed('dual-role-workflow'), 2);
  assert.equal(existsSync(path.join(unpacked, 'node_modules')), false);
});
test('ZIP 支持中文名称、空文件并可重复生成', t => {
  const s = fixture(t), entries = [{ name: '中文/空文件.txt', bytes: Buffer.alloc(0) }];
  assert.deepEqual(zip(entries), zip(entries));
  assert.deepEqual(extract(zip(entries), s.out), ['中文/空文件.txt']);
});
test('dist 字体缺失或哈希不符时在构建前失败并提示准备字体', t => {
  const s = fixture(t);
  for (const name of ['dist.mjs', 'fonts.mjs']) s.put(`tools/${name}`, readFileSync(path.resolve('tools', name)));
  for (const invalid of [null, '错误字体']) {
    if (invalid) s.put('build/fonts/MiSansVF.ttf', invalid);
    const result = spawnSync(process.execPath, ['tools/dist.mjs'], { cwd: s.root, encoding: 'utf8', windowsHide: true, shell: false });
    assert.equal(result.status, 1); assert.match(result.stderr, /npm run fonts/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  }
});
