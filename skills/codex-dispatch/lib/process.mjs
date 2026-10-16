import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

// 单次平台查询同时取得创建时间和命令行；可由调用方替换以隔离测试。
export async function processList(pid, platform = process.platform, timeout = 5000) {
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) return [];
  const options = { windowsHide: true, shell: false, timeout, maxBuffer: 8 * 1024 * 1024 };
  if (platform === 'win32') {
    const filter = pid === undefined ? '' : ` -Filter 'ProcessId = ${pid}'`;
    const script = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process${filter} | ForEach-Object { @{pid=$_.ProcessId;parent=$_.ParentProcessId;created=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds();command=$_.CommandLine} }) | ConvertTo-Json -Compress`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], options);
    const value = JSON.parse(stdout.trim() || '[]');
    return (Array.isArray(value) ? value : [value]).map(p => ({ ...p, command: p.command ?? '' }));
  }
  const { stdout } = await execute('ps', [...(pid === undefined ? ['-A'] : ['-p', String(pid)]), '-o', 'pid=,ppid=,stat=,lstart=,args='], { ...options, env: { ...process.env, LC_ALL: 'C' } });
  return stdout.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
    return m && !m[3].startsWith('Z') ? [{ pid: +m[1], parent: +m[2], created: Date.parse(m[4]), command: m[5] }] : [];
  });
}
export async function processInfo(pid, platform = process.platform) {
  try { return (await processList(pid, platform))[0] ?? null; } catch { return null; }
}
export async function processCreated(pid, platform = process.platform) {
  const info = await processInfo(pid, platform);
  return Number.isFinite(info?.created) ? info.created : null;
}
export async function taskAlive(start, { alive = pidAlive, created = processCreated } = {}) {
  if (!alive(start.pid)) return false;
  const time = await created(start.pid);
  return alive(start.pid) && (time === null || time <= start.started);
}

// 先保留整棵树的身份，再结束并等到全部退出；总时限包括平台查询。
export async function killProcessTree(pid, { platform = process.platform, list = processList, executeFile = execute, alive = pidAlive, timeout = 10000, expectedCreated } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw Error('无效的目标进程');
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const snapshot = await list(undefined, platform, remaining());
  const root = snapshot.find(p => p.pid === pid);
  if (!root) { if (alive(pid)) throw Error('无法核对进程树'); return; }
  if (expectedCreated !== undefined && root.created !== expectedCreated) throw Error('进程身份已经变化');
  const tree = [root], seen = new Set([pid]);
  for (let i = 0; i < tree.length; i++) for (const p of snapshot) {
    if (p.parent === tree[i].pid && !seen.has(p.pid) && p.created >= tree[i].created) { tree.push(p); seen.add(p.pid); }
  }
  let failure;
  try {
    if (platform === 'win32') await executeFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, timeout: remaining() });
    else {
      // 先逐层暂停并重新扫描，纳入初次快照之后刚派生的子孙。
      try {
        for (let i = 0; i < tree.length; i++) {
          if (Date.now() >= deadline) throw Error('等待进程退出超时');
          const p = tree[i];
          try { process.kill(p.pid, 'SIGSTOP'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
          for (const q of await list(undefined, platform, remaining())) {
            if (q.parent === p.pid && !seen.has(q.pid) && q.created >= p.created) { tree.push(q); seen.add(q.pid); }
          }
        }
        for (const p of [...tree].reverse()) { try { process.kill(p.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') failure ??= e; } }
      } finally {
        // 权限或查询失败也不能让仍存活的进程永久暂停。
        for (const p of tree) { try { process.kill(p.pid, 'SIGCONT'); } catch { /* 已退出。 */ } }
      }
    }
  } catch (error) { failure = error; }
  do {
    if (platform === 'win32') { if (tree.every(p => !alive(p.pid))) return; }
    else {
      const current = await list(undefined, platform, remaining());
      if (tree.every(p => !current.some(q => q.pid === p.pid && q.created === p.created))) return;
    }
    if (Date.now() >= deadline) break;
    await delay(Math.min(50, remaining()));
  } while (Date.now() < deadline);
  throw Error(failure?.message ?? '等待进程退出超时');
}
