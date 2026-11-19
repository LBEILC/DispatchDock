import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, homeDirectory, importProfiles } from './lib/config.mjs';
import { resolveActor } from './lib/invoke.mjs';
import { agentEnvironment } from './lib/profiles.mjs';
import { selectAdapter } from './adapters/bridge.mjs';
import { planWorkflow, runWorkflow } from './lib/workflow.mjs';

const legacy = fileURLToPath(new URL('./codex-task.mjs', import.meta.url));
async function main(args) {
  const [command, file, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log('DispatchDock\n  agents import <配置.json> [--replace]\n  agents list\n  agents check <AI配置名>\n  plan <工作流.json> --out <计划.json>\n  workflow <工作流.json> [--resume]\n  run <计划.json> [--resume]\n  task <任务文字或文件> [--agent <AI配置名>]\n  status <队列名>\n  stop <记录名>'); return 0;
  }
  if (command === 'agents') {
    if (file === 'import') {
      if (!rest[0] || rest.slice(1).some(arg => arg !== '--replace')) throw Error('用法：agents import <配置.json> [--replace]');
      const data = JSON.parse(await readFile(path.resolve(rest[0]), 'utf8'));
      console.log(JSON.stringify(importProfiles(homeDirectory(), data.agents, { replace: rest.includes('--replace') }), null, 2)); return 0;
    }
    const state = readConfig(homeDirectory()); if (state.reason) throw Error(state.reason);
    if (file === 'list' && !rest.length) { console.log(JSON.stringify({ profiles: [...new Set(['codex', 'deepseek', ...Object.keys(state.config.agents ?? {})])] }, null, 2)); return 0; }
    if (file !== 'check' || rest.length !== 1) throw Error('用法：agents list | agents check <配置名>');
    const { actor, settings } = resolveActor(state.config, rest[0]);
    const env = agentEnvironment(settings, process.env, actor.agent), adapter = selectAdapter(actor.agent, settings);
    const detection = await adapter.detect({ env, settings });
    const keys = [...(settings.credentialEnv ?? []), ...(settings.api ? [settings.api.apiKeyEnv] : actor.agent === 'deepseek' ? ['DEEPSEEK_API_KEY'] : [])];
    const credentials = Object.fromEntries(keys.map(key => [key, Object.entries(env).some(([name, value]) => name.toLowerCase() === key.toLowerCase() && !!value)]));
    const ready = detection.installed && Object.values(credentials).every(Boolean) && (settings.api ? !!settings.model : true);
    console.log(JSON.stringify({ agent: actor.agent, adapter: settings.adapter ?? actor.agent, model: settings.model, ready, networkChecked: false, installed: detection.installed, version: detection.version, credentials, ...(detection.error ? { error: detection.error } : {}) }, null, 2)); return ready ? 0 : 1;
  }
  if (command === 'plan' || command === 'workflow') {
    if (!file) throw Error('需要工作流 JSON 路径');
    const request = JSON.parse(await readFile(path.resolve(file), 'utf8'));
    if (command === 'workflow') {
      if (rest.some(arg => arg !== '--resume')) throw Error('workflow 只接受 --resume');
      return runWorkflow({ request, resume: rest.includes('--resume') });
    }
    if (rest.length !== 2 || rest[0] !== '--out') throw Error('用法：plan <工作流.json> --out <计划.json>');
    const { plan } = await planWorkflow({ request }); await writeFile(path.resolve(rest[1]), JSON.stringify(plan, null, 2), { flag: 'wx' }); console.log(`计划已写入：${path.resolve(rest[1])}`); return 0;
  }
  const mapped = { run: ['--queue'], status: ['--queue-status'], stop: ['--stop'], task: [] }[command];
  if (!mapped || !file) throw Error('命令无效，运行 help 查看用法');
  return new Promise((resolve, reject) => { const child = spawn(process.execPath, [legacy, ...mapped, file, ...rest], { stdio: 'inherit', shell: false, windowsHide: true }); child.once('error', reject); child.once('close', code => resolve(code ?? 1)); });
}
main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
