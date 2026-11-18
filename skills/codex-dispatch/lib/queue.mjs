import { readFile, writeFile, rename, mkdir, open, unlink, lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runProgram, checkEnvironment, reviewEnvironment } from './program.mjs';
import { processCreated, pidAlive } from './process.mjs';
import { homeDirectory } from './config.mjs';
import { registryWriter, recordPaths } from './records.mjs';
import { progressHeader, progressFooter, formatProgress } from './progress.mjs';
import { codex } from '../adapters/codex.mjs';
import { validatePolicy, blockedPath, runCheck, within } from '../workers/workspace.mjs';
import { validFile } from '../workers/workspace.mjs';

const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const hash = text => createHash('sha256').update(text).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => { const temp = file + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, file); };
const ownerAlive = async owner => {
  if (!pidAlive(owner.pid)) return false;
  const actual = await processCreated(owner.pid);
  return actual === null || owner.created === null || actual === owner.created;
};
const schema = { type: 'object', properties: { decision: { type: 'string', enum: ['accept', 'rework', 'stop'] }, feedback: { type: 'string' } }, required: ['decision', 'feedback'], additionalProperties: false };

export function validatePlan(plan) {
  if (plan?.v !== 1 || !idPattern.test(plan.name) || !plan.worker?.model || typeof plan.worker.model !== 'string' || !Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > 100) throw Error('队列计划需要 v、name、worker.model 和 1～100 个任务');
  const names = new Set();
  for (const task of plan.tasks) {
    if (!idPattern.test(task.id) || names.has(task.id) || typeof task.prompt !== 'string' || !task.prompt.trim() || typeof task.acceptance !== 'string' || !task.acceptance.trim()) throw Error('任务 ID、说明或验收条件无效');
    names.add(task.id); validatePolicy({ v: 1, files: task.files, checks: task.checks });
    if (task.role !== undefined && !idPattern.test(task.role)) throw Error('任务角色必须是仓库中的角色文档名称');
    if (task.contextFiles !== undefined && (!Array.isArray(task.contextFiles) || !task.contextFiles.every(validFile))) throw Error('contextFiles 必须是明确的仓库文件清单');
    if (!task.checks.length || new Set(task.checks.map(check => check.name)).size !== task.checks.length) throw Error('每项任务至少需要一项名称唯一的检查');
  }
  const limits = { maxMinutes: 480, maxAttempts: 3, maxRequests: 120, maxTokens: 600000, maxReviews: 30, attemptRequests: 12, attemptTokens: 100000, ...plan.limits };
  for (const [name, max] of [['maxMinutes', 1440], ['maxAttempts', 5], ['maxRequests', 10000], ['maxTokens', 10000000], ['maxReviews', 300], ['attemptRequests', 256], ['attemptTokens', 2000000]]) if (!Number.isInteger(limits[name]) || limits[name] < 1 || limits[name] > max) throw Error('队列限额无效');
  if (limits.attemptTokens < 4096) throw Error('单次 token 预算至少为 4096');
  if (plan.onFailure !== undefined && !['stop', 'continue'].includes(plan.onFailure)) throw Error('onFailure 必须为 stop 或 continue');
  // 凭据只能从进程环境提供，不允许悄悄落到计划或状态文件。
  const secret = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => /^(?:api_?key|authorization|password|secret)$/i.test(key) || secret(child));
  if (secret(plan)) throw Error('队列计划不能包含凭据字段');
  return { ...plan, limits };
}

async function workspaceSnapshot(root, env) {
  const result = await runProgram('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { root, env: checkEnvironment(env), maxOutput: 4 * 1024 * 1024 });
  if (result.code) throw Error('队列必须在可读取的 Git 仓库中执行');
  if (result.truncated) throw Error('仓库文件清单超过快照上限，不能在不完整证据上继续验收');
  const files = [...new Set(result.stdout.split('\0').filter(file => file && (!blockedPath(file) || /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(file))))];
  const snapshot = {};
  for (const file of files) {
    const full = path.join(root, file);
    try { const info = await lstat(full); snapshot[file] = info.isSymbolicLink() ? 'link:' + await readlink(full) : info.isFile() ? hash(await readFile(full)) : 'other'; }
    catch (error) { if (error.code === 'ENOENT') snapshot[file] = 'missing'; else throw error; }
  }
  return snapshot;
}

function outsideChanges(before, after, files) {
  const allowed = new Set(files.map(file => process.platform === 'win32' ? file.toLowerCase() : file));
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file] && !allowed.has(process.platform === 'win32' ? file.toLowerCase() : file));
}

