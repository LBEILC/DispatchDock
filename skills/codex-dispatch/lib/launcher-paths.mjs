import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function macLauncherDirectories(env, { systemDirectories = ['/opt/homebrew/bin', '/usr/local/bin'], runtimePath = process.execPath, home = env.HOME || env.USERPROFILE || homedir(), versionLimit = 32 } = {}) {
  const dirs = [], add = file => { if (typeof file === 'string' && isAbsolute(file)) dirs.push(resolve(file)); };
  if (runtimePath) add(dirname(runtimePath));
  for (const key of ['NVM_BIN', 'PNPM_HOME']) add(env[key]);
  for (const key of ['NPM_CONFIG_PREFIX', 'npm_config_prefix', 'VOLTA_HOME']) if (env[key]) add(join(env[key], 'bin'));
  if (env.FNM_MULTISHELL_PATH) add(join(env.FNM_MULTISHELL_PATH, 'bin'));
  for (const dir of systemDirectories) add(dir);
  const roots = [];
  if (home && isAbsolute(home)) {
    for (const suffix of ['.local/bin', '.npm-global/bin', '.npm/bin', '.volta/bin', 'Library/pnpm', '.local/share/pnpm', '.yarn/bin', '.bun/bin', '.n/bin']) add(join(home, suffix));
    roots.push([join(home, '.nvm/versions/node'), 'bin'], [join(home, '.config/nvm/versions/node'), 'bin'],
      [join(home, 'Library/Application Support/fnm/node-versions'), 'installation/bin'], [join(home, '.local/share/fnm/node-versions'), 'installation/bin'],
      [join(home, '.asdf/installs/nodejs'), 'bin'], [join(home, '.local/share/mise/installs/node'), 'bin']);
  }
  for (const [base, suffix, bin] of [
    [env.NVM_DIR, 'versions/node', 'bin'], [env.XDG_CONFIG_HOME, 'nvm/versions/node', 'bin'],
    [env.FNM_DIR, 'node-versions', 'installation/bin'], [env.ASDF_DATA_DIR, 'installs/nodejs', 'bin'],
    [env.MISE_DATA_DIR, 'installs/node', 'bin'],
  ]) if (base && isAbsolute(base)) roots.unshift([join(base, suffix), bin]);
  const seen = new Set();
  // 只看已知安装位置的一层版本目录，不执行 shell 配置，也不递归搜索用户文件。
  for (const [root, bin] of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    let versions;
    try { versions = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    versions.filter(v => (v.isDirectory() || v.isSymbolicLink()) && /^v?\d+(?:\.\d+){1,2}$/.test(v.name))
      .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true })).slice(0, Math.max(0, Math.min(32, versionLimit)))
      .forEach(v => add(join(root, v.name, bin)));
  }
  return [...new Set(dirs)];
}
