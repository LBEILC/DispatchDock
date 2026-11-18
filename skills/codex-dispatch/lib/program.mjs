import { spawn } from 'node:child_process';
import { killProcessTree } from './process.mjs';

// 检查命令不继承模型凭据；白名单之外的环境只能由调用者明确提供。
export function checkEnvironment(env = process.env) {
  const allowed = /^(PATH|PATHEXT|SystemRoot|ComSpec|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL)$/i;
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.test(key)));
}

export function reviewEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== 'deepseek_api_key'));
}

export function runProgram(executable, args, { root, env = process.env, stdin = '', timeoutMs = 60000, maxOutput = 65536, onLine = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', pending = '', timedOut = false, truncated = false, failure;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid).catch(error => { failure = error; child.kill(); });
    }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => {
      truncated ||= stdout.length + text.length > maxOutput;
      stdout = (stdout + text).slice(-maxOutput); pending += text;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) { onLine(pending.slice(0, end)); pending = pending.slice(end + 1); }
      if (pending.length > 262144) pending = pending.slice(-262144);
    });
    child.stderr.on('data', text => { truncated ||= stderr.length + text.length > maxOutput; stderr = (stderr + text).slice(-maxOutput); });
    child.on('error', error => { failure = error; });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
    child.stdin.end(stdin);
    child.on('close', code => {
      clearTimeout(timer);
      if (pending) onLine(pending);
      if (failure) reject(failure);
      else resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr, timedOut, truncated });
    });
  });
}
