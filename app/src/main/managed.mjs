import { parentPort, workerData } from 'node:worker_threads';
import { watch, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export async function createManaged(root, env = process.env, onError = console.error) {
  const load = file => import(pathToFileURL(join(root, file)).href);
  const [install, config, common, options] = await Promise.all([
    load('installer/lib/install.mjs'), load('skills/codex-dispatch/lib/config.mjs'), load('skills/codex-dispatch/lib/managed.mjs'),
    load('skills/codex-dispatch/lib/options.mjs')]);
  const home = config.homeDirectory(env), dir = join(home, 'managed');
  const terminal = new Map();
  let watcher, timer, closed = false;
  const remove = file => { try { unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') onError(e); } };
  function reject(file, reason) {
    const target = file.replace(/\.(request|claimed)\.json$/, '.rejected.json');
    try {
      renameSync(file, target);
      let value; try { value = JSON.parse(readFileSync(target, 'utf8')); } catch { value = {}; }
      writeFileSync(target + '.tmp', JSON.stringify({ ...value, reason }), { mode: 0o600 });
      renameSync(target + '.tmp', target);
    } catch (e) { if (e.code !== 'ENOENT') onError(e); }
  }
  function verify(r, file) {
    if (!common.validRequest(r) || basename(file) !== r.id + '.request.json') return '请求文件无效';
    try {
      if (!statSync(common.existingPaths(r.repo, r.name).progress).isFile()) return '请求文件无效';
      const details = options.taskDetails(r.repo, { task: r.args.task, extra: r.args.extra, opts: { name: r.name, role: r.args.role } });
      if (details.spec !== r.args.spec) return '请求文件无效';
    } catch { return '请求文件无效'; }
    let owned = false;
    try {
      const marker = JSON.parse(readFileSync(join(dirname(r.script), '.dispatchdock.json'), 'utf8'));
      owned = basename(r.script) === 'codex-task.mjs' && install.hosts.includes(marker.host)
        && install.installationStatus(dirname(r.script), marker.host, 'codex-dispatch').state === 'owned';
    } catch { /* 没有有效安装记录就不能执行。 */ }
    if (!owned) return '派发脚本不是由 DispatchDock 安装的，或者被改过';
    try { if (!['node', 'node.exe'].includes(basename(r.node).toLowerCase()) || !statSync(r.node).isFile()) return 'node 路径无效'; }
    catch { return 'node 路径无效'; }
    return null;
  }
  function launch(r, claimed) {
    const failed = error => reject(claimed, `启动 Codex 失败：${error.message}`);
    // 继承软件环境，请求只覆盖协议白名单；Windows 环境变量名不区分大小写。
    const childEnv = { ...env };
    for (const [key, value] of Object.entries(r.env)) {
      if (process.platform === 'win32') {
        for (const existing of Object.keys(childEnv)) if (existing.toLowerCase() === key.toLowerCase()) delete childEnv[existing];
      }
      childEnv[key] = value;
    }
    childEnv.CODEX_DISPATCH_HOME = home;
    try {
      const child = spawn(r.node, [r.script, '--run-request', claimed], { cwd: r.repo, env: childEnv, detached: true, stdio: 'ignore', shell: false, windowsHide: true });
      child.on('error', failed); child.unref();
    } catch (error) { failed(error); }
  }
  function scan() {
    if (closed) return;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (name.endsWith('.request.json')) {
        let r; try { r = JSON.parse(readFileSync(file, 'utf8')); } catch { reject(file, '请求文件无效'); continue; }
        const reason = verify(r, file); if (reason) { reject(file, reason); continue; }
        const claimed = file.replace(/\.request\.json$/, '.claimed.json');
        try { renameSync(file, claimed); } catch (e) { if (e.code !== 'ENOENT') onError(e); continue; }
        launch(r, claimed);
      }
      if (/\.(claimed|running|rejected|withdrawn)\.json$/.test(name)) {
        const id = name.replace(/\.(claimed|running|rejected|withdrawn)\.json$/, '');
        const read = terminal.get(id) ?? common.terminalReader(home, id); terminal.set(id, read);
        if (read()) { remove(file); terminal.delete(id); }
      }
    }
  }
  return {
    start() {
      mkdirSync(dir, { recursive: true });
      for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        try { const info = statSync(file); if (info.isFile() && info.mtimeMs < Date.now() - 86400000) remove(file); }
        catch (e) { if (e.code !== 'ENOENT') onError(e); }
      }
      const safeScan = () => { try { scan(); } catch (e) { onError(e); } };
      watcher = watch(dir, safeScan); watcher.on('error', onError);
      timer = setInterval(safeScan, 200); safeScan();
    },
    scan,
    close() { closed = true; watcher?.close(); clearInterval(timer); }
  };
}
if (parentPort) {
  const service = await createManaged(workerData.root);
  service.start(); parentPort.postMessage('ready');
  parentPort.on('message', () => { service.close(); parentPort.close(); });
}
