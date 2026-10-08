import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDirectory } from '../../skills/codex-dispatch/lib/config.mjs';

export function readCodexConfig(env = process.env) {
  const file = join(env.CODEX_HOME || join(userDirectory(env), '.codex'), 'config.toml');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*(model|model_reasoning_effort|service_tier)\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*(?:#.*)?$/);
    if (!match) continue;
    try { values[match[1]] = match[2][0] === '"' ? JSON.parse(match[2]) : match[2].slice(1, -1); } catch { /* 无法解析的单行值显示未设置。 */ }
  }
  return { file, values };
}
