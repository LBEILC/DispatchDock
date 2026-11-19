import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runQueue } from './lib/queue.mjs';
import { invokeAgent } from './lib/invoke.mjs';
import { readConfig, homeDirectory } from './lib/config.mjs';
export async function invoke({ agent, selection = agent, root = process.cwd(), env = process.env, folder = path.join(root, '.codex-runs', 'invoke-' + randomUUID()), config, ...options }) {
  if (!config) { const state = readConfig(homeDirectory(env)); if (state.reason) throw Error(state.reason); config = state.config; }
  return invokeAgent({ ...options, selection, root, env, folder, config });
}
export { planWorkflow as plan, runWorkflow as workflow } from './lib/workflow.mjs';
export async function run({ plan, root = process.cwd(), env = process.env, resume = false }) {
  return runQueue({ plan, root, env, resume, scriptPath: fileURLToPath(new URL('./codex-task.mjs', import.meta.url)) });
}
