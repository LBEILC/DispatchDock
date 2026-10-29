import { spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function viewerTakesOver(home, alive = pid => process.kill(pid, 0)) {
  try {
    const viewer = JSON.parse(readFileSync(join(home, 'viewer.json'), 'utf8'));
    if (!viewer.suppressWatchWindow || !Number.isSafeInteger(viewer.pid) || viewer.pid <= 0) return false;
    alive(viewer.pid);
    return true;
  } catch { return false; }
}

export function shouldWatch({ platform, interactive, policy, takeover }) {
  return ['win32', 'darwin'].includes(platform) && !interactive && policy !== 'never' && (policy === 'always' || !takeover);
}

export function watchCommand(name, progress) {
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  return `$host.UI.RawUI.WindowTitle=${quote(`Codex ${name}（只看）`)}; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath ${quote(progress)} -Encoding UTF8 -Wait -Tail 200`;
}

function removeLauncher(file, directory) {
  try { unlinkSync(file); } catch {}
  try { rmdirSync(directory); } catch {}
}

function macLauncher(name, progress, temporaryRoot) {
  // 尚未被 Terminal 执行的旧启动文件在下次派发时回收；不递归删除目录。
  try {
    for (const name of readdirSync(temporaryRoot)) {
      if (!name.startsWith('dispatchdock-watch-')) continue;
      const directory = join(temporaryRoot, name), info = lstatSync(directory);
      if (info.isDirectory() && Date.now() - info.mtimeMs > 86_400_000) removeLauncher(join(directory, 'watch.command'), directory);
    }
  } catch {}
  const directory = mkdtempSync(join(temporaryRoot, 'dispatchdock-watch-'));
  const file = join(directory, 'watch.command');
  // 单引号字面量保留空格、中文、换行和 shell 元字符，任务内容不参与脚本解释。
  const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
  const args = [process.execPath, fileURLToPath(new URL('../codex-watch.mjs', import.meta.url)), '--progress', progress, '--name', name, '--launcher', file];
  try {
    chmodSync(directory, 0o700);
    writeFileSync(file, `#!/bin/sh\nexec ${args.map(quote).join(' ')}\n`, { mode: 0o700 });
    chmodSync(file, 0o700);
  } catch (error) { removeLauncher(file, directory); throw error; }
  return { file, cleanup: () => removeLauncher(file, directory) };
}

export function openWatch(name, progress, { platform = process.platform, spawnProcess = spawn, temporaryRoot = tmpdir() } = {}) {
  if (platform === 'darwin') {
    // open 不使用 AppleEvents，不控制 Terminal，也不把查看窗口接入任务进程树。
    let launcher;
    try {
      launcher = macLauncher(name, progress, temporaryRoot);
      const child = spawnProcess('/usr/bin/open', ['-a', 'Terminal', launcher.file], { detached: true, stdio: 'ignore', shell: false });
      child.on('error', launcher.cleanup);
      child.on('exit', code => { if (code !== 0) launcher.cleanup(); });
      child.unref();
      return launcher.file;
    } catch { launcher?.cleanup(); return; }
  }
  if (platform !== 'win32') return;
  // 编码 PowerShell 脚本避免路径经 cmd 二次解释；只读窗口仍然独立于任务。
  const encoded = Buffer.from(watchCommand(name, progress), 'utf16le').toString('base64');
  const child = spawnProcess('powershell.exe', ['-NoProfile', '-NoExit', '-EncodedCommand', encoded], {
    detached: true, stdio: 'ignore', windowsHide: false, shell: false,
  });
  child.on('error', () => {});
  child.unref();
}