async function reviewTask(root, task, checkResults, report, folder, supervisor, env) {
  const schemaFile = path.join(folder, 'review-schema.json'), verdictFile = path.join(folder, 'verdict.json');
  await save(schemaFile, schema);
  const settings = { sandbox: 'read-only', model: supervisor?.model ?? null, effort: supervisor?.effort ?? null, tier: null, path: supervisor?.path ?? null };
  const reviewEnv = reviewEnvironment(env);
  const detection = codex.detect({ env: reviewEnv, settings });
  if (!detection.installed) throw Error(detection.error || '找不到 Codex 验收执行端');
  const prompt = `这是临时小任务。你在本项目中的角色是只读验收负责人。检查实际文件，不修改、提交或发布任何文件，不执行项目代码。任务：${task.prompt}\n验收条件：${task.acceptance}\n允许修改：${JSON.stringify(task.files)}\n独立检查结果：${JSON.stringify(checkResults)}\n下级汇报仅为线索，不代表通过：\n${report.slice(0, 32000)}\n请读取实际产物，判断是否完成任务和存在阻塞缺陷。只有验收条件满足且检查全通过才能 accept；可修复问题返回 rework 和具体证据；越权、范围冲突或无法自动判断返回 stop。最后只输出符合 schema 的 JSON。`;
  const command = codex.command({ root, report: verdictFile, prompt, settings, detection, env: reviewEnv });
  command.args.splice(command.args.length - 1, 0, '--output-schema', schemaFile, '--ephemeral');
  const result = await runProgram(command.executable, command.args, { root, env: reviewEnv, stdin: prompt, timeoutMs: Math.min(supervisor?.timeoutMs ?? 300000, 600000) });
  const redact = text => text.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]');
  const errors = result.stdout.split('\n').flatMap(line => codex.mapLine(line, { root })).filter(event => event.kind === 'error').map(event => redact(event.text));
  await save(path.join(folder, 'review-result.json'), { code: result.code, timedOut: result.timedOut, stderr: redact(result.stderr.slice(-8000)), errors });
  if (result.code) throw Error('Codex 验收未正常完成，队列停止，未把模型失败当作验收通过。' + (errors.at(-1)?.slice(0, 1000) ?? ''));
  const verdict = await json(verdictFile);
  if (!['accept', 'rework', 'stop'].includes(verdict.decision) || typeof verdict.feedback !== 'string') throw Error('Codex 验收返回无效判定');
  return verdict;
}

