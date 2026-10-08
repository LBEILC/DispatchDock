import { execFileSync } from 'node:child_process';
import { readFile, lstat, realpath, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const excluded = name => ['docs/internal.md', 'docs/handoff.md'].includes(name) || ['docs/specs/', '.claude/'].some(prefix => name.startsWith(prefix));
export async function exportPublic(root, output, log = console.log) {
  root = await realpath(root);
  if (!output) throw Error('用法：npm run export:public -- <输出目录>');
  output = path.resolve(output);
  const relative = path.relative(output, root);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw Error('输出目录不能是仓库或仓库的父目录');
  try {
    const info = await lstat(output);
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(output)).length) throw Error('输出目录必须不存在或为空目录');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let rules = null;
  try {
    const source = await readFile(path.join(root, 'docs/internal.md'), 'utf8');
    const blocks = [...source.matchAll(/^```forbidden\s*\r?\n([\s\S]*?)^```\s*$/gm)];
    const lines = blocks.flatMap(block => block[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    if (!lines.length) throw Error('内部禁用词清单没有有效规则');
    rules = lines.map((line, i) => { try { return new RegExp(line, 'i'); } catch { throw Error(`禁用词规则 ${i + 1} 无效`); } });
  } catch (error) { if (error.code !== 'ENOENT') throw error; log('没有内部禁用词清单，跳过扫描'); }
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean))].filter(name => !excluded(name)).sort();
  // 即使误将忽略文件加入索引，也不将其带入公开集合。
  const ignored = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--ignored', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0'));
  const entries = [], hits = [];
  for (const name of files.filter(name => !ignored.has(name))) {
    if (path.isAbsolute(name) || name.split('/').includes('..')) throw Error('Git 返回了不安全的相对路径');
    const filename = path.join(root, name), info = await lstat(filename);
    const actual = path.relative(root, await realpath(filename));
    if (!info.isFile() || info.isSymbolicLink() || actual.startsWith('..') || path.isAbsolute(actual)) throw Error(`只导出仓库内的普通文件：${name}`);
    const bytes = await readFile(filename);
    let content, binary = bytes.includes(0);
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { binary = true; }
    if (binary) content = bytes.toString('latin1');
    rules?.forEach((rule, i) => {
      if (binary) { if (rule.test(content)) hits.push(`${name}：规则 ${i + 1}（二进制）`); }
      else {
        // 对全文匹配，保留规则跨行匹配的能力；只输出命中起点的行号。
        for (const match of content.matchAll(new RegExp(rule.source, 'gi'))) {
          const lineNumber = content.slice(0, match.index).split('\n').length;
          hits.push(`${name}:${lineNumber}：规则 ${i + 1}`);
        }
      }
    });
    entries.push({ name, bytes, mode: info.mode });
  }
  if (hits.length) throw Error(`公开扫描失败：\n${hits.join('\n')}`);
  // 全部扫描通过后才写出，避免把已知含禁用内容的半成品留给发布者。
  await mkdir(output, { recursive: true });
  for (const entry of entries) {
    const target = path.join(output, entry.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, { mode: entry.mode, flag: 'wx' });
  }
  const distribution = {};
  for (const { name } of entries) { const group = name.includes('/') ? name.split('/')[0] + '/' : '(根目录)'; distribution[group] = (distribution[group] || 0) + 1; }
  const summary = { count: entries.length, distribution, files: entries.map(entry => entry.name) };
  log(JSON.stringify(summary, null, 2));
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 3) throw Error('用法：npm run export:public -- <输出目录>'); await exportPublic(process.cwd(), process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
