// 在目标仓库运行；技能目录可整体复制，不需要安装依赖。
import { fileURLToPath } from 'node:url';
import { run } from './lib/run.mjs';
import { codex } from './adapters/codex.mjs';

try {
  process.exitCode = await run({ adapter: codex, scriptPath: fileURLToPath(import.meta.url) });
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
