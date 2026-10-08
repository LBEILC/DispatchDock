import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const managedMessage = '托管：任务已交给 DispatchDock，关掉当前会话也不会中断。要停止，在 DispatchDock 里停。';
export const fallbackMessage = reason => `托管：DispatchDock 没有接手（${reason}），改为直接运行`;
export const environmentKeys = ['PATH', 'CODEX_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'ComSpec', 'PATHEXT', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'OPENAI_BASE_URL'];
export function managedEnvironment(env) {
  return Object.fromEntries(environmentKeys.flatMap(key => {
    const actual = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase());
    return actual && typeof env[actual] === 'string' ? [[key, env[actual]]] : [];
  }));
}
export function acceptsManaged(home, enabled) {
  if (!enabled) return false;
  try {
    const viewer = JSON.parse(readFileSync(join(home, 'viewer.json'), 'utf8'));
    if (viewer.acceptsManaged !== true || !Number.isSafeInteger(viewer.pid) || viewer.pid <= 0) return false;
    process.kill(viewer.pid, 0); return true;
  } catch { return false; }
}
export function validRequest(r) {
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const nullable = x => x === null || typeof x === 'string';
  return object(r) && r.v === 1 && typeof r.id === 'string' && /^[^<>:"/\\|?*\x00-\x1f]+$/.test(r.id) && !/[. ]$/.test(r.id)
    && Number.isFinite(r.at) && ['script','node','repo'].every(k => typeof r[k] === 'string' && isAbsolute(r[k]))
    && typeof r.name === 'string' && !!r.name && !/[<>:"/\\|?*\x00-\x1f]/.test(r.name) && !/[. ]$/.test(r.name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(r.name)
    && object(r.args) && typeof r.args.task === 'string' && !!r.args.task && typeof r.args.extra === 'string' && nullable(r.args.role) && nullable(r.args.spec)
    && object(r.settings) && ['model','effort','tier','path'].every(k => nullable(r.settings[k])) && typeof r.settings.sandbox === 'string'
    && (r.settings.path === null || isAbsolute(r.settings.path))
    && object(r.dispatcher) && ['claude-code','devin','unknown'].includes(r.dispatcher.host) && nullable(r.dispatcher.session)
    && object(r.env) && Object.entries(r.env).every(([key,value]) => environmentKeys.includes(key) && typeof value === 'string' && !value.includes('\0'));
}
export function existingPaths(root, name) {
  const base = join(root, '.codex-runs', name);
  return { name, progress: base + '.progress.log', report: base + '.md', raw: base + '.log', events: base + '.events.jsonl' };
}
// 只处理完整行，保留尾部半行；轮询时不重复读取整个清单。
export function terminalReader(home, id, onStart = () => {}) {
  let offset = 0, pending = Buffer.alloc(0);
  return () => {
    let fd;
    try {
      const file = join(home, 'runs.jsonl'), size = statSync(file).size;
      if (size < offset) { offset = 0; pending = Buffer.alloc(0); }
      fd = openSync(file, 'r');
      while (offset < size) {
        const chunk = Buffer.alloc(Math.min(65536, size - offset));
        const n = readSync(fd, chunk, 0, chunk.length, offset); if (!n) break; offset += n;
        pending = Buffer.concat([pending, chunk.subarray(0, n)]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          const line = pending.subarray(0, end).toString('utf8'); pending = pending.subarray(end + 1);
          try {
            const e = JSON.parse(line);
            if (e.v === 1 && e.id === id) {
              if (e.event === 'start') onStart(e);
              if (['end','interrupted'].includes(e.event)) return e;
            }
          } catch { /* 忽略损坏行。 */ }
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { if (fd !== undefined) closeSync(fd); }
    return null;
  };
}
export async function handoff(home, request, announce, { timeout = 5000, startTimeout = 15000, interval = 50 } = {}) {
  const dir = join(home, 'managed'), base = join(dir, request.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(base + '.tmp', JSON.stringify(request), { flag: 'wx', mode: 0o600 });
  renameSync(base + '.tmp', base + '.request.json');
  let started = false, accepted = false, startDeadline = Infinity;
  const terminal = terminalReader(home, request.id, () => { started = true; }), deadline = Date.now() + timeout;
  while (true) {
    // 拒绝先于认领判断；认领者完成 reason 原子写入后才回退。
    if (existsSync(base + '.rejected.json')) {
      const rejected = JSON.parse(readFileSync(base + '.rejected.json', 'utf8'));
      if (typeof rejected.reason === 'string') return { reason: rejected.reason };
    }
    const ended = terminal();
    if (!accepted && (existsSync(base + '.claimed.json') || existsSync(base + '.running.json') || started || ended)) {
      accepted = true; startDeadline = Date.now() + startTimeout; announce(managedMessage);
    }
    if (accepted && ended) return { exit: ended.event === 'end' ? ended.exit ?? 1 : 1 };
    if (accepted && !started && Date.now() >= startDeadline) {
      try { renameSync(base + '.claimed.json', base + '.withdrawn.json'); return { reason: '软件没有启动任务' }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; /* 执行者或拒绝者已经接手，继续等待。 */ }
    }
    if (!accepted && Date.now() >= deadline) {
      try { renameSync(base + '.request.json', base + '.withdrawn.json'); return { reason: '超时' }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; /* 认领或拒绝赢得改名竞争，继续等它发布结果。 */ }
    }
    await delay(interval);
  }
}
