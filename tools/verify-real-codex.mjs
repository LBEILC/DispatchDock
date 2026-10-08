// 手动运行一次真实小任务；不纳入 npm run verify，不修改真实派发配置或安装。
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = mkdtempSync(join(tmpdir(), 'dispatch 真实验收 '));
const root = join(base, '中文 仓库'), home = join(base, '隔离 配置');
mkdirSync(root); mkdirSync(home);
writeFileSync(join(home, 'config.json'), JSON.stringify({ v: 1 }));
const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8', shell: false, windowsHide: true });
assert.equal(git.status, 0, git.stderr);
const env = { ...process.env };
for (const key of ['CODEX_DISPATCH_TEST_AGENT', 'CODEX_DRY_RUN', 'CODEX_MODEL', 'CODEX_EFFORT', 'CODEX_TIER']) delete env[key];
Object.assign(env, { CODEX_DISPATCH_HOME: home, CODEX_SANDBOX: 'read-only', CODEX_NO_WATCH: '1' });
const entry = fileURLToPath(new URL('../skills/codex-dispatch/codex-task.mjs', import.meta.url));
const child = spawn(process.execPath, [entry, '只回复 OK，不改任何文件', '--name', '中文 验收'], { cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
const rows = readFileSync(join(home, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const start = rows[0];
const events = readFileSync(start.events, 'utf8').trim().split('\n').map(JSON.parse);
const progress = readFileSync(start.progress, 'utf8');
const report = readFileSync(start.report, 'utf8');
const evidence = { code, agentVersion: start.agentVersion, sandbox: start.sandbox, report: report.trim(), events: events.slice(0, 4),
  eventCount: events.length, completed: /=== Codex 结束：exit=0/.test(progress), noDep0190: !/DEP0190/.test(stderr), base };
writeFileSync(join(base, 'evidence.json'), JSON.stringify({ ...evidence, stdout, stderr }, null, 2));
console.log(JSON.stringify(evidence, null, 2));
assert.equal(code, 0, stderr); assert.equal(rows.at(-1).exit, 0); assert.equal(report.trim(), 'OK');
assert.ok(evidence.completed); assert.ok(evidence.noDep0190);
assert.ok(events.some(e => e.kind === 'say' && e.text.trim() === 'OK')); assert.ok(events.some(e => e.kind === 'turn'));
