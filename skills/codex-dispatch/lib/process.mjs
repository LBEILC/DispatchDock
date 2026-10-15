import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

// 平台查询独立封装，取不到创建时间时由调用方退回 PID 存活判断。
export async function processCreated(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const options = { windowsHide: true, shell: false, timeout: 5000 };
    if (platform === 'win32') {
      const script = `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid}; ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()`;
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], options);
      const value = stdout.trim() ? Number(stdout.trim()) : NaN;
      return Number.isFinite(value) ? value : null;
    }
    const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], { ...options, env: { ...process.env, LC_ALL: 'C' } });
    const value = Date.parse(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

export async function taskAlive(start, { alive = pidAlive, created = processCreated } = {}) {
  if (!alive(start.pid)) return false;
  const time = await created(start.pid);
  // start.started 在派发准备阶段记录；同一个进程必须先于该时刻创建。
  return alive(start.pid) && (time === null || time <= start.started);
}
