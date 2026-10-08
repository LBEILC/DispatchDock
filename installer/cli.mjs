import { join } from 'node:path';
import { createPlan, executePlan, getStatus, rollbackPlan, version } from './lib/install.mjs';
import { homeDirectory, readConfig, writeConfig, formatConfig } from '../skills/codex-dispatch/lib/config.mjs';
import { readCodexConfig } from './lib/codex-config.mjs';

export function parseInstallerArgs(args) {
  const options = {};
  const flags = { '--status': 'status', '--dry-run': 'dryRun', '--yes': 'yes', '--replace-existing': 'replaceExisting', '--no-config': 'noConfig', '--rollback': 'rollback', '--uninstall': 'uninstall' };
  const values = { '--host': 'host', '--skill': 'skill', '--claude-dir': 'claudeDir', '--devin-dir': 'devinDir' };
  for (let i = 0; i < args.length; i++) {
    if (flags[args[i]]) options[flags[args[i]]] = true;
    else if (values[args[i]] && args[i + 1] && !args[i + 1].startsWith('--')) options[values[args[i]]] = args[++i];
    else throw new Error(`无效参数或缺少值：${args[i]}`);
  }
  if ([options.status, options.rollback, options.uninstall].filter(Boolean).length > 1) throw new Error('status、rollback、uninstall 不能同时使用');
  return options;
}

const stateText = item => ({ missing: '未安装', modified: '已存在（被改过）', foreign: '已存在（不是本安装器装的）', owned: item.version }[item.state]);
export function formatPlan(plan, statusOnly = false) {
  const lines = [`DispatchDock 技能安装（版本 ${version}）`, '', '派活方'];
  for (const h of plan.statuses) {
    lines.push(`  ${h.host === 'claude-code' ? 'Claude Code' : 'Devin'}   ${!h.supported ? '不支持' : !h.detected && !plan.items.some(i => i.host === h.host) ? '未检测到' : h.root}`);
    if (statusOnly && !h.detected && h.root) lines.push(`    ${h.root}`);
    for (const entry of h.skills) {
      const item = plan.items.find(i => i.host === h.host && i.skill === entry.skill);
      let suffix = '';
      if (!statusOnly && item) suffix = item.action === 'skip' ? '，跳过' : ['foreign', 'modified'].includes(entry.state) && item.action === 'install' ? '，备份后替换'
        : plan.reason === 'rollback' ? ' → 回退' : item.action === 'uninstall' ? ' → 卸载' : entry.state === 'missing' ? ' → 安装' : ` → ${version}`;
      lines.push(`    ${entry.skill.padEnd(22)}${stateText(entry)}${suffix}`);
    }
  }
  for (const warning of plan.warnings) lines.push(`${warning.host}：dual-role-workflow 依赖 codex-dispatch`);
  return lines.join('\n');
}

// 终端依赖由入口注入，测试可用模拟回答；lib 模块不接触终端。
export async function runInstaller(args, { env = process.env, platform = process.platform, interactive = false, ask, output = console.log } = {}) {
  const options = { ...parseInstallerArgs(args), env, platform };
  interactive = interactive && !options.yes;
  if (options.status) { output(formatPlan({ statuses: getStatus(options), items: [], warnings: [] }, true)); return { changed: [] }; }
  let plan = options.rollback ? rollbackPlan(options) : createPlan(options);
  if (options.uninstall) plan.reason = 'uninstall';
  output(formatPlan(plan));
  if (options.dryRun) return { changed: [] };
  if (interactive && !options.rollback && !options.uninstall && !options.replaceExisting) {
    const approved = new Set();
    for (const item of plan.items.filter(i => ['foreign', 'modified'].includes(i.state))) {
      if (/^(y|yes)$/i.test((await ask(`${item.host} / ${item.skill}：备份后替换？[y/N] `)).trim())) approved.add(item.target);
    }
    if (approved.size) {
      const replacements = createPlan({ ...options, replaceExisting: true });
      plan.items = plan.items.map(item => approved.has(item.target) ? replacements.items.find(i => i.target === item.target) : item);
      output(formatPlan(plan));
    }
  }
  if (interactive && plan.items.some(i => i.action !== 'skip')) {
    const date = new Date(plan.backupAt), pad = n => String(n).padStart(2, '0');
    const time = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const prompt = options.rollback ? `回退到 ${time} 之前的状态？当前版本会先备份，之后还能再回退。[Y/n] ` : options.uninstall ? '卸载上面列出的技能？卸载前会备份，可以用 --rollback 恢复。[y/N] ' : '继续安装？[Y/n] ';
    const answer = (await ask(prompt)).trim();
    if (!(options.uninstall ? /^(y|yes)$/i : /^(y|yes)?$/i).test(answer)) return { changed: [] };
  }
  const result = executePlan(plan, options);
  if (!result.changed.length) output('没有需要改动的技能。');
  else {
    const action = options.rollback ? '回退' : options.uninstall ? '卸载' : '安装';
    output(action === '安装' ? `已安装 ${result.changed.length} 个，跳过 ${plan.items.filter(i => i.action === 'skip').length} 个。` : `已${action} ${result.changed.length} 个。`);
    const hadPrevious = plan.items.some(i => i.action !== 'skip' && i.state !== 'missing');
    output(`${action !== '安装' || hadPrevious ? `原来的版本已备份到 ${result.backup}。` : ''}要撤销这次${action}：node installer/install.mjs --rollback`);
  }
  const home = homeDirectory(env, platform);
  if (result.changed.some(i => i.action === 'install') && interactive && !options.noConfig && !readConfig(home).exists) {
    output('设置派发默认值（直接回车 = 跟随 Codex 自己的配置）');
    const current = readCodexConfig(env);
    if (current) output(`Codex 当前配置：模型 ${current.values.model ?? '未设置'}，推理强度 ${current.values.model_reasoning_effort ?? '未设置'}，档位 ${current.values.service_tier ?? '未设置'}（来自 ${current.file}）`);
    const changes = {};
    for (const [key, prompt] of [['model', '默认模型：'], ['effort', '默认推理强度：'], ['tier', '默认服务档位：'], ['sandbox', '默认沙箱（回车 = workspace-write）：']]) changes[key] = (await ask(prompt)).trim() || (key === 'sandbox' ? 'workspace-write' : null);
    writeConfig(home, changes);
    output(formatConfig(home, env));
    const dispatch = plan.statuses.map(h => h.root && join(h.root, 'codex-dispatch')).find(Boolean);
    output(`以后可以运行 node "${join(dispatch, 'codex-task.mjs')}" --config 修改。`);
  }
  return result;
}
