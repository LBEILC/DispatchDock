import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export function userDirectory(env = process.env, platform = process.platform) {
  return (platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE) || homedir();
}
export function homeDirectory(env = process.env, platform = process.platform) {
  if (env.CODEX_DISPATCH_HOME) return resolve(env.CODEX_DISPATCH_HOME);
  return platform === 'win32'
    ? join(env.APPDATA || join(userDirectory(env, platform), 'AppData', 'Roaming'), 'codex-dispatch')
    : join(env.XDG_CONFIG_HOME || join(userDirectory(env, platform), '.config'), 'codex-dispatch');
}
export const defaults = { model: null, effort: null, tier: null, sandbox: 'workspace-write', path: null, watchWindow: 'auto' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function readConfig(home) {
  const file = join(home, 'config.json');
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) { return { file, exists: error.code !== 'ENOENT', config: {}, reason: error.code === 'ENOENT' ? null : `读取失败：${error.code}` }; }
  let config;
  try { config = JSON.parse(text); }
  catch { return { file, exists: true, config: {}, reason: '不是有效的 JSON' }; }
  if (!object(config) || config.v !== 1) return { file, exists: true, config: {}, reason: 'v 不是 1' };
  return { file, exists: true, config, reason: null };
}
function validate(key, value, source) {
  if (key === 'managed') { if (typeof value !== 'boolean') throw new Error(`${source} 的 managed 必须为布尔值`); return; }
  if (value == null) return;
  if (typeof value !== 'string') throw new Error(`${source} 的 ${key} 必须为字符串或 null`);
  if (key === 'watchWindow' && !['auto', 'always', 'never'].includes(value)) throw new Error(`${source} 的 watchWindow 必须为 auto、always 或 never`);
  if (key === 'path' && !isAbsolute(value)) throw new Error(`${source} 的 path 必须是绝对路径`);
}
export function resolveSettings(config, opts = {}, env = {}) {
  if (config.managed !== undefined) validate('managed', config.managed, 'config.json');
  if (config.agents != null && !object(config.agents)) throw new Error('config.json 的 agents 必须为对象');
  if (config.agents?.codex != null && !object(config.agents.codex)) throw new Error('config.json 的 agents.codex 必须为对象');
  const agent = config.agents?.codex ?? {}, settings = {}, sources = {};
  for (const key of Object.keys(defaults)) {
    const fromFile = key === 'watchWindow' ? config.watchWindow : agent[key];
    validate(key, fromFile, 'config.json');
    const option = key === 'watchWindow' ? opts['watch-window'] : key === 'path' ? undefined : opts[key];
    const envName = key === 'watchWindow' ? 'CODEX_NO_WATCH' : `CODEX_${key.toUpperCase()}`;
    const fromEnv = key === 'path' ? undefined : key === 'watchWindow' ? (env[envName] ? 'never' : undefined) : (env[envName] || undefined);
    validate(key, fromEnv, `环境变量 ${envName}`); validate(key, option, '命令行');
    const value = option ?? fromEnv ?? fromFile;
    settings[key] = value == null ? defaults[key] : value;
    sources[key] = option != null ? '命令行' : fromEnv != null ? `环境变量 ${envName}` : fromFile !== undefined ? 'config.json' : '内置默认';
  }
  return { settings, sources };
}
export function loadConfig(home, opts = {}, env = process.env) {
  const state = readConfig(home);
  const warning = state.reason ? `配置：config.json 无法读取（${state.reason}），本次按内置默认运行`
    : !state.exists ? '配置：未找到 config.json，模型、强度、档位跟随 Codex 自己的配置' : null;
  return { ...state, ...resolveSettings(state.config, opts, env), warning };
}
export function writeConfig(home, changes = {}, { init = false } = {}) {
  const state = readConfig(home);
  if (init && state.exists) return { ...state, unchanged: true };
  if (state.reason) throw new Error(`无法读取（${state.reason}），请先修好或删掉 config.json`);
  for (const [key, value] of Object.entries(changes)) {
    if (key !== 'managed' && !Object.hasOwn(defaults, key)) throw new Error(`未知配置键：${key}`);
    validate(key, value, '命令行');
  }
  resolveSettings(state.config);
  const config = state.exists ? state.config : { v: 1, agents: { codex: { model: null, effort: null, tier: null, sandbox: 'workspace-write' } }, watchWindow: 'auto', managed: false };
  config.agents ??= {}; config.agents.codex ??= {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'watchWindow' || key === 'managed') config[key] = value;
    else config.agents.codex[key] = value;
  }
  config.v = 1;
  mkdirSync(home, { recursive: true });
  const temp = join(home, `.config-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temp, state.file);
  } finally { rmSync(temp, { force: true }); }
  return readConfig(home);
}
export function formatConfig(home, env = process.env) {
  const state = loadConfig(home, {}, env);
  const lines = [`配置文件：${state.file}（${state.exists ? '已存在' : '不存在'}）`];
  if (state.reason) lines.push(`无法读取（${state.reason}）`);
  // 中文字符占两列；保留原有列宽，不引入终端格式化依赖。
  const padColumn = (text, width) => {
    const length = [...text].reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0);
    return text + ' '.repeat(Math.max(0, width - length));
  };
  for (const [key, value] of Object.entries(state.settings)) lines.push(`${padColumn(key, 13)}${padColumn(String(value ?? (key === 'path' ? '自动查找' : '跟随 Codex')), 22)}${state.sources[key]}`);
  return lines.join('\n');
}
export function configCommand(args, env = process.env) {
  const home = homeDirectory(env);
  let message = '';
  if (args.length === 1 && args[0] === 'init') {
    if (writeConfig(home, {}, { init: true }).unchanged) message = 'config.json 已存在\n';
  } else if (args.length) {
    const changes = {};
    for (const arg of args) {
      const at = arg.indexOf('=');
      if (at < 1) throw new Error(`配置参数必须为 键=值：${arg}`);
      changes[arg.slice(0, at)] = arg.slice(at + 1) === '-' ? null : arg.slice(at + 1);
    }
    writeConfig(home, changes);
  }
  return message + formatConfig(home, env);
}
