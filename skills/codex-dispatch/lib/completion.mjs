import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { clip } from './progress.mjs';

// 两种等待入口共用结束输出；事件只用于补充原因，不参与状态判断。
export async function printCompletion(exit, paths, log = console.log) {
  if (exit !== 0 && paths.events) {
    const input = createReadStream(paths.events, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.kind === 'error') log(`出错：${clip(String(event.text))}`);
      }
    } catch { /* 事件文件不可读时仍返回清单中的结果。 */ }
    finally { lines.close(); input.destroy(); }
  }
  log(`exit=${exit} report=${paths.report}`);
  return exit;
}
