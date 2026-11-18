import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codex, limitOutput } from './codex.mjs';

// 执行端负责模型和工具，桥接层只接受已经归一化的协议事件。
export function bridgeEvents(line) {
  let event;
  try { event = JSON.parse(line); } catch { return line.trim() ? [{ kind: 'text', text: line }] : []; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
  const string = key => typeof event[key] === 'string';
  if (['say', 'think', 'text', 'error'].includes(event.kind) && string('text')) return [{ kind: event.kind, text: event.text }];
  if (event.kind === 'tool' && string('name') && string('detail')) return [{ kind: 'tool', name: event.name, detail: event.detail }];
  if (event.kind === 'turn' && event.usage && ['input', 'output'].every(key => event.usage[key] === null || (Number.isFinite(event.usage[key]) && event.usage[key] >= 0))) return [{ kind: 'turn', usage: { input: event.usage.input, output: event.usage.output } }];
  if (event.kind === 'plan' && Array.isArray(event.items) && event.items.every(item => item && typeof item.text === 'string' && typeof item.done === 'boolean')) return [{ kind: 'plan', items: event.items.map(({ text, done }) => ({ text, done })) }];
  if (event.kind === 'file' && Array.isArray(event.files) && event.files.every(file => file && ['add', 'update', 'delete'].includes(file.kind) && typeof file.path === 'string')) return [{ kind: 'file', files: event.files.map(({ kind, path }) => ({ kind, path })) }];
  if (event.kind === 'cmd' && string('id') && string('command') && ['start', 'end'].includes(event.phase)) {
    if (event.phase === 'end' && (!string('output') || (event.exit !== null && !Number.isInteger(event.exit)))) return [];
    const output = event.phase === 'end' ? limitOutput(event.output) : null;
    return [{ kind: 'cmd', id: event.id, phase: event.phase, command: event.command,
      ...(output ? { exit: event.exit, ...output, truncated: event.truncated === true || output.truncated } : {}) }];
  }
  return [];
}

export function selectAdapter(id, settings) {
  if (id === 'codex') return codex;
  const builtin = id === 'deepseek' && !settings.path;
  const executable = builtin ? process.execPath : settings.path;
  const args = builtin ? [fileURLToPath(new URL('../workers/deepseek.mjs', import.meta.url))] : settings.args;
  return {
    id, writesReport: false,
    detect() {
      if (!executable || !isAbsolute(executable) || !existsSync(executable) || !statSync(executable).isFile()) return { installed: false, error: `请在 agents.${id}.path 配置执行端的绝对路径` };
      if (/\.(cmd|bat|ps1)$/i.test(executable)) return { installed: false, error: '桥接执行端请指定可执行文件或 Node 入口，不支持 shell 包装' };
      return { installed: true, version: null };
    },
    command({ root, prompt, settings, detection }) {
      if (detection?.error) throw Error(detection.error);
      const nodeEntry = /\.(mjs|cjs|js)$/i.test(executable);
      return { executable: nodeEntry ? process.execPath : executable, args: [...(nodeEntry ? [executable] : []), ...(args ?? [])],
        stdin: JSON.stringify({ v: 1, repo: root, prompt, settings: Object.fromEntries(['model', 'effort', 'tier', 'sandbox'].map(key => [key, settings[key]])) }) + '\n' };
    },
    mapLine: bridgeEvents,
  };
}
