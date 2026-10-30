#!/usr/bin/env node
// 只读查看精简进度：node codex-watch.mjs [仓库目录]。关闭此进程不影响任务。
import { closeSync, fstatSync, openSync, readSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

export function latestProgress(root) {
  const directory = join(resolve(root), '.codex-runs');
  try {
    return readdirSync(directory).filter(name => name.endsWith('.progress.log'))
      .map(name => ({ file: join(directory, name), info: statSync(join(directory, name)) }))
      .filter(item => item.info.isFile()).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0]?.file;
  } catch (error) { if (error.code === 'ENOENT') return; throw error; }
}

export function followProgress(file, output = process.stdout, interval = 250) {
  const fd = openSync(file, 'r');
  let position = fstatSync(fd).size, decoder = new StringDecoder('utf8'), stopped = false;
  // 从末尾定位最近 200 行，避免一次读入整份长日志。
  let newlines = 0, chunks = [];
  while (position > 0 && newlines <= 200) {
    const start = Math.max(0, position - 8192), chunk = Buffer.alloc(position - start);
    readSync(fd, chunk, 0, chunk.length, start);
    chunks.unshift(chunk);
    for (const byte of chunk) if (byte === 10) newlines++;
    position = start;
  }
  const initial = Buffer.concat(chunks);
  let keep = 200 + (initial.at(-1) === 10 ? 1 : 0), start = initial.length;
  while (start > 0) { start--; if (initial[start] === 10 && --keep === 0) { start++; break; } }
  output.write(decoder.write(initial.subarray(start)));
  position += initial.length;
  const timer = setInterval(() => {
    try {
      const size = fstatSync(fd).size;
      if (size < position) { position = 0; decoder = new StringDecoder('utf8'); }
      while (position < size) {
        const chunk = Buffer.alloc(Math.min(size - position, 65536));
        const count = readSync(fd, chunk, 0, chunk.length, position);
        if (!count) break;
        position += count;
        output.write(decoder.write(chunk.subarray(0, count)));
      }
    } catch { stop(); }
  }, interval);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    closeSync(fd);
  }
  return stop;
}

function main(args) {
  let file, name, launcher;
  if (args[0] === '--progress') {
    file = args[1];
    for (let i = 2; i < args.length; i += 2) {
      if (args[i] === '--name') name = args[i + 1];
      else if (args[i] === '--launcher') launcher = args[i + 1];
      else throw new Error('未知查看参数');
    }
  } else {
    if (args.length > 1) throw new Error('用法：node codex-watch.mjs [仓库目录]');
    file = latestProgress(args[0] || process.cwd());
  }
  // 启动后立刻移除一次性文件；仅尝试删除指定文件及其空目录。
  if (launcher && basename(launcher) === 'watch.command' && basename(dirname(launcher)).startsWith('dispatchdock-watch-')) {
    try { unlinkSync(launcher); } catch {}
    try { rmdirSync(dirname(launcher)); } catch {}
  }
  if (!file) { console.log('还没有任务进度'); return; }
  if (process.stdout.isTTY) {
    const title = `Codex ${name || basename(file, '.progress.log')}（只看）`.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    process.stdout.write(`\x1b]0;${title}\x07`);
  }
  const stop = followProgress(file);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { stop(); process.exit(0); });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
