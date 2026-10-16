import fs from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homeDirectory, userDirectory } from '../../skills/codex-dispatch/lib/config.mjs';
import { composeSkill } from './compose.mjs';

export const skills = ['codex-dispatch', 'dual-role-workflow'];
export const hosts = ['claude-code', 'devin'];
export const project = fileURLToPath(new URL('../../', import.meta.url));
export const version = JSON.parse(fs.readFileSync(join(project, 'package.json'), 'utf8')).version;
const marker = '.dispatchdock.json';
const hash = data => createHash('sha256').update(data).digest('hex');
const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const directory = file => !!file && exists(file) && fs.statSync(file).isDirectory();
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function detectHosts({ env = process.env, platform = process.platform, claudeDir, devinDir } = {}) {
  const user = userDirectory(env, platform);
  const claude = env.CLAUDE_CONFIG_DIR || join(user, '.claude');
  // 官方技能文档指定 Unix 的全局位置为 ~/.config/devin/skills。
  const devin = platform === 'win32' ? (env.APPDATA && join(env.APPDATA, 'devin')) : join(user, '.config', 'devin');
  return [
    { host: 'claude-code', root: resolve(claudeDir || join(claude, 'skills')), detected: directory(claudeDir || claude), supported: true },
    { host: 'devin', root: devinDir ? resolve(devinDir) : devin ? resolve(devin, 'skills') : null, detected: directory(devinDir || devin), supported: !!(devinDir || devin) },
  ];
}

// 所有递归删除都必须严格位于预期父目录下，且不能删除父目录本身。
function removeWithin(parent, target) {
  const rel = relative(resolve(parent), resolve(target));
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('拒绝删除预期目录之外的路径');
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

const renameBlocked = error => ['EPERM', 'EBUSY', 'EXDEV'].includes(error.code);

function cleanStaleStaging(root) {
  try {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const target = join(root, entry.name);
      try { if (fs.lstatSync(target).mtimeMs < cutoff) removeWithin(root, target); }
      catch { /* 旧残留暂时被占用时留待下次清理。 */ }
    }
  } catch { /* staging 尚不存在或不可读时不影响本次操作。 */ }
}

function cleanStaged(staging, run, staged, failed) {
  let leftover = false;
  for (const stage of staged) {
    for (const target of [stage.temp, stage.old]) {
      // 恢复失败的旧目录保留，同时阻止删除所在批次。
      if (target === stage.old && stage.recoveryFailed) { leftover = true; continue; }
      try { removeWithin(run, target); }
      catch { leftover = true; failed(target); }
    }
  }
  // 子目录删不掉时保留批次容器，避免再次递归删除或重复报告父路径。
  if (!leftover) {
    try { removeWithin(staging, run); }
    catch { failed(run); }
  }
}

// 每项恢复和清理独立执行，保留原始异常及其错误码。
function attemptRecovery(error, target, action) {
  try { action(); return true; }
  catch { error.message += `\n未能恢复或清理：${target}`; return false; }
}

function replaceTree(root, files) {
  fs.mkdirSync(root, { recursive: true });
  const current = readTree(root);
  // 先清除多余项及文件/目录类型冲突，再覆盖；标记必须最后写入。
  for (const [name] of current) {
    if (!files.has(name)) removeWithin(root, join(root, name));
  }
  const ordered = new Map([...files].filter(([name]) => name !== marker));
  if (files.has(marker)) ordered.set(marker, files.get(marker));
  writeTree(root, ordered);
  for (const [name, entry] of ordered) {
    if (entry?.mode !== undefined) fs.chmodSync(join(root, name), entry.mode);
  }
}