export async function runQueue({ plan: input, root, scriptPath, env = process.env, resume = false, reviewer = reviewTask } = {}) {
  const plan = validatePlan(input), digest = hash(JSON.stringify(plan));
  const runs = path.join(root, '.codex-runs'); await mkdir(runs, { recursive: true });
  const stateFile = path.join(runs, plan.name + '.queue.json'), lockFile = path.join(runs, '.queue-workspace.lock');
  const created = await processCreated(process.pid);
  let lease;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lease = await open(lockFile, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await json(lockFile);
      if (await ownerAlive(owner)) throw Error('队列已在运行，不能重复启动');
      if (owner.name !== plan.name) throw Error('该工作树有其他队列的中断现场，请先核对并恢复原队列');
      if (!resume) throw Error('队列留下了中断锁，请使用 --resume 核对并恢复');
      // 恢复操作也要互斥，不能让两个恢复者分别删掉对方新取得的锁。
      const recoveryFile = lockFile + '.recovery';
      let recovery;
      try { recovery = await open(recoveryFile, 'wx'); }
      catch (error) { if (error.code === 'EEXIST') throw Error('已有另一个恢复操作，或恢复锁需要人工核对'); throw error; }
      try {
        const latest = await json(lockFile);
        if (await ownerAlive(latest)) throw Error('队列已经恢复运行');
        await unlink(lockFile); lease = await open(lockFile, 'wx');
      } finally { await recovery.close(); await unlink(recoveryFile); }
      break;
    }
  }
  if (!lease) throw Error('不能取得队列锁');
  await lease.writeFile(JSON.stringify({ name: plan.name, pid: process.pid, created })); await lease.close();
  let paths, registry, id, state, exit = 1, sequence = 0;
  const emit = async event => {
    const record = { ...event, v: 1, seq: ++sequence, at: Date.now() };
    const { appendFile } = await import('node:fs/promises');
    await appendFile(paths.events, JSON.stringify(record) + '\n');
    for (const line of formatProgress(record)) await appendFile(paths.progress, line + '\n');
  };
  try {
    let existing;
    try { existing = await json(stateFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && !resume) throw Error('队列已有状态；继续请显式加 --resume，或使用新名称');
    if (resume && !existing) throw Error('没有可恢复的队列状态');
    if (existing && existing.planHash !== digest) throw Error('队列计划已改变，不能沿用旧的验收和预算状态');
    state = existing ?? { v: 1, name: plan.name, planHash: digest, started: Date.now(), status: 'pending', requests: 0, tokens: 0, reviews: 0, tasks: plan.tasks.map(task => ({ id: task.id, status: 'pending', attempts: 0, feedback: '' })) };
    const deadline = state.started + plan.limits.maxMinutes * 60000;
    const timeLeft = () => Math.max(0, deadline - Date.now());
    paths = recordPaths(root, plan.name, progressHeader('队列：' + plan.name, null, Date.now()));
    await writeFile(paths.events, ''); await writeFile(paths.raw, '');
    id = paths.name + '-' + Date.now() + '-' + process.pid; registry = registryWriter(homeDirectory(env));
    registry({ event: 'start', id, repo: root, name: paths.name, title: '队列：' + plan.name, spec: null, role: 'supervisor', pid: process.pid, started: Date.now(), progress: paths.progress, report: paths.report, raw: paths.raw, events: paths.events, model: plan.worker.model, effort: null, tier: null, agent: 'queue', dispatcher: { host: 'codex', session: null } });
    state.status = 'running'; state.run = paths.name; await save(stateFile, state);
    console.log(`队列：${plan.name}\n记录名：${paths.name}\n状态：${stateFile}`);
    for (let index = 0; index < plan.tasks.length; index++) {
      const task = plan.tasks[index], item = state.tasks[index];
      if (['done', 'failed'].includes(item.status)) continue;
      if (item.evidence) {
        const evidence = path.resolve(root, item.evidence);
        if (!within(path.join(runs, plan.name + '.queue'), evidence) || path.basename(evidence) !== 'workspace-before.json') throw Error('恢复的范围证据路径无效');
        const changed = outsideChanges(await json(evidence), await workspaceSnapshot(root, env), task.files);
        if (changed.length) throw Error('恢复前发现原尝试清单以外的改动，保留现场并停止：' + changed.join(', '));
      } else if (!['pending', 'preparing'].includes(item.status)) throw Error('缺少未完成尝试的范围证据，不能自动建立新基线');
      if (item.status !== 'pending') item.feedback = `上次执行中断，保留实际文件，请核对后继续。\n${item.feedback}`;
      while (item.attempts < plan.limits.maxAttempts && item.status !== 'done') {
        const remaining = { requests: plan.limits.maxRequests - state.requests, tokens: plan.limits.maxTokens - state.tokens };
        if (timeLeft() < 1000 || remaining.requests < 1 || remaining.tokens < 4096 || state.reviews >= plan.limits.maxReviews) { state.status = 'limited'; item.status = 'blocked'; break; }
        const limits = { maxRequests: Math.min(plan.limits.attemptRequests, remaining.requests), maxTokens: Math.min(plan.limits.attemptTokens, remaining.tokens), maxMinutes: Math.max(1, Math.min(10, Math.ceil(timeLeft() / 60000))), maxToolCalls: 64 };
        // 启动前先持久化最坏用量；崩溃或用量未知时不退回额度。
        state.requests += limits.maxRequests; state.tokens += limits.maxTokens;
        item.attempts++; item.status = 'preparing'; delete item.evidence; await save(stateFile, state);
        const folder = path.join(runs, plan.name + '.queue', task.id, 'attempt-' + item.attempts); await mkdir(folder, { recursive: true });
        const policyFile = path.join(folder, 'policy.json'), ledgerFile = path.join(folder, 'worker-budget.json');
        await save(policyFile, { v: 1, files: task.files, checks: task.checks, limits, ledger: path.relative(root, ledgerFile), ...(task.contextFiles ? { readFiles: [...task.contextFiles, ...task.files, 'AGENTS.md', ...(task.role ? [`docs/roles/${task.role}.md`] : [])] } : {}) });
        await emit({ kind: 'plan', items: state.tasks.map(value => ({ text: value.id + ' · ' + value.status, done: value.status === 'done' })) });
        const before = await workspaceSnapshot(root, env);
        const evidence = path.join(folder, 'workspace-before.json'); await save(evidence, before);
        item.evidence = path.relative(root, evidence); item.status = 'running'; await save(stateFile, state);
        const attemptName = paths.name + '-' + task.id + '-' + item.attempts;
        const prompt = `${task.prompt}\n验收条件：${task.acceptance}\n允许修改的文件：${JSON.stringify(task.files)}\n上次检查或验收的返工意见：${item.feedback || '首次执行'}\n完成修改并运行授权检查；禁止提交、推送、发布或再次派发。`;
        const workerEnv = { ...env, CODEX_NO_WATCH: '1', CODEX_DISPATCH_NO_MANAGED: '1', DISPATCH_PARENT_ID: id }; delete workerEnv.CODEX_DRY_RUN;
        const worker = await runProgram(process.execPath, [scriptPath, prompt, '--agent', 'deepseek', '--host', 'codex', '--model', plan.worker.model, '--sandbox', 'workspace-write', '--policy', policyFile, '--name', attemptName, ...(task.role ? ['--role', task.role] : [])], { root, env: workerEnv, timeoutMs: Math.min(timeLeft(), 10 * 60000 + 10000) });
        let ledger;
        try { ledger = await json(ledgerFile); } catch { /* 缺失的用量保留全部预留，不假定零费用。 */ }
        if (ledger?.complete && !ledger.uncertain && Number.isInteger(ledger.requests) && ledger.requests >= 0 && Number.isInteger(ledger.tokens) && ledger.tokens >= 0) { state.requests += ledger.requests - limits.maxRequests; state.tokens += ledger.tokens - limits.maxTokens; }
        if (worker.code && /HTTP (401|402|403)\b/.test(worker.stdout)) { item.feedback = '接口凭据、权限或额度错误，停止自动重试'; item.status = 'blocked'; state.status = 'blocked'; await save(stateFile, state); break; }
        item.status = 'checking'; await save(stateFile, state);
        const changed = outsideChanges(before, await workspaceSnapshot(root, env), task.files);
        if (changed.length) { item.feedback = '出现允许范围之外的改动：' + changed.join(', '); item.status = 'blocked'; state.status = 'blocked'; break; }
        const results = [];
        for (const check of task.checks) {
          if (timeLeft() < 100) break;
          results.push(await runCheck(root, { ...check, timeoutMs: Math.min(check.timeoutMs, timeLeft()) }, env));
        }
        await save(path.join(folder, 'checks.json'), results);
        if (outsideChanges(before, await workspaceSnapshot(root, env), task.files).length) throw Error('检查命令修改了允许范围之外的文件，停止自动流程');
        const failures = results.filter(result => result.code !== 0);
        if (worker.code !== 0 || results.length !== task.checks.length || failures.length) {
          item.feedback = `执行端 exit=${worker.code}。独立检查：${JSON.stringify(results)}。${worker.code ? worker.stdout.slice(-4000) : ''}`;
          item.status = 'rework'; await emit({ kind: 'say', text: task.id + ' 检查未通过，进入返工' }); await save(stateFile, state); continue;
        }
        if (!timeLeft()) { state.status = 'limited'; item.status = 'blocked'; break; }
        item.status = 'reviewing'; state.reviews++; await save(stateFile, state);
        let report = ''; try { report = await readFile(path.join(runs, attemptName + '.md'), 'utf8'); } catch { /* 缺汇报由验收决定，不假造成功。 */ }
        const reviewBefore = await workspaceSnapshot(root, env);
        const verdict = await reviewer(root, task, results, report, folder, { ...plan.supervisor, timeoutMs: Math.min(plan.supervisor?.timeoutMs ?? 300000, timeLeft()) }, env);
        if (outsideChanges(reviewBefore, await workspaceSnapshot(root, env), []).length) throw Error('验收执行端修改了工作区，停止自动流程');
        item.feedback = verdict.feedback; item.status = verdict.decision === 'accept' ? 'done' : verdict.decision === 'rework' ? 'rework' : 'blocked';
        await emit({ kind: 'say', text: `${task.id} 验收：${verdict.decision} · ${verdict.feedback}` });
        if (verdict.decision === 'stop') state.status = 'blocked';
        await save(stateFile, state);
        if (item.status === 'blocked') break;
      }
      if (item.status !== 'done' && item.status !== 'blocked' && item.attempts >= plan.limits.maxAttempts) item.status = 'failed';
      await save(stateFile, state);
      if (['limited', 'blocked'].includes(state.status) || (item.status === 'failed' && plan.onFailure !== 'continue')) break;
    }
    if (state.tasks.every(task => task.status === 'done')) { state.status = 'done'; exit = 0; }
    else if (state.status === 'running') state.status = 'failed';
    await save(stateFile, state);
    await writeFile(paths.report, `# 队列 ${plan.name}\n\n状态：${state.status}\n\n${state.tasks.map(task => `- ${task.id}: ${task.status}，尝试 ${task.attempts} 次\n  ${task.feedback}`).join('\n')}\n\n用量（含未知请求的保守预留）：请求 ${state.requests}，token ${state.tokens}，Codex 验收 ${state.reviews} 次。\n`);
    return exit;
  } catch (error) {
    if (state) { state.status = 'blocked'; state.error = error.message; await save(stateFile, state); }
    if (paths) { await emit({ kind: 'error', text: error.message }); await writeFile(paths.report, '队列未完成：' + error.message); }
    throw error;
  } finally {
    if (paths && registry) { const minutes = (Date.now() - (state?.started ?? Date.now())) / 60000; const { appendFile } = await import('node:fs/promises'); await appendFile(paths.progress, progressFooter(exit, minutes.toFixed(1), paths.report)); registry({ event: 'end', id, exit, at: Date.now(), minutes }); }
    await unlink(lockFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function queueCommand({ args, root, env, scriptPath }) {
  if (args[0] === '--queue-status') {
    if (args.length !== 2 || !idPattern.test(args[1])) throw Error('用法：--queue-status <队列名>');
    const state = await json(path.join(root, '.codex-runs', args[1] + '.queue.json'));
    let runnerAlive = false;
    try { const owner = await json(path.join(root, '.codex-runs', '.queue-workspace.lock')); runnerAlive = owner.name === args[1] && await ownerAlive(owner); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log(JSON.stringify({ ...state, status: state.status === 'running' && !runnerAlive ? 'interrupted' : state.status, runnerAlive }, null, 2)); return 0;
  }
  if (!args[1] || args.slice(2).some(arg => arg !== '--resume')) throw Error('用法：--queue <计划.json> [--resume]');
  return runQueue({ plan: await json(path.resolve(root, args[1])), root, env, scriptPath, resume: args.includes('--resume') });
}
