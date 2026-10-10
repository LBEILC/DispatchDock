import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { relative, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import { configCommand, homeDirectory, loadConfig } from './config.mjs';
import { dispatcher, parseArgs, taskDetails } from './options.mjs';
import { recordPaths, registryWriter } from './records.mjs';
import { clip, formatProgress, progressFooter, progressHeader } from './progress.mjs';
import { openWatch, shouldWatch, viewerTakesOver } from './watch.mjs';
import { acceptsManaged, managedEnvironment, validRequest, existingPaths, handoff, fallbackMessage, managedMessage } from './managed.mjs';

function errorTexts(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').flatMap(line => {
      try { const e = JSON.parse(line); return e?.kind === 'error' ? [String(e.text)] : []; } catch { return []; }
    });
  } catch { return []; }
}

export async function run({ adapter, scriptPath, args = process.argv.slice(2), env = process.env, root = process.cwd() }) {
  if (args[0] === '--config') { console.log(configCommand(args.slice(1), env)); return 0; }
  let requestFile = args[0] === '--run-request' ? args[1] : null;
  if (requestFile) {
    if (!requestFile.endsWith('.claimed.json')) return 0;
    const running = requestFile.replace(/\.claimed\.json$/, '.running.json');
    try { renameSync(requestFile, running); } catch { return 0; }
    requestFile = running;
  }
  const request = requestFile ? JSON.parse(readFileSync(requestFile, 'utf8')) : null;
  if (request && !validRequest(request)) throw Error('请求文件无效');
  if (request) root = request.repo;
  const parsed = request ? { task: request.args.task, extra: request.args.extra, opts: { name: request.name, ...(request.args.role ? { role: request.args.role } : {}) } } : parseArgs(args);
  const details = taskDetails(root, parsed);
  const dryRun = !request && !!env.CODEX_DRY_RUN;
  const started = Date.now();
  // dry-run 在读取配置、检测 agent、创建目录之前返回。
  const paths = request ? existingPaths(root, request.name) : recordPaths(root, details.name, progressHeader(details.title, details.role?.name, started), dryRun);
  if (dryRun) {
    console.log(`记录名：${paths.name}\n----\n${details.prompt}`);
    return 0;
  }
  console.log(`记录名：${paths.name}\n进度：${paths.progress}`);
  const home = homeDirectory(env);
  const registry = registryWriter(home);
  const { settings, warning, config } = request ? { settings: { ...request.settings, watchWindow: 'never' }, warning: null, config: {} } : loadConfig(home, parsed.opts, env);
  writeFileSync(paths.raw, '');
  writeFileSync(paths.events, '');
  const interactive = !!process.stdout.isTTY;
  const progress = (text, at = Date.now()) => {
    const line = `[${new Date(at).toLocaleTimeString('zh-CN', { hour12: false })}] ${text}`;
    appendFileSync(paths.progress, `${line}\n`);
    if (interactive) console.log(line);
  };
  if (warning) { progress(warning); if (!interactive) console.log(warning); }
  if (request) progress(managedMessage);
  const id = request?.id ?? `${paths.name}-${started}-${process.pid}`;
  const source = request?.dispatcher ?? dispatcher(parsed.opts.host, env, scriptPath);
  if (!request && acceptsManaged(home, config.managed === true)) {
    const announce = text => { if (text === managedMessage) console.log(text); else { progress(text); if (!interactive) console.log(text); } };
    const result = await handoff(home, { v: 1, id, at: started, script: scriptPath, node: process.execPath, repo: root, name: paths.name,
      args: { task: parsed.task, extra: parsed.extra, role: parsed.opts.role ?? null, spec: details.spec },
      settings: Object.fromEntries(['model','effort','tier','sandbox','path'].map(key => [key, settings[key]])), dispatcher: source, env: managedEnvironment(env) }, announce,
      { startTimeout: Number(env.CODEX_DISPATCH_TEST_START_TIMEOUT_MS) > 0 ? Number(env.CODEX_DISPATCH_TEST_START_TIMEOUT_MS) : 15000 });
    if ('exit' in result) {
      if (result.exit !== 0) for (const text of errorTexts(paths.events)) console.log(`出错：${clip(text)}`);
      console.log(`exit=${result.exit} report=${paths.report}`);
      return result.exit;
    }
    announce(fallbackMessage(result.reason));
  }
  const detection = await adapter.detect({ env, settings });
  registry({ event: 'start', id, repo: root, name: paths.name, spec: details.spec ? relative(root, resolvePath(root, details.spec)).replaceAll('\\', '/') : null,
    title: details.title, role: details.role?.name ?? null, pid: process.pid, started,
    progress: paths.progress, report: paths.report, raw: paths.raw, model: settings.model, effort: settings.effort, tier: settings.tier,
    agent: adapter.id, agentVersion: detection.version, sandbox: settings.sandbox, events: paths.events,
    dispatcher: source, ...(request ? { managed: true } : {}),
  });
  let seq = 0, lastSay = null;
  const errors = [];
  const emit = (event, at = Date.now()) => {
    const unified = { ...event, v: 1, seq: ++seq, at };
    appendFileSync(paths.events, `${JSON.stringify(unified)}\n`);
    if (event.kind === 'say') lastSay = event.text;
    if (event.kind === 'error') errors.push(event.text);
    for (const line of formatProgress(unified)) progress(line, at);
  };
  const finish = code => {
    if (!adapter.writesReport && lastSay !== null) writeFileSync(paths.report, lastSay);
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    appendFileSync(paths.progress, progressFooter(code, minutes, paths.report));
    registry({ event: 'end', id, exit: code, at: Date.now(), minutes: Number(minutes) });
    // 后台派发时进度不打印到标准输出；失败原因放在退出码前面，派活方不用翻日志就能看到。
    if (code !== 0 && !interactive) for (const text of errors) console.log(`出错：${clip(text)}`);
    console.log(`exit=${code} report=${paths.report}`);
    return code ?? 1;
  };
  let command;
  try { command = adapter.command({ root, report: paths.report, prompt: details.prompt, settings, detection, env }); }
  catch (error) { emit({ kind: 'error', text: `启动 Codex 失败：${error.message}` }); return finish(1); }
  if (shouldWatch({ platform: process.platform, interactive, policy: settings.watchWindow, takeover: viewerTakesOver(home) })) openWatch(paths.name, paths.progress);
  return await new Promise(resolve => {
    let child;
    try {
      child = spawn(command.executable, command.args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    } catch (error) { emit({ kind: 'error', text: `启动 Codex 失败：${error.message}` }); resolve(finish(1)); return; }
    registry({ event: 'spawned', id, codexPid: child.pid ?? null, agentPid: child.pid ?? null, at: Date.now() });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    createInterface({ input: child.stdout }).on('line', line => {
      const at = Date.now();
      let event;
      try { event = JSON.parse(line); } catch { /* 非 JSON 行仍保留原文。 */ }
      appendFileSync(paths.raw, `${event && typeof event === 'object' && !Array.isArray(event) ? JSON.stringify({ ...event, _at: at }) : line}\n`);
      for (const mapped of adapter.mapLine(line, { root })) emit(mapped, at);
    });
    // 保留旧行为：stderr 原样存入 raw，不当成 stdout 的事件流。
    let stderr = '';
    child.stderr.on('data', chunk => { appendFileSync(paths.raw, chunk); stderr = (stderr + chunk).slice(-4096); });
    let failed = false;
    child.on('error', error => { failed = true; emit({ kind: 'error', text: `启动 Codex 失败：${error.message}` }); });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') emit({ kind: 'error', text: error.message });
    });
    const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
    const handlers = signals.map(signal => {
      const handler = () => {
        appendFileSync(paths.progress, `\n=== 派发脚本收到 ${signal}，被外部中断 ===\n`);
        registry({ event: 'interrupted', id, signal, at: Date.now() });
        process.exit(1);
      };
      process.on(signal, handler);
      return [signal, handler];
    });
    child.stdin.end(command.stdin, 'utf8');
    // close 在 stdout/stderr 完全排空后触发，避免 exit 提前丢掉最后的汇报事件。
    child.on('close', code => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      // 干活方启动即退出时，原因往往只在 stderr 里（例如 Codex 拒绝在非 git 目录运行），补成出错事件。
      if (!failed && code !== 0) {
        const tail = stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-5).join('\n');
        if (tail) emit({ kind: 'error', text: tail });
        const hint = tail && adapter.failureHint?.(stderr);
        if (hint) emit({ kind: 'error', text: hint });
      }
      resolve(finish(failed ? 1 : code));
    });
  });
}