export function readTree(root) {
  const files = new Map();
  function walk(dir, prefix = '') {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`不支持符号链接目录：${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, entry.name), name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`不支持符号链接：${file}`);
      if (entry.isDirectory()) { files.set(`${name}/`, null); walk(file, `${name}/`); }
      else if (entry.isFile()) files.set(name, { data: fs.readFileSync(file), mode: fs.statSync(file).mode });
      else throw new Error(`不支持的文件类型：${file}`);
    }
  }
  walk(root);
  return files;
}

function writeTree(root, files, onWrite = () => {}) {
  fs.mkdirSync(root, { recursive: true });
  for (const [name, entry] of files) {
    const file = join(root, name);
    if (entry === null) fs.mkdirSync(file, { recursive: true });
    else {
      onWrite(file);
      fs.mkdirSync(dirname(file), { recursive: true });
      fs.writeFileSync(file, entry.data, { mode: entry.mode });
    }
  }
}
const hashes = files => Object.fromEntries([...files].filter(([name, entry]) => entry && name !== marker).map(([name, entry]) => [name, hash(entry.data)]));

export function installationStatus(target, host, skill) {
  if (!exists(target)) return { state: 'missing', version: null, signature: null };
  const foreign = !exists(join(target, marker));
  let signature = null;
  try {
    const tree = readTree(target);
    signature = hash(JSON.stringify([...tree].map(([name, entry]) => [name, entry && hash(entry.data)])));
    if (foreign) return { state: 'foreign', version: null, signature };
    const record = json(join(target, marker));
    const actual = hashes(tree);
    const valid = record.v === 1 && record.host === host && record.skill === skill && typeof record.version === 'string' && Number.isFinite(record.installedAt)
      && record.files && Object.keys(actual).length === Object.keys(record.files).length
      && Object.entries(actual).every(([name, digest]) => record.files[name] === digest);
    return { state: valid ? 'owned' : 'modified', version: record.version ?? null, signature };
  } catch { return { state: foreign ? 'foreign' : 'modified', version: null, signature }; }
}

function select(options) {
  if (options.host && ![...hosts, 'all'].includes(options.host)) throw new Error('无效的 host');
  if (options.skill && ![...skills, 'all'].includes(options.skill)) throw new Error('无效的 skill');
  return detectHosts(options).filter(h => !options.host || options.host === 'all' || options.host === h.host);
}

export function getStatus(options = {}) {
  return select(options).map(h => ({ ...h, skills: skills.filter(s => !options.skill || options.skill === 'all' || options.skill === s)
    .map(skill => ({ skill, target: h.root && join(h.root, skill), ...(h.root ? installationStatus(join(h.root, skill), h.host, skill) : { state: 'missing', version: null }) })) }));
}

export function createPlan(options = {}) {
  const statuses = getStatus(options), items = [], warnings = [];
  for (const h of statuses) {
    if (!h.supported || (!h.detected && !options.host)) continue;
    for (const entry of h.skills) {
      const action = entry.state === 'missing' ? (options.uninstall ? 'skip' : 'install')
        : entry.state === 'owned' || options.replaceExisting ? (options.uninstall ? 'uninstall' : 'install') : 'skip';
      items.push({ ...entry, host: h.host, action });
    }
    if (!options.uninstall && options.skill === 'dual-role-workflow' && !exists(join(h.root, 'codex-dispatch'))) warnings.push({ host: h.host, dependency: 'codex-dispatch' });
  }
  // 先验证全部合成结果，再允许执行任何写入。
  if (!options.uninstall) for (const item of items.filter(i => i.action === 'install')) {
    const sourceRoot = options.sourceRoot || join(project, 'skills');
    const files = readTree(join(sourceRoot, item.skill));
    const overlay = join(sourceRoot, '_hosts', item.host, `${item.skill}.md`);
    files.set('SKILL.md', { data: Buffer.from(composeSkill(files.get('SKILL.md').data.toString('utf8'), item.host === 'claude-code' || !exists(overlay) ? '' : fs.readFileSync(overlay, 'utf8'))) });
    files.delete(marker);
    item.files = files;
  }
  return { version, statuses, items, warnings, reason: options.uninstall ? 'uninstall' : 'install' };
}

function backupBatch(items, home, reason) {
  if (!items.length) return null;
  const at = Date.now(), root = join(home, 'backups');
  fs.mkdirSync(root, { recursive: true });
  let stamp = at;
  while (exists(join(root, String(stamp)))) stamp++;
  const target = join(root, String(stamp)), temp = join(root, `.pending-${randomUUID()}`);
  try {
    fs.mkdirSync(temp);
    const records = items.map(i => ({ host: i.host, skill: i.skill, from: i.target, version: i.version, existed: exists(i.target) }));
    for (const item of records) {
      if (item.existed) writeTree(join(temp, item.host, item.skill), readTree(item.from));
    }
    fs.writeFileSync(join(temp, 'backup.json'), JSON.stringify({ v: 1, at, reason,
      items: records }, null, 2) + '\n');
    fs.renameSync(temp, target);
    return target;
  } catch (error) { attemptRecovery(error, temp, () => removeWithin(root, temp)); throw error; }
}

function backups(home) {
  const root = join(home, 'backups');
  if (!exists(root)) return [];
  return fs.readdirSync(root).filter(name => /^\d+$/.test(name) && exists(join(root, name, 'backup.json'))).sort((a, b) => Number(b) - Number(a)).map(name => join(root, name));
}

export function executePlan(plan, { env = process.env, platform = process.platform, onWrite, onCommit } = {}) {
  const home = homeDirectory(env, platform), staging = join(home, 'staging');
  cleanStaleStaging(staging);
  const active = plan.items.filter(i => i.action !== 'skip');
  if (!active.length) return { changed: [], backup: null, leftovers: [] };
  const targets = active.map(i => resolve(i.target));
  if (new Set(targets.map(s => platform === 'win32' ? s.toLowerCase() : s)).size !== targets.length) throw new Error('技能目标目录重复');
  // 计划可能在用户确认期间过期；不覆盖后来写入或修改的技能。
  for (const item of active) {
    const status = installationStatus(item.target, item.host, item.skill);
    if (status.state !== item.state || status.version !== item.version || status.signature !== item.signature) throw new Error('安装状态已变化，请重新生成计划');
  }
  const run = join(staging, randomUUID()), staged = [];
  let backup = null, obsolete = [];
  try {
    fs.mkdirSync(run, { recursive: true });
    for (const item of active) {
      const parent = dirname(item.target), token = randomUUID();
      const stage = { item, parent, temp: join(run, `.dispatchdock-new-${token}`), old: join(run, `.dispatchdock-old-${token}`), moved: false, installed: false };
      staged.push(stage);
      if (item.action === 'install' || item.action === 'restore') {
        const files = new Map(item.files);
        if (item.action === 'install') files.set(marker, { data: Buffer.from(JSON.stringify({ v: 1, version, host: item.host, skill: item.skill, installedAt: Date.now(), files: hashes(files) }, null, 2) + '\n') });
        writeTree(stage.temp, files, onWrite);
      }
    }
    backup = backupBatch(active, home, plan.reason || 'install');
    // 替换前确定待清理的旧批次，残留提示只列具体批次，不列整个备份根目录。
    obsolete = backups(home).slice(5);
    // 保留原样内容，替换过程中失败时仍可恢复整个批次。
    for (const stage of staged) stage.original = exists(stage.item.target) ? readTree(stage.item.target) : null;
    for (const stage of staged) {
      onCommit?.(stage.item.target);
      fs.mkdirSync(stage.parent, { recursive: true });
      try {
        if (exists(stage.item.target)) { fs.renameSync(stage.item.target, stage.old); stage.moved = true; }
        if (exists(stage.temp)) { fs.renameSync(stage.temp, stage.item.target); stage.installed = true; }
      } catch (error) {
        if (!renameBlocked(error)) throw error;
        stage.inPlace = true;
        if (stage.item.action === 'uninstall') {
          replaceTree(stage.item.target, new Map());
          removeWithin(stage.parent, stage.item.target);
        } else replaceTree(stage.item.target, readTree(stage.temp));
      }
    }
  } catch (error) {
    for (const stage of [...staged].reverse()) {
      if (stage.installed || stage.moved || stage.inPlace) {
        stage.recoveryFailed = !attemptRecovery(error, stage.item.target, () => {
          if (stage.original) replaceTree(stage.item.target, stage.original);
          else removeWithin(stage.parent, stage.item.target);
        });
      }
    }
    cleanStaged(staging, run, staged, target => { error.message += `\n未能恢复或清理：${target}`; });
    if (backup) {
      if (staged.some(stage => stage.recoveryFailed)) error.message += `\n原来的版本保留在备份 ${backup}，可用 node installer/install.mjs --rollback 撤销。`;
      else attemptRecovery(error, backup, () => removeWithin(join(home, 'backups'), backup));
    }
    throw error;
  }
  // 全部替换完成后，清理失败只报告残留，不撤销已提交的更新。
  const leftovers = [];
  cleanStaged(staging, run, staged, target => leftovers.push(target));
  for (const old of obsolete) {
    try { removeWithin(join(home, 'backups'), old); }
    catch { leftovers.push(old); }
  }
  return { changed: active.map(({ host, skill, target, action }) => ({ host, skill, target, action })), backup, leftovers };
}

export function uninstall(options = {}) {
  const plan = createPlan({ ...options, uninstall: true }); plan.reason = 'uninstall';
  return executePlan(plan, options);
}

export function rollbackPlan(options = {}) {
  select(options);
  // 卡片按宿主操作：从保留批次里找该宿主（及所选技能）最近的一次操作。
  // 未指定范围时仍撤销全局最新批，备份文件格式和全局命令行为不变。
  let latest, record;
  for (const candidate of backups(homeDirectory(options.env, options.platform))) {
    const saved = json(join(candidate, 'backup.json'));
    if (saved.v !== 1 || !Array.isArray(saved.items)) throw new Error('备份说明无效');
    if (saved.items.some(item => (!options.host || options.host === 'all' || options.host === item.host)
      && (!options.skill || options.skill === 'all' || options.skill === item.skill))) {
      latest = candidate; record = saved; break;
    }
  }
  if (!latest) return { version, statuses: getStatus(options), items: [], warnings: [], reason: 'rollback' };
  const items = [];
  for (const item of record.items) {
    if (!hosts.includes(item.host) || !skills.includes(item.skill) || !isAbsolute(item.from)) throw new Error('备份说明无效');
    if (options.host && options.host !== 'all' && options.host !== item.host || options.skill && options.skill !== 'all' && options.skill !== item.skill) continue;
    const h = detectHosts(options).find(h => h.host === item.host);
    // 不信任备份中的任意写入路径；目录覆盖必须与这次请求的目标一致。
    if (!h.root || resolve(item.from) !== resolve(h.root, item.skill)) throw new Error('备份来源与当前技能目录不一致，请指定原来的技能根目录');
    const source = join(latest, item.host, item.skill), target = item.from;
    if (item.existed !== undefined && typeof item.existed !== 'boolean') throw new Error('备份说明无效');
    const existed = item.existed ?? true;
    if (existed && !directory(source)) throw new Error('备份技能目录缺失，拒绝回退');
    items.push({ host: item.host, skill: item.skill, target, ...installationStatus(target, item.host, item.skill),
      action: existed ? 'restore' : 'uninstall', ...(existed ? { files: readTree(source) } : {}) });
  }
  return { version, statuses: getStatus(options), items, warnings: [], reason: 'rollback', backupAt: record.at };
}
export function rollback(options = {}) { return executePlan(rollbackPlan(options), options); }
