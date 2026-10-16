import { join } from 'node:path';
import { findStart, findTerminal } from './wait.mjs';
import { processInfo, taskAlive, killProcessTree } from './process.mjs';
import { registryWriter } from './records.mjs';

export async function stopTask(home, root, name, { info = processInfo, alive = taskAlive, killTree = killProcessTree, log = console.log } = {}) {
  const file = join(home, 'runs.jsonl'), start = findStart(file, root, name);
  if (!start) { log(`停止：在当前仓库找不到记录 ${name}`); return 2; }
  const ended = () => { log(`停止：${name}（已经结束）`); return 0; };
  if (findTerminal(file, start.id)) return ended();
  const identity = await info(start.pid);
  const matches = identity && Number.isFinite(identity.created) && identity.command.includes('codex-task.mjs')
    && await alive(start, { created: async () => identity.created });
  if (findTerminal(file, start.id)) return ended();
  if (!matches) { log(`停止：${name} 的进程已经不在了`); return 1; }
  try { await killTree(start.pid, { expectedCreated: identity.created }); }
  catch (error) { log(`停止：${name} 没能停下（${error.message}）`); return 1; }
  registryWriter(home, { separate: true })({ event: 'interrupted', id: start.id, signal: 'stopped-by-command', at: Date.now() });
  log(`停止：${name} 已停止，工作区里没提交的改动还在`);
  return 0;
}
