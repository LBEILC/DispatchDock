export function clip(s, n = 140) {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

export function formatProgress(e) {
  switch (e.kind) {
    case 'say': return [`说：${clip(e.text, 200)}`];
    case 'think': return e.text ? [`思考：${clip(e.text, 160)}`] : [];
    case 'cmd': return e.phase === 'start' ? [`运行：${clip(e.command, 120)}`]
      : e.exit !== 0 ? [`  命令失败（exit ${e.exit}）：${clip(e.command, 120)}`] : [];
    case 'file': return e.files.map(f => `${{ add: '新增', update: '修改', delete: '删除' }[f.kind]}文件：${f.path}`);
    case 'plan': return [`计划：${e.items.map(t => `${t.done ? '[x]' : '[ ]'} ${clip(t.text, 40)}`).join('  ')}`];
    case 'tool': return [e.name === 'web_search' ? `搜索：${clip(e.detail)}` : `工具：${e.detail}`];
    case 'turn': return [`一轮结束（输入 ${e.usage.input ?? '?'}，输出 ${e.usage.output ?? '?'} tokens）`];
    case 'error': return [`出错：${clip(e.text)}`];
    case 'text': return [clip(e.text)];
    default: return [];
  }
}

export function progressHeader(title, role, started) {
  return `=== Codex 开始：${title}${role ? `（角色：${role}）` : ''}  ${new Date(started).toLocaleString('zh-CN')} ===\n`;
}
export function progressFooter(code, minutes, report) {
  return `\n=== Codex 结束：exit=${code}，用时 ${minutes} 分钟，汇报在 ${report} ===\n`;
}
