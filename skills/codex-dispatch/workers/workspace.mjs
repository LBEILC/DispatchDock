import { lstat, mkdir, realpath, rename, open, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProgram, checkEnvironment } from '../lib/program.mjs';

export const blockedPath = value => value.split(/[\\/]/).some(name => /^(?:\.git|\.env(?:\..*)?|\.codex-runs|node_modules|credentials(?:\..*)?|auth\.json|AGENTS\.md|CLAUDE\.md)$/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name));
export const within = (root, target) => { const part = path.relative(root, target); return !path.isAbsolute(part) && part !== '..' && !part.startsWith(`..${path.sep}`); };
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;

export function validFile(file) {
  return typeof file === 'string' && !!file && !path.isAbsolute(file) && !/[\\<>:"|?*\x00-\x1f]/.test(file) && !file.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) && !blockedPath(file);
}

export function validatePolicy(policy) {
  if (!policy || policy.v !== 1 || !Array.isArray(policy.files) || !policy.files.length || !policy.files.every(validFile)) throw Error('可写策略必须列出明确的仓库内文件');
  if (policy.readFiles !== undefined && (!Array.isArray(policy.readFiles) || !policy.readFiles.every(file => validFile(file) || file === 'AGENTS.md'))) throw Error('读取上下文必须是明确的普通仓库文件');
  if (!Array.isArray(policy.checks) || policy.checks.some(check => !check || !/^[a-z][a-z0-9-]*$/.test(check.name) || (check.executable !== '@node' && !path.isAbsolute(check.executable)) || /\.(cmd|bat|ps1)$/i.test(check.executable) || !Array.isArray(check.args) || !check.args.every(arg => typeof arg === 'string' && !arg.includes('\0')) || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 100 || check.timeoutMs > 600000)) throw Error('检查命令必须为明确的可执行文件和参数数组');
  return policy;
}

export async function writeTool(root, policy, args) {
  validatePolicy(policy); root = await realpath(root);
  if (!args || !validFile(args.path) || !policy.files.some(file => key(file) === key(args.path)) || typeof args.content !== 'string' || Buffer.byteLength(args.content) > 256 * 1024) throw Error('文件不在允许修改的清单内，或内容超过上限');
  const target = path.resolve(root, args.path);
  if (!within(root, target)) throw Error('文件在仓库之外');
  // 不跟随可写目录内的联接，也不覆盖硬链接，避免修改同一份外部数据。
  let current = root;
  for (const part of args.path.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try { const info = await lstat(current); if (!info.isDirectory() || info.isSymbolicLink()) throw Error('父目录不是普通目录'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(current); }
    if (!within(root, await realpath(current))) throw Error('父目录在仓库之外');
  }
  let existed = false, mode = 0o666;
  try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('目标不是独立普通文件'); existed = true; mode = info.mode & 0o777; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = path.join(path.dirname(target), `.dispatch-write-${randomUUID()}`);
  try {
    const handle = await open(temp, 'wx', mode);
    try { await handle.writeFile(args.content, 'utf8'); } finally { await handle.close(); }
    await rename(temp, target);
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { path: args.path, kind: existed ? 'update' : 'add' };
}

export async function runCheck(root, check, env = process.env) {
  const result = await runProgram(check.executable === '@node' ? process.execPath : check.executable, check.args, { root, env: checkEnvironment(env), timeoutMs: check.timeoutMs });
  return { name: check.name, ...result };
}

export async function replaceTool(root, policy, args) {
  validatePolicy(policy); root = await realpath(root);
  if (!args || !validFile(args.path) || !policy.files.some(file => key(file) === key(args.path)) || typeof args.old_text !== 'string' || !args.old_text || typeof args.new_text !== 'string') throw Error('替换需要授权文件和非空原文');
  const target = path.resolve(root, args.path), actual = await realpath(target), info = await lstat(target);
  if (!within(root, actual) || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 256 * 1024) throw Error('替换目标不是允许的普通文件');
  const text = await readFile(target, 'utf8'), index = text.indexOf(args.old_text);
  if (index < 0 || text.indexOf(args.old_text, index + args.old_text.length) !== -1) throw Error('原文必须精确匹配一次，请重新读取后替换');
  return writeTool(root, policy, { path: args.path, content: text.slice(0, index) + args.new_text + text.slice(index + args.old_text.length) });
}
