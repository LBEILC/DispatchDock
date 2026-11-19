import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runQueue, validatePlan } from '../skills/codex-dispatch/lib/queue.mjs';
import { runProgram } from '../skills/codex-dispatch/lib/program.mjs';

const entry = fileURLToPath(new URL('../skills/codex-dispatch/codex-task.mjs', import.meta.url));
async function fixture(t, { badFirst = false, gateFirst = false } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'dispatchdock-queue-')), root = path.join(base, 'repo'), home = path.join(base, 'home');
  await mkdir(root); await mkdir(home);
  await writeFile(path.join(root, '.gitignore'), '.codex-runs/\n');
  await writeFile(path.join(root, 'calc.mjs'), 'export function add(a,b){return 0;}\n');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, windowsHide: true }).status, 0);
  await writeFile(path.join(home, 'config.json'), '{"v":1}');
  let writes = 0, requests = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); requests++;
    if (gateFirst && requests === 1) await gate;
    let message, finish;
    if (body.messages.at(-1).role === 'user') {
      writes++;
      const second = body.messages.at(-1).content.includes('SECOND');
      const content = second ? 'done' : badFirst && writes === 1 ? 'export function add(a,b){return a-b;}' : '// 加法\nexport function add(a,b){return a+b;}';
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: second ? 'second.txt' : 'calc.mjs', content }) } }] }; finish = 'tool_calls';
    } else { message = { role: 'assistant', content: '完成修改，请独立验收。' }; finish = 'stop'; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { release(); await new Promise(resolve => server.close(resolve)); await rm(base, { recursive: true, force: true, maxRetries: 5 }); });
  const env = { ...process.env, CODEX_DISPATCH_HOME: home, CODEX_NO_WATCH: '1', DEEPSEEK_API_KEY: 'fake-key-not-persisted', DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}` }; delete env.CODEX_DRY_RUN;
  const check = { name: 'unit', executable: process.execPath, args: ['-e', 'import("./calc.mjs").then(m=>process.exit(m.add(2,3)===5?0:1))'], timeoutMs: 5000 };
  const plan = { v: 1, name: 'night', worker: { model: 'fake-model' }, limits: { maxAttempts: 3, maxRequests: 30, maxTokens: 100000 }, tasks: [{ id: 'sum', prompt: '实现正确加法', acceptance: 'add(2,3) 返回 5', files: ['calc.mjs'], checks: [check] }] };
  return { base, root, home, env, plan, release, options: { plan, root, env, scriptPath: entry }, requests: () => requests };
}
test('队列独立检查失败后返工、模型验收返工、通过后才进入下一项', async t => {
  const f = await fixture(t, { badFirst: true }); let reviews = 0;
  f.plan.tasks.push({ id: 'second', prompt: 'SECOND 创建完成标记', acceptance: 'second.txt 内容为 done', files: ['second.txt'], checks: [{ name: 'mark', executable: process.execPath, args: ['-e', 'process.exit(require("node:fs").readFileSync("second.txt","utf8")==="done"?0:1)'], timeoutMs: 5000 }] });
  const code = await runQueue({ ...f.options, reviewer: async () => ({ decision: ++reviews === 1 ? 'rework' : 'accept', feedback: reviews === 1 ? '请检查加法注释' : '已核对实际文件' }) });
  assert.equal(code, 0);
  const stateText = await readFile(path.join(f.root, '.codex-runs/night.queue.json'), 'utf8'), state = JSON.parse(stateText);
  assert.equal(state.status, 'done'); assert.equal(state.tasks[0].attempts, 3); assert.equal(state.tasks[1].attempts, 1);
  assert.equal(state.reviews, 3); assert.equal(state.requests, 8); assert.equal(state.tokens, 160);
  assert.equal(await readFile(path.join(f.root, 'second.txt'), 'utf8'), 'done');
  assert.doesNotMatch(stateText, /fake-key-not-persisted/);
});
test('中断后的恢复保留预算、尝试次数和实际修改，不重跑已完成任务', async t => {
  const f = await fixture(t);
  await assert.rejects(runQueue({ ...f.options, reviewer: async () => { throw Error('模拟验收中断'); } }), /模拟验收中断/);
  const code = await runQueue({ ...f.options, resume: true, reviewer: async () => ({ decision: 'accept', feedback: '恢复后检查通过' }) });
  assert.equal(code, 0);
  const state = JSON.parse(await readFile(path.join(f.root, '.codex-runs/night.queue.json'), 'utf8'));
  assert.equal(state.tasks[0].attempts, 2); assert.equal(state.requests, 4); assert.equal(state.reviews, 2);
  const requests = f.requests(); await runQueue({ ...f.options, resume: true, reviewer: async () => { throw Error('不应再验收'); } });
  assert.equal(f.requests(), requests);
});
test('队列预算耗尽不把任务当成功，也不重置恢复时的预算', async t => {
  const f = await fixture(t); f.plan.limits.maxReviews = 1;
  const reviewer = async () => ({ decision: 'rework', feedback: '需要返工' });
  assert.equal(await runQueue({ ...f.options, reviewer }), 1);
  let state = JSON.parse(await readFile(path.join(f.root, '.codex-runs/night.queue.json'), 'utf8'));
  assert.equal(state.status, 'limited'); const requests = f.requests();
  assert.equal(await runQueue({ ...f.options, resume: true, reviewer }), 1);
  state = JSON.parse(await readFile(path.join(f.root, '.codex-runs/night.queue.json'), 'utf8'));
  assert.equal(f.requests(), requests); assert.equal(state.reviews, 1);
});
test('队列拒绝缺少检查、凭据字段和越界文件，计划变化不能恢复', async t => {
  const f = await fixture(t);
  assert.throws(() => validatePlan({ ...f.plan, worker: { ...f.plan.worker, apiKey: 'fake' } }), /凭据/);
  assert.throws(() => validatePlan({ ...f.plan, tasks: [{ ...f.plan.tasks[0], checks: [] }] }), /检查/);
  assert.throws(() => validatePlan({ ...f.plan, tasks: [{ ...f.plan.tasks[0], files: ['../outside'] }] }), /策略/);
  await runQueue({ ...f.options, reviewer: async () => ({ decision: 'accept', feedback: '通过' }) });
  f.plan.tasks[0].acceptance = '改变验收';
  await assert.rejects(runQueue({ ...f.options, resume: true }), /计划已改变/);
});

test('真实 CLI 的 Codex 验收契约、停止进程树和中断锁恢复', async t => {
  const f = await fixture(t, { gateFirst: true });
  f.plan.limits.maxTokens = 300000; f.plan.limits.maxRequests = 100;
  f.env.DeepSeek_Api_Key = 'fake-mixed-case-key';
  const reviewerFile = path.join(f.base, 'fake-codex.mjs');
  const envLog = path.join(f.base, 'review-env.jsonl');
  await writeFile(reviewerFile, `import fs from 'node:fs';const secretPresent=Object.keys(process.env).some(key=>key.toLowerCase()==='deepseek_api_key');fs.appendFileSync(${JSON.stringify(envLog)},JSON.stringify({version:process.argv.includes('--version'),secretPresent})+'\\n');if(secretPresent)process.exit(17);if(process.argv.includes('--version')){console.log('codex-cli fake-queue');process.exit(0);}process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({decision:'accept',feedback:'隔离契约检查通过'}));});`);
  f.plan.supervisor = { path: reviewerFile };
  const planFile = path.join(f.base, 'plan.json'); await writeFile(planFile, JSON.stringify(f.plan));
  const child = spawn(process.execPath, [entry, '--queue', planFile], { cwd: f.root, env: f.env, stdio: 'ignore', windowsHide: true, shell: false });
  const closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const deadline = Date.now() + 15000;
  while (!f.requests()) { if (Date.now() > deadline) throw Error('队列未开始请求'); await delay(25); }
  const stateFile = path.join(f.root, '.codex-runs/night.queue.json'), state = JSON.parse(await readFile(stateFile, 'utf8'));
  const stopped = await runProgram(process.execPath, [entry, '--stop', state.run], { root: f.root, env: f.env, timeoutMs: 15000 });
  assert.equal(stopped.code, 0, stopped.stdout + stopped.stderr);
  await closed; f.release();
  const restored = await runProgram(process.execPath, [entry, '--queue', planFile, '--resume'], { root: f.root, env: f.env, timeoutMs: 20000 });
  assert.equal(restored.code, 0, restored.stdout + restored.stderr);
  const after = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(after.status, 'done'); assert.equal(after.tasks[0].attempts, 2);
  assert.ok(after.tokens >= 100000, '中断请求的未知用量不能被恢复清零');
  const launches = (await readFile(envLog, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(launches.some(value => value.version)); assert.ok(launches.some(value => !value.version));
  assert.ok(launches.every(value => !value.secretPresent), '版本检测和实际验收都不能获得任何大小写的 DS key');
});
test('不同队列名也不能并发修改同一个工作树', async t => {
  const f = await fixture(t); let reviewing = false, release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const first = runQueue({ ...f.options, reviewer: async () => { reviewing = true; await gate; return { decision: 'accept', feedback: '通过' }; } });
  while (!reviewing) await delay(25);
  await assert.rejects(runQueue({ ...f.options, plan: { ...f.plan, name: 'different' }, resume: true }), /已在运行/);
  release(); assert.equal(await first, 0);
});
test('恢复不能把中断前清单之外的改动重新作为基线', async t => {
  const f = await fixture(t);
  await assert.rejects(runQueue({ ...f.options, reviewer: async () => { await writeFile(path.join(f.root, 'outside.txt'), '未经授权'); throw Error('模拟范围核对前中断'); } }), /模拟范围/);
  const before = f.requests();
  await assert.rejects(runQueue({ ...f.options, resume: true, reviewer: async () => ({ decision: 'accept', feedback: '不应运行' }) }), /恢复前发现/);
  assert.equal(f.requests(), before);
});
