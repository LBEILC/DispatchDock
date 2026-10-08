import { parentPort, workerData } from 'node:worker_threads';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function loginState(result) {
  if (result.error || result.signal) return 'unknown';
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0 && /^Logged in\b/im.test(text)) return 'in';
  if (result.status === 1 && /^Not logged in\b/im.test(text)) return 'out';
  return 'unknown';
}
export function skillState(entry, version) {
  if (entry.state === 'missing') return 'missing';
  if (entry.state !== 'owned') return 'custom';
  const a = entry.version.split('.').map(Number), b = version.split('.').map(Number);
  const different = a.findIndex((n, i) => n !== b[i]);
  return different < 0 ? 'latest' : a[different] < b[different] ? 'update' : 'newer';
}
export function hostActions(skills, backup) {
  return [...(skills.some(s => s.state === 'missing') ? ['install'] : []),
    ...(skills.some(s => s.state === 'update') ? ['update'] : []),
    ...(skills.every(s => s.state === 'latest') ? ['reinstall'] : []),
    ...(backup ? ['rollback'] : []), ...(skills.some(s => s.state === 'custom') ? ['replace'] : [])];
}
export const defaultChecked = state => state === 'missing' || state === 'update';
export async function createPreferences(root, data, env = process.env) {
  const module = file => import(pathToFileURL(join(root, file)).href);
  const [install, config, adapter, codexConfig] = await Promise.all([
    module('installer/lib/install.mjs'), module('skills/codex-dispatch/lib/config.mjs'),
    module('skills/codex-dispatch/adapters/codex.mjs'), module('installer/lib/codex-config.mjs')]);
  const home = config.homeDirectory(env), ownFile = join(data, 'preferences.json');
  let own = { notifications: true, theme: 'system', wizardDone: false };
  try { own = { ...own, ...JSON.parse(readFileSync(ownFile, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const saveOwn = patch => {
    const next = { ...own, ...patch }; mkdirSync(data, { recursive: true });
    writeFileSync(ownFile + '.tmp', JSON.stringify(next)); renameSync(ownFile + '.tmp', ownFile); own = next;
  };
  const shorten = file => {
    if (!file) return '';
    for (const [base, label] of [...(process.platform === 'win32' ? [[env.APPDATA, '%APPDATA%']] : []), [config.userDirectory(env), '~']]) {
      if (!base) continue;
      const rel = relative(base, file);
      if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) return label + (rel ? (label === '%APPDATA%' ? '\\' + rel : '/' + rel.replaceAll('\\', '/')) : '');
    }
    return file;
  };
  function settings() {
    let state;
    try { state = config.loadConfig(home, {}, {}); }
    catch (e) { state = { ...config.readConfig(home), reason: e.message, settings: config.defaults }; }
    const current = codexConfig.readCodexConfig(env)?.values || {};
    const overrides = {};
    for (const [key, name] of Object.entries({ model: 'CODEX_MODEL', effort: 'CODEX_EFFORT', tier: 'CODEX_TIER', sandbox: 'CODEX_SANDBOX', watchWindow: 'CODEX_NO_WATCH' }))
      if (env[name]) overrides[key] = { name, value: env[name] };
    return { managed: state.config?.managed === true, values: state.settings, exists: state.exists, reason: state.reason, file: shorten(state.file),
      current: { model: current.model, effort: current.model_reasoning_effort, tier: current.service_tier }, overrides, own };
  }
  let connections;
  function detect() {
    const state = settings();
    const hosts = install.getStatus({ env }).map(h => {
      const skills = h.skills.map(s => ({ skill: s.skill, version: s.version, state: skillState(s, install.version), checked: defaultChecked(skillState(s, install.version)) }));
      let installedAt = 0;
      for (const s of h.skills.filter(s => s.state === 'owned')) {
        try { const record = JSON.parse(readFileSync(join(s.target,'.dispatchdock.json'),'utf8')); if(Number.isFinite(record.installedAt)) installedAt=Math.max(installedAt,record.installedAt); }
        catch { /* 检测期间记录消失时不显示时间。 */ }
      }
      let backup = false;
      try { backup = install.rollbackPlan({ env, host: h.host }).items.length > 0; } catch { /* 损坏的备份不提供回退按钮。 */ }
      return { host: h.host, detected: h.detected, root: shorten(h.root), installedAt, skills, actions: hostActions(skills, backup) };
    });
    const detected = adapter.codex.detect({ env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, settings: { path: state.values.path } });
    const version = detected.version;
    let login = 'unknown';
    if (detected.installed && detected.launcher) {
      const result = spawnSync(detected.launcher.executable, [...detected.launcher.args, 'login', 'status'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000, maxBuffer: 65536 });
      // 只保留状态，账号和原始输出不跨线程、不落盘。
      login = loginState(result);
    }
    if (version && version !== own.lastVersion) saveOwn({ lastVersion: version, ...(own.lastVersion ? { versionChange: { old: own.lastVersion, next: version } } : {}) });
    connections = { hosts, availableVersion: install.version, codex: { version, installed: !!version && detected.installed, login, path: state.values.path ? shorten(state.values.path) : null, change: own.versionChange } };
    return connections;
  }
  return {
    async run(action, payload = {}) {
      if (action === 'settings') return settings();
      if (action === 'detect') return detect();
      if (action === 'save') {
        if (payload.key === 'managed') { if (typeof payload.value !== 'boolean') throw Error('Invalid value'); config.writeConfig(home, { managed: payload.value }); return settings(); }
        if (!['model', 'effort', 'tier', 'sandbox', 'watchWindow', 'path'].includes(payload.key)) throw Error('Invalid setting');
        if (payload.value !== null && typeof payload.value !== 'string') throw Error('Invalid value');
        const choices = { effort: ['minimal','low','medium','high','xhigh'], tier: ['default','priority','flex'], sandbox: ['workspace-write','read-only'], watchWindow: ['auto','always','never'] };
        if (payload.value !== null && choices[payload.key] && !choices[payload.key].includes(payload.value)) throw Error('Invalid value');
        config.writeConfig(home, { [payload.key]: payload.value }); return settings();
      }
      if (action === 'own') {
        if (payload.key === 'theme' && ['system','light','dark'].includes(payload.value) || payload.key === 'notifications' && typeof payload.value === 'boolean') saveOwn({ [payload.key]: payload.value });
        else throw Error('Invalid preference');
        return settings();
      }
      if (action === 'finish') { if (payload.configure && !existsSync(join(home,'config.json'))) config.writeConfig(home); saveOwn({ wizardDone: true }); return settings(); }
      if (action === 'ack') { saveOwn({ versionChange: null }); return detect(); }
      if (action === 'install') {
        if (!install.hosts.includes(payload.host) || !['install','update','reinstall','replace','rollback','selected'].includes(payload.operation)) throw Error('Invalid operation');
        if (payload.operation === 'rollback') return install.rollback({ env, host: payload.host });
        const plan = install.createPlan({ env, host: payload.host, sourceRoot: join(root,'skills'), replaceExisting: ['replace','selected'].includes(payload.operation) });
        if (!plan.statuses[0]?.detected) throw Error('Host no longer detected');
        const allowed = { install: ['missing'], update: ['update'], reinstall: ['latest'], replace: ['custom'], selected: ['missing','update','latest','custom'] }[payload.operation];
        if (['selected','replace'].includes(payload.operation) && (!Array.isArray(payload.skills) || payload.skills.some(s => !install.skills.includes(s)))) throw Error('Invalid skills');
        plan.items = plan.items.filter(i => allowed.includes(skillState(i, install.version)) && (!payload.skills || payload.skills.includes(i.skill)));
        return install.executePlan(plan, { env });
      }
      throw Error('Invalid operation');
    }
  };
}
if (parentPort) {
  const service = await createPreferences(workerData.root, workerData.data);
  parentPort.on('message', async ({ id, action, payload }) => {
    try { parentPort.postMessage({ id, value: await service.run(action, payload) }); }
    catch (e) { parentPort.postMessage({ id, error: e.message }); }
  });
}
