import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readConfig, homeDirectory } from './config.mjs';
import { invokeAgent } from './invoke.mjs';
import { runQueue, validatePlan } from './queue.mjs';
import { acquireLease } from './lease.mjs';

export const taskSchema = { type: 'object', properties: { tasks: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { id: { type: 'string' }, prompt: { type: 'string' }, acceptance: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['id', 'prompt', 'acceptance', 'files'], additionalProperties: false } } }, required: ['tasks'], additionalProperties: false };
const scriptPath = fileURLToPath(new URL('../codex-task.mjs', import.meta.url));

export function validateWorkflow(request) {
  if (typeof request?.goal !== 'string' || !request.goal.trim() || !request.director) throw Error('工作流需要 goal 和 director AI 配置');
  validatePlan({ ...request, tasks: [{ id: 'authority', prompt: request.goal, acceptance: request.goal, files: request.files, checks: request.checks, ...(request.contextFiles ? { contextFiles: request.contextFiles } : {}), ...(request.role ? { role: request.role } : {}) }] });
  return request;
}

export async function planWorkflow({ request, root = process.cwd(), env = process.env, folder } = {}) {
  validateWorkflow(request);
  const config = readConfig(homeDirectory(env));
  if (config.reason) throw Error('AI 配置文件无效：' + config.reason);
  folder ??= path.join(root, '.codex-runs', request.name + '.planning-' + randomUUID());
  const prompt = `你是任务规划上级。将目标拆成可顺序执行、可检查的任务卡，返回指定 JSON。不要执行任务，不修改文件，不增加权限或预算。目标：${request.goal}\n只能修改这些文件：${JSON.stringify(request.files)}\n已固定的检查：${JSON.stringify(request.checks.map(check => check.name))}\n验收要求：${request.acceptance ?? request.goal}\n每个任务 files 必须是上面文件清单的子集；不要发明命令。优先少量明确任务。`;
  const { value, agent } = await invokeAgent({ config: config.config, selection: request.director, operation: 'plan', prompt, root, folder, outputSchema: taskSchema, env });
  if (!Array.isArray(value?.tasks) || !value.tasks.length) throw Error('规划者没有返回任务清单');
  const tasks = value.tasks.map(task => {
    if (!Array.isArray(task.files) || !task.files.length || task.files.some(file => !request.files.includes(file))) throw Error('规划者扩大了允许修改的文件范围，计划未采用');
    return { id: task.id, prompt: task.prompt, acceptance: task.acceptance, files: task.files, checks: request.checks, ...(request.contextFiles ? { contextFiles: request.contextFiles } : {}), ...(request.role ? { role: request.role } : {}) };
  });
  const plan = { v: 1, name: request.name, director: request.director, worker: request.worker, ...(request.reviewer !== undefined ? { reviewer: request.reviewer } : { supervisor: request.supervisor }), ...(request.limits ? { limits: request.limits } : {}), ...(request.onFailure ? { onFailure: request.onFailure } : {}), tasks };
  validatePlan(plan);
  await writeFile(path.join(folder, 'adopted-plan.json'), JSON.stringify(plan, null, 2));
  return { plan, director: agent };
}

export async function runWorkflow({ request, root = process.cwd(), env = process.env, resume = false } = {}) {
  validateWorkflow(request);
  const dir = path.join(root, '.codex-runs'); await mkdir(dir, { recursive: true });
  const release = await acquireLease(path.join(dir, request.name + '.workflow.lock'), request.name, { resume });
  try {
  const file = path.join(dir, request.name + '.workflow.json');
  const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  let snapshot;
  try { snapshot = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (snapshot && !resume) throw Error('工作流已经规划过；继续请用 --resume，或使用新名称');
  if (snapshot && snapshot.requestHash !== digest) throw Error('工作流目标或授权范围改变，不能自动恢复旧计划');
  if (!snapshot) {
    const { plan } = await planWorkflow({ request, root, env });
    snapshot = { v: 1, requestHash: digest, plan };
    await writeFile(file, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  }
  // 计划已经固定，但队列可能在写入状态前中断；恢复锁与初始化状态分开判断。
  return await runQueue({ plan: snapshot.plan, root, env, scriptPath, resume, initializeMissing: resume });
  } finally { await release(); }
}
