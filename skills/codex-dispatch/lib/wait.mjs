import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { printCompletion } from './completion.mjs';
import { taskAlive } from './process.mjs';

export const waitInterval = 50;

// 从尾部逐块读，跨块行保持原始字节，避免截断中文；末尾半行不参与解析。
export function* reverseRows(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    let offset = fstatSync(fd).size, suffix = Buffer.alloc(0), complete = false;
    while (offset > 0) {
      const size = Math.min(65536, offset);
      offset -= size;
      const chunk = Buffer.alloc(size);
      const n = readSync(fd, chunk, 0, size, offset);
      const data = Buffer.concat([chunk.subarray(0, n), suffix]);
      let end = data.length;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] !== 10) continue;
        if (complete) {
          let row;
          try { row = JSON.parse(data.subarray(i + 1, end).toString('utf8')); } catch { /* 忽略坏行。 */ }
          if (row?.v === 1) yield row;
        }
        complete = true;
        end = i;
      }
      // 尚未遇到换行时是在跳过尾部半行，无需保存它。
      suffix = complete ? data.subarray(0, end) : Buffer.alloc(0);
    }
    if (complete) {
      let row;
      try { row = JSON.parse(suffix.toString('utf8')); } catch { /* 忽略坏行。 */ }
      if (row?.v === 1) yield row;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}

const repoKey = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
export function findStart(file, root, name) {
  for (const row of reverseRows(file)) {
    if (row.event === 'start' && typeof row.repo === 'string' && repoKey(row.repo) === repoKey(root)
      && (name === undefined || row.name === name)) return row;
  }
  return null;
}

export function findTerminal(file, id) {
  let interrupted = null;
  for (const row of reverseRows(file)) {
    if (row.id !== id) continue;
    if (row.event === 'end') return row;
    if (row.event === 'interrupted') interrupted ??= row;
    if (row.event === 'start') break;
  }
  return interrupted;
}

export async function waitForTask(home, root, name, { alive = taskAlive, log = console.log } = {}) {
  const file = join(home, 'runs.jsonl'), start = findStart(file, root, name);
  if (!start) {
    // 未指定记录名且仓库无记录时省略记录名（设计 2026-10-13 定稿）。
    log(`等待：在当前仓库找不到记录${name === undefined ? '' : ` ${name}`}`);
    return 2;
  }
  let terminal = findTerminal(file, start.id);
  let running = terminal ? false : await alive(start);
  // 查询进程时任务可能恰好结束，输出和中断判定前再次检查清单。
  terminal ??= findTerminal(file, start.id);
  log(`等待：${start.name}（${terminal || !running ? '已结束' : '进行中'}）`);
  while (true) {
    if (terminal) return printCompletion(terminal.event === 'end' ? terminal.exit ?? 1 : 1, start, log);
    if (!running) {
      log('等待：任务进程已经不在了，没有结束记录，按中断处理');
      return 1;
    }
    await delay(waitInterval);
    terminal = findTerminal(file, start.id);
    if (!terminal) {
      running = await alive(start);
      terminal = findTerminal(file, start.id);
    }
  }
}
