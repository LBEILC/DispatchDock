import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

export function parseArgs(args) {
  const opts = {}, positional = [];
  const names = ['role', 'name', 'host', 'model', 'effort', 'tier', 'sandbox', 'watch-window'];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') { positional.push(...args.slice(k + 1)); break; }
    if (a.startsWith('--')) {
      if (!names.includes(a.slice(2)) || !args[k + 1] || args[k + 1].startsWith('--')) throw new Error(`参数无效或缺少值：${a}`);
      opts[a.slice(2)] = args[++k];
    } else positional.push(a);
  }
  if (!positional[0]) throw new Error('用法：node codex-task.mjs <任务说明文件 | "任务文字"> ["补充说明"] [--role <角色文档名>] [--name <记录名>] [--host <claude-code|devin>]');
  if (opts.host && !['claude-code', 'devin'].includes(opts.host)) throw new Error(`无效的派活方：${opts.host}`);
  return { opts, task: positional[0], extra: positional[1] ?? '' };
}

export const clipTitle = s => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 60)}…` : one;
};

export function taskDetails(root, { opts, task, extra }) {
  const target = resolve(root, task);
  const spec = existsSync(target) && statSync(target).isFile() ? task : null;
  let role = null;
  if (opts.role) {
    const doc = /[\\/.]/.test(opts.role) ? opts.role : `docs/roles/${opts.role}.md`;
    if (!existsSync(resolve(root, doc))) throw new Error(`找不到角色文档：${resolve(root, doc)}`);
    const title = readFileSync(resolve(root, doc), 'utf8').split(/\r?\n/).find(l => l.startsWith('# ')) ?? '';
    role = { doc, name: title.replace(/^#\s*(角色[:：]\s*)?/, '').trim() || opts.role };
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const name = opts.name ?? (spec ? basename(spec, extname(spec)) : `task-${stamp}`);
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error(`无效的记录名：${name}`);
  const prompt = [
    role ? `你在本项目中的角色是「${role.name}」。` : '',
    existsSync(join(root, 'AGENTS.md')) ? '请先阅读仓库根目录的 AGENTS.md（共同规则）。' : '',
    role ? `再阅读你的角色文档 ${role.doc}，严格遵守其中的职责、硬规则、完成标准和汇报格式。` : '',
    spec ? `然后完成任务说明 ${spec} 中的全部内容，按要求验证、提交，最后给出汇报。` : `任务：\n${task}`,
    extra,
  ].filter(Boolean).join('\n');
  return { spec, role, name, prompt, title: spec ?? clipTitle(task) };
}

export function dispatcher(host, env, scriptPath) {
  host ??= env.CLAUDECODE === '1' ? 'claude-code' : /devin/i.test(scriptPath) ? 'devin' : 'unknown';
  // 本机环境及官方文档未核实到 Devin 会话环境变量，按任务要求留空。
  return { host, session: host === 'claude-code' ? env.CLAUDE_CODE_SESSION_ID || null : null };
}
