import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export function canonicalPath(file) {
  const original = resolve(file), tail = [];
  let current = original;
  // 新增或已删除的文件也要解析父目录别名，例如 macOS 的 /var → /private/var。
  while (true) {
    try { return resolve(realpathSync(current), ...tail.reverse()); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) return original; }
    const parent = dirname(current);
    if (parent === current) return original;
    tail.push(basename(current)); current = parent;
  }
}
