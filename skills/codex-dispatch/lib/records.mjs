import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function registryWriter(home) {
  return record => {
    try {
      mkdirSync(home, { recursive: true });
      appendFileSync(join(home, 'runs.jsonl'), `${JSON.stringify({ v: 1, ...record })}\n`);
    } catch { /* 协议规定：清单写入失败不影响任务。 */ }
  };
}

export function recordPaths(root, requested, header, dryRun = false) {
  const runs = join(root, '.codex-runs');
  if (!dryRun) mkdirSync(runs, { recursive: true });
  for (let n = 1; ; n++) {
    const name = n === 1 ? requested : `${requested}-${n}`;
    const progress = join(runs, `${name}.progress.log`);
    if (dryRun) { if (existsSync(progress)) continue; }
    else {
      // 独占创建使并发派发也不会占用同一个记录名。
      try { writeFileSync(progress, header, { flag: 'wx' }); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    }
    return { name, progress, report: join(runs, `${name}.md`), raw: join(runs, `${name}.log`), events: join(runs, `${name}.events.jsonl`) };
  }
}
