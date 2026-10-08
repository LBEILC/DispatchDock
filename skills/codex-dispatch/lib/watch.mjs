import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function viewerTakesOver(home, alive = pid => process.kill(pid, 0)) {
  try {
    const viewer = JSON.parse(readFileSync(join(home, 'viewer.json'), 'utf8'));
    if (!viewer.suppressWatchWindow || !Number.isSafeInteger(viewer.pid) || viewer.pid <= 0) return false;
    alive(viewer.pid);
    return true;
  } catch { return false; }
}

export function shouldWatch({ platform, interactive, policy, takeover }) {
  return platform === 'win32' && !interactive && policy !== 'never' && (policy === 'always' || !takeover);
}

export function watchCommand(name, progress) {
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  return `$host.UI.RawUI.WindowTitle=${quote(`Codex ${name}（只看）`)}; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath ${quote(progress)} -Encoding UTF8 -Wait -Tail 200`;
}

export function openWatch(name, progress) {
  // 编码 PowerShell 脚本避免路径经 cmd 二次解释；只读窗口仍然独立于任务。
  const encoded = Buffer.from(watchCommand(name, progress), 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NoExit', '-EncodedCommand', encoded], {
    detached: true, stdio: 'ignore', windowsHide: false, shell: false,
  });
  child.on('error', () => {});
  child.unref();
}
