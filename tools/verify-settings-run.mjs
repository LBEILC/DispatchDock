import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';

// Chromium 退出后再回收配置目录，避免 Windows 字典和数据库仍持有文件句柄。
const profile = await mkdtemp(path.join(os.tmpdir(), 'dispatchdock-settings-'));
try {
  const env = { ...process.env, DISPATCHDOCK_VERIFY_PROFILE: profile, CODEX_DISPATCH_HOME: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['tools/verify-settings.mjs'], { env, stdio: 'inherit', shell: false, windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
