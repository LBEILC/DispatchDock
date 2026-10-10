import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';

const missing = '找不到 Codex CLI。确认 codex --version 能运行；非标准安装可在 config.json 的 agents.codex.path 写 Codex 的绝对路径。';
function launcherFor(file) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(missing);
  if (/\.(js|mjs|cjs)$/i.test(file)) return { executable: process.execPath, args: [file] };
  if (!/\.(cmd|bat)$/i.test(file)) return { executable: file, args: [] };
  const wrapper = readFileSync(file, 'utf8');
  // 仅识别 npm 的 Node 包装入口，不执行或求值批处理文本。
  const match = wrapper.match(/"%dp0%[\\/]([^"\r\n]+\.(?:js|mjs|cjs))"\s+%\*/i);
  const entry = match && resolve(dirname(file), match[1]);
  if (entry && existsSync(entry) && statSync(entry).isFile()) return { executable: process.execPath, args: [entry] };
  throw new Error(`无法解析 Codex 的启动包装：${file}。可在 config.json 的 agents.codex.path 写 codex.exe 或 Codex 的 Node 入口（codex.js）的绝对路径。`);
}
export function resolveLauncher(env = process.env, platform = process.platform, configuredPath = null) {
  if (configuredPath) return launcherFor(configuredPath);
  // 测试可指定一个 Node 假 agent；不改变真实安装或 PATH。
  if (env.CODEX_DISPATCH_TEST_AGENT) return { executable: process.execPath, args: [resolve(env.CODEX_DISPATCH_TEST_AGENT)] };
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = resolve(dir.replace(/^"|"$/g, ''), name);
      if (existsSync(file) && statSync(file).isFile()) return launcherFor(file);
    }
  }
  throw new Error(missing);
}

export function shortCommand(s) {
  const m = s.match(/^(?:"[^"]*powershell(?:\.exe)?"|(?:\S*[\\/])?powershell(?:\.exe)?)\s+(?:-\w+\s+)*-Command\s+(['"])([\s\S]*)\1$/i);
  return m ? m[2].replace(m[1] === "'" ? /''/g : /`"/g, m[1]) : s;
}

export function limitOutput(output) {
  const bytes = Buffer.from(output.split('\n').slice(0, 200).join('\n'));
  const limited = bytes.subarray(0, 16384).toString('utf8').replace(/\uFFFD$/, '');
  return { output: limited, truncated: limited.length < output.length };
}

export function mapLine(line, { root }) {
  let e;
  try { e = JSON.parse(line); } catch { return line.trim() ? [{ kind: 'text', text: line }] : []; }
  if (!e || typeof e !== 'object' || Array.isArray(e)) return [];
  if (e.type === 'turn.completed') return [{ kind: 'turn', usage: { input: e.usage?.input_tokens ?? null, output: e.usage?.output_tokens ?? null } }];
  if (e.type === 'turn.failed' || e.type === 'error') return [{ kind: 'error', text: String(e.error?.message ?? e.message ?? JSON.stringify(e)) }];
  const i = e.item;
  if (!i || !['item.started', 'item.updated', 'item.completed'].includes(e.type)) return [];
  const done = e.type === 'item.completed';
  switch (i.type) {
    case 'agent_message': return done ? [{ kind: 'say', text: String(i.text ?? '') }] : [];
    case 'reasoning': return done && i.text ? [{ kind: 'think', text: String(i.text) }] : [];
    case 'command_execution': {
      const event = { kind: 'cmd', id: String(i.id ?? ''), phase: done ? 'end' : 'start', command: shortCommand(String(i.command ?? '')) };
      if (done) Object.assign(event, { exit: typeof i.exit_code === 'number' ? i.exit_code : null }, limitOutput(String(i.aggregated_output ?? i.output ?? '')));
      return [event];
    }
    case 'file_change': return done ? [{ kind: 'file', files: (Array.isArray(i.changes) ? i.changes : [])
      .filter(f => typeof f?.path === 'string').map(f => ({ kind: ['add', 'update', 'delete'].includes(f.kind) ? f.kind : 'update', path: relative(root, resolve(root, f.path)).replaceAll('\\', '/') })) }] : [];
    case 'todo_list': return [{ kind: 'plan', items: (Array.isArray(i.items) ? i.items : []).map(t => ({ text: String(t?.text ?? ''), done: t?.completed === true })) }];
    case 'web_search': return done ? [] : [{ kind: 'tool', name: 'web_search', detail: String(i.query ?? '') }];
    case 'mcp_tool_call': return done ? [] : [{ kind: 'tool', name: 'mcp_tool_call', detail: `${i.server ?? ''} ${i.tool ?? ''}` }];
    case 'error': return /unrecognized configuration/.test(i.message ?? '') ? [] : [{ kind: 'error', text: String(i.message ?? '') }];
    default: return [];
  }
}

export const codex = {
  id: 'codex',
  writesReport: true,
  detect({ env = process.env, settings = {} } = {}) {
    try {
      const launcher = resolveLauncher(env, process.platform, settings.path);
      const result = spawnSync(launcher.executable, [...launcher.args, '--version'], { env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000 });
      return { installed: !result.error && result.status === 0, version: result.status === 0 ? result.stdout.trim() || null : null, launcher };
    } catch (error) { return { installed: false, version: null, error: error.message }; }
  },
  command({ root, report, prompt, settings, detection, env = process.env }) {
    const launcher = detection?.launcher ?? resolveLauncher(env, process.platform, settings.path);
    const args = [...launcher.args, 'exec', '--json', '-C', root];
    if (settings.model != null) args.push('-m', settings.model);
    if (settings.effort != null) args.push('-c', `model_reasoning_effort=${JSON.stringify(settings.effort)}`);
    if (settings.tier != null) args.push('-c', `service_tier=${JSON.stringify(settings.tier)}`);
    if (settings.sandbox != null) args.push('-s', settings.sandbox);
    args.push('-o', report, '-');
    return { executable: launcher.executable, args, stdin: prompt };
  },
  mapLine,
  failureHint(stderr) {
    if (/Not inside a trusted directory/i.test(stderr)) return '当前目录不是 git 仓库，Codex 拒绝运行。在项目目录里先运行 git init，或换到已有的 git 仓库再派发。';
    return null;
  },
};
