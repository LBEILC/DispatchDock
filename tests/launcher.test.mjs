import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter, resolve } from 'node:path';
import { resolveLauncher, codex } from '../skills/codex-dispatch/adapters/codex.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'dispatchdock-launcher-')), home = join(base, 'home');
  mkdirSync(home);
  const env = { HOME: home, USERPROFILE: home, PATH: '' };
  const options = { systemDirectories: [join(base, 'homebrew-arm/bin'), join(base, 'homebrew-intel/bin')], runtimePath: join(base, 'runtime/bin/node') };
  const put = (file, text = '隔离假程序') => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
  const find = () => resolveLauncher(env, 'darwin', null, options);
  t.after(() => { assert.equal(dirname(base), resolve(tmpdir())); rmSync(base, { recursive: true, force: true }); });
  return { base, home, env, options, put, find };
}

for (const systemPath of [false, true]) test(`Finder ${systemPath ? '系统' : '空'} PATH 自动找到 Homebrew 安装`, t => {
  const f = fixture(t), file = f.put(join(f.options.systemDirectories[0], 'codex'));
  if (systemPath) f.env.PATH = [join(f.base, 'usr/bin'), join(f.base, 'bin')].join(delimiter);
  assert.deepEqual(f.find(), { executable: file, args: [] });
});

test('配置和 PATH 优先于 macOS 回退，错误的显式配置不被覆盖', t => {
  const f = fixture(t), configured = f.put(join(f.base, 'configured/codex')), path = f.put(join(f.base, 'path/codex'));
  f.put(join(f.options.systemDirectories[0], 'codex'));
  f.env.PATH = dirname(path);
  assert.equal(resolveLauncher(f.env, 'darwin', configured, f.options).executable, configured);
  assert.equal(f.find().executable, path);
  assert.throws(() => resolveLauncher(f.env, 'darwin', join(f.base, 'missing'), f.options), /agents.codex.path/);
});

test('假 agent 注入仍先于 PATH 和 macOS 回退', t => {
  const f = fixture(t), agent = f.put(join(f.base, 'fake.mjs'));
  f.put(join(f.options.systemDirectories[0], 'codex'));
  f.env.CODEX_DISPATCH_TEST_AGENT = agent;
  assert.deepEqual(f.find(), { executable: process.execPath, args: [agent] });
});

for (const suffix of ['.local/bin', '.npm-global/bin', '.npm/bin', '.volta/bin', 'Library/pnpm', '.local/share/pnpm', '.yarn/bin', '.bun/bin', '.n/bin']) test(`Finder 检测用户安装目录 ${suffix}`, t => {
  const f = fixture(t), file = f.put(join(f.home, suffix, 'codex'));
  assert.equal(f.find().executable, file);
});

test('Node 相邻目录可找到 Codex', t => {
  const f = fixture(t), file = f.put(join(dirname(f.options.runtimePath), 'codex'));
  assert.equal(f.find().executable, file);
});

for (const [key, suffix] of [['NVM_BIN', ''], ['PNPM_HOME', ''], ['NPM_CONFIG_PREFIX', 'bin'], ['npm_config_prefix', 'bin'], ['VOLTA_HOME', 'bin'], ['FNM_MULTISHELL_PATH', 'bin']]) test(`Finder 使用已有 ${key} 安装线索`, t => {
  const f = fixture(t), prefix = join(f.base, 'custom-install');
  f.env[key] = prefix;
  const file = f.put(join(prefix, suffix, 'codex'));
  assert.equal(f.find().executable, file);
});

for (const [label, suffix] of [
  ['nvm', '.nvm/versions/node/v24.1.0/bin'], ['nvm XDG', '.config/nvm/versions/node/v24.1.0/bin'],
  ['fnm macOS', 'Library/Application Support/fnm/node-versions/v24.1.0/installation/bin'],
  ['fnm XDG', '.local/share/fnm/node-versions/v24.1.0/installation/bin'],
  ['asdf', '.asdf/installs/nodejs/24.1.0/bin'], ['mise', '.local/share/mise/installs/node/24.1.0/bin'],
]) test(`Finder 检测 ${label} 已安装的 Node 版本`, t => {
  const f = fixture(t), file = f.put(join(f.home, suffix, 'codex'));
  assert.equal(f.find().executable, file);
});

test('版本目录按数字降序查找，扫描数量可以收紧', t => {
  const f = fixture(t), root = join(f.home, '.nvm/versions/node');
  f.put(join(root, 'v9.0.0/bin/codex'));
  const newest = f.put(join(root, 'v24.0.0/bin/codex'));
  assert.equal(f.find().executable, newest);
  f.options.versionLimit = 1;
  mkdirSync(join(root, 'v26.0.0/bin'), { recursive: true });
  assert.throws(f.find, /agents.codex.path/);
});

test('每个版本目录根最多探测 32 个安装版本', t => {
  const f = fixture(t), root = join(f.home, '.nvm/versions/node');
  f.put(join(root, 'v0.0.0/bin/codex'));
  for (let i = 1; i <= 33; i++) mkdirSync(join(root, `v${i}.0.0/bin`), { recursive: true });
  assert.throws(f.find, /agents.codex.path/);
  f.options.versionLimit = 100;
  assert.throws(f.find, /agents.codex.path/);
});

for (const [key, suffix] of [
  ['NVM_DIR', 'versions/node/v24.1.0/bin'], ['XDG_CONFIG_HOME', 'nvm/versions/node/v24.1.0/bin'],
  ['FNM_DIR', 'node-versions/v24.1.0/installation/bin'], ['ASDF_DATA_DIR', 'installs/nodejs/24.1.0/bin'], ['MISE_DATA_DIR', 'installs/node/24.1.0/bin'],
]) test(`使用 ${key} 指定的 Node 版本目录`, t => {
  const f = fixture(t), prefix = join(f.base, 'custom-versions');
  f.env[key] = prefix;
  const file = f.put(join(prefix, suffix, 'codex'));
  assert.equal(f.find().executable, file);
});

test('macOS 回退不改变 Windows 或 Linux 的查找范围', t => {
  const f = fixture(t);
  f.put(join(f.options.systemDirectories[0], 'codex'));
  for (const platform of ['win32', 'linux']) assert.throws(() => resolveLauncher(f.env, platform, null, f.options), /找不到 Codex CLI/);
});

test('找不到时保留手动指定路径的提示，不运行 shell 配置', t => {
  const f = fixture(t), marker = join(f.base, '不应创建');
  f.put(join(f.home, '.zshrc'), `touch '${marker}'`);
  const result = codex.detect({ env: f.env, platform: 'darwin', launcherOptions: f.options });
  assert.equal(result.installed, false);
  assert.match(result.error, /agents.codex.path/);
  assert.equal(existsSync(marker), false);
});

test('Finder 无 Node PATH 时可检测到回退目录中的 npm 符号链接', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), entry = f.put(join(f.base, 'package/bin/codex.mjs'), "console.log('codex-cli fake-finder');");
  const bin = f.options.systemDirectories[0]; mkdirSync(bin, { recursive: true }); symlinkSync(entry, join(bin, 'codex'));
  const result = codex.detect({ env: f.env, platform: 'darwin', launcherOptions: f.options });
  assert.equal(result.installed, true);
  assert.equal(result.version, 'codex-cli fake-finder');
  assert.equal(result.launcher.executable, process.execPath);
});
