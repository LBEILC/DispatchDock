// DispatchDock 界面稿：只用于看界面和打磨，数据全部是虚构的演示数据（也作宣传视频的干净样例）。
'use strict';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ic = name => `<i class="ri ri-${name}"></i>`;
const MARK = { run: ['run', 'loader-4-line'], done: ['ok', 'checkbox-circle-line'], fail: ['fail', 'close-circle-line'], stop: ['warn', 'stop-circle-line'] };
const mark = s => `<span class="mk ${MARK[s][0]}">${ic(MARK[s][1])}</span>`;
const STATE = { run: '进行中', done: '已完成', fail: '失败', stop: '已中断' };
// 品牌标记：D2b「回环」定稿，源文件 icons/mark.svg
const BRAND = `<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(0.07 0)"><path d="M18.94 14.26A7.3 7.3 0 1 1 17.16 6.84" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linecap="round"/><path d="M19.99 9.67L19.14 4.86L15.18 8.82Z" fill="var(--brand)" stroke="var(--brand)" stroke-width="0.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.9" fill="var(--brand)"/></g></svg>`;

// ---------- 演示数据 ----------
const tasks = [
  { id: 't1', day: 'run', name: '012-背包拖拽与堆叠', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'run', start: '15:21', dur: '18:42', last: '运行：npm test -- inventory', managed: true, sandbox: 'workspace-write' },
  { id: 't2', day: 'run', name: '007-搜索结果分页', project: 'notes-web', host: 'Devin', role: '工程负责人', state: 'run', start: '15:36', dur: '4:05', last: '修改文件：src/search/Results.tsx', sandbox: 'workspace-write' },
  { id: 't3', day: 'today', name: '011-存档版本迁移', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'done', start: '14:02', dur: '22.4 分钟', commit: '4f2a9c1', sandbox: 'workspace-write' },
  { id: 't4', day: 'today', name: '排查启动时白屏', record: 'task-20261008-1310', project: 'notes-web', host: 'Claude Code', role: null, state: 'done', start: '13:10', dur: '6.1 分钟', sandbox: 'read-only' },
  { id: 't5', day: 'today', name: '006-导出 PDF', project: 'notes-web', host: 'Devin', role: '工程负责人', state: 'fail', exit: 1, start: '11:47', dur: '9.8 分钟', sandbox: 'workspace-write' },
  { id: 't6', day: 'today', name: '010-粒子特效对象池', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'stop', start: '10:05', dur: '3.2 分钟', sandbox: 'workspace-write' },
  { id: 't7', day: 'yesterday', name: '009-地图分块加载', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'done', start: '17:40', dur: '31.0 分钟', commit: 'b81e0d2', sandbox: 'workspace-write' },
  { id: 't8', day: 'yesterday', name: '005-标签筛选', project: 'notes-web', host: 'Devin', role: '工程负责人', state: 'done', start: '16:12', dur: '12.7 分钟', commit: '3c09a7e', sandbox: 'workspace-write' },
  { id: 't9', day: 'yesterday', name: '008-音效总线', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'done', start: '11:03', dur: '15.5 分钟', commit: '90d4f1b', sandbox: 'workspace-write' },
];
const GROUPS = { run: '进行中', today: '今天', yesterday: '昨天' };
const GROUP_DATE = { today: '10-08', yesterday: '10-07' };

const plan1 = [['读任务说明和现有背包实现', 'done'], ['拖拽状态机：按下、拖动、放下、取消', 'done'], ['堆叠合并与上限 99', 'now'], ['截图验收脚本：拖拽前后各一张', ''], ['验证、提交、汇报', '']];
const ev1 = [
  ['15:21', 'say', '先读 <code>AGENTS.md</code>、工程角色文档和任务说明，再看现有的背包实现。'],
  ['15:21', 'cmd', 'rg -n "Inventory" src', 0, 'src/inventory/Inventory.ts:12:export class Inventory {\nsrc/inventory/Inventory.ts:48:  add(item: Item, count = 1) {\nsrc/ui/InventoryPanel.ts:5:import { Inventory } from "../inventory/Inventory";'],
  ['15:23', 'think', '拖拽要和点击区分开：按下后移动超过 4px 才进入拖动，否则当作点击选中。'],
  ['15:25', 'file', [['add', 'src/inventory/drag.ts'], ['update', 'src/inventory/Inventory.ts'], ['update', 'src/ui/InventoryPanel.ts']]],
  ['15:31', 'cmd', 'npm test -- inventory', 1, '✓ 拖动超过 4px 才开始拖拽\n✓ 放到空格子\n✕ 同类物品合并后不超过 99\n  expected 99, received 100\n\n1 failed, 11 passed'],
  ['15:32', 'say', '堆叠上限的测试没过：合并时没有截断到 99。修正 <code>mergeStacks</code> 后再跑一遍。'],
  ['15:34', 'file', [['update', 'src/inventory/stack.ts']]],
  ['15:35', 'turn', '一轮结束 · 输入 182K · 输出 6.4K'],
  ['15:39', 'cmd', 'npm test -- inventory', null, ''],
];
const ev5 = [
  ['11:47', 'say', '先读任务说明。导出 PDF 需要无头浏览器，检查项目里是否已有依赖。'],
  ['11:48', 'cmd', 'npm ls puppeteer', 1, 'notes-web@0.4.0\n└── (empty)'],
  ['11:49', 'say', '项目里没有无头浏览器依赖。任务说明要求新增依赖需说明理由，先在汇报里提出，不擅自安装。'],
  ['11:56', 'turn', '一轮结束 · 输入 64K · 输出 2.1K'],
  ['11:57', 'err', '连接中断：stream disconnected before completion（重试 5 次后放弃）'],
];
const ev6 = [
  ['10:05', 'say', '先读任务说明和现有的粒子系统。'],
  ['10:06', 'cmd', 'rg -n "new Particle" src', 0, 'src/fx/Emitter.ts:31:    this.items.push(new Particle(x, y));'],
  ['10:08', 'file', [['add', 'src/fx/pool.ts']]],
];
const files3 = [['update', 'src/save/schema.ts'], ['add', 'src/save/migrations/v2.ts'], ['add', 'src/save/migrations/v3.ts'], ['update', 'src/save/load.ts'], ['add', 'tests/save-migration.test.ts'], ['add', 'tests/fixtures/save-v1.json'], ['update', 'docs/save-format.md']];
const report3 = `
<h3>完成了什么</h3><p>存档加了版本号，读取时按 v1 → v2 → v3 逐级迁移；旧存档读取后自动写回新格式，并保留一份 <code>.bak</code>。</p>
<h3>验证</h3><ul><li><code>npm test</code> 46/46 通过，新增迁移测试 9 条。</li><li>用 3 份旧存档样例实际读取，背包、地图、设置都对得上。</li></ul>
<div class="hl warn"><h3>${ic('error-warning-line')}TODO(design) 2 条</h3><ol><li>迁移失败时给玩家看的提示文案，现在是占位"【文案待定：存档无法升级】"。</li><li>是否在读取旧存档时提示"已升级"。</li></ol></div>
<div class="hl warn"><h3>${ic('question-line')}推断清单 3 条</h3><ol><li>备份文件名用 <code>&lt;存档名&gt;.bak</code>，只保留最近一份。</li><li>未知字段原样保留，不删除。</li><li>版本号写在存档顶层 <code>v</code> 字段。</li></ol></div>
<h3>已知问题</h3><p>无。</p>`;

// ---------- 状态 ----------
const S = { page: 'tasks', scene: 'busy', theme: 'dark', size: 'default', sel: 't1', tab: 'flow', think: false, open: new Set([4]), managed: true };
const PAGES = { tasks: '任务', connect: '连接', settings: '设置', wizard: '首次引导' };
const SCENES = {
  tasks: { busy: '进行中', done: '已完成', fail: '失败', stop: '中断', empty: '空' },
  connect: { ok: '正常', update: '可更新', custom: '自用版', nocodex: '没有 Codex' },
  settings: { first: '未配置', custom: '已配置' },
  wizard: { s1: '1 检测', s2: '2 技能', s3: '3 默认值' },
};
const SCENE_SEL = { busy: ['t1', 'flow'], done: ['t3', 'report'], fail: ['t5', 'flow'], stop: ['t6', 'flow'], empty: [null, 'flow'] };

// ---------- 外框 ----------
function seg(id, items, value, key) {
  document.getElementById(id).innerHTML = Object.entries(items).map(([k, v]) => `<button class="${k === value ? 'on' : ''}" data-${key}="${k}">${v}</button>`).join('');
}
function chrome() {
  seg('pv-page', PAGES, S.page, 'page');
  seg('pv-scene', SCENES[S.page], S.scene, 'scene');
  seg('pv-theme', { dark: '深色', light: '浅色' }, S.theme, 'theme');
  seg('pv-size', { default: '1160×720', min: '960×600' }, S.size, 'size');
  document.documentElement.dataset.theme = S.theme;
}

function nav() {
  const running = S.scene === 'empty' && S.page === 'tasks' ? 0 : 2;
  const cur = S.page === 'wizard' ? '' : S.page;
  const item = ([k, i, t, n]) => `<button data-page="${k}" ${k === cur ? 'aria-current="page"' : ''}>${ic(i)}${t}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  return `<nav class="nav">${[['tasks', 'stack-line', '任务', running], ['connect', 'plug-line', '连接', 0]].map(item).join('')}
  <span class="sp"></span>${[['settings', 'settings-3-line', '设置', 0], ['about', 'information-line', '关于', 0]].map(item).join('')}
  <div class="nav-foot">${running ? `<div><span class="dot run"></span>${running} 个任务进行中</div>` : `<div><span class="dot ok"></span>没有进行中的任务</div>`}<div>${ic('shield-check-line')}托管${S.managed ? '已开启' : '未开启'}</div></div></nav>`;
}

// ---------- 任务页 ----------
function taskSub(t) {
  if (t.state === 'run') return `<span class="live">${esc(t.project)} · ${esc(t.last)}</span>`;
  const tail = t.state === 'done' ? (t.commit ?? (t.sandbox === 'read-only' ? '只读任务' : '')) : t.state === 'fail' ? `exit=${t.exit}` : '派发会话已关闭';
  return `<span>${esc(t.project)}${tail ? ' · ' + esc(tail) : ''}</span>`;
}
function taskRow(t) {
  const side = t.state === 'run' ? `<span class="mono">${t.dur}</span>` : `<span class="mono">${t.start}</span>`;
  return `<button class="trow is-${t.state === 'run' ? 'running' : t.state} ${S.sel === t.id ? 'on' : ''}" data-task="${t.id}">${mark(t.state)}<span class="tm"><b>${esc(t.name)}</b>${taskSub(t)}</span><span class="ts">${side}</span></button>`;
}
function taskList() {
  if (S.scene === 'empty') return `<div class="edge"><div class="tlist scroll"><div class="empty">${ic('stack-line')}<b>还没有派发过任务</b><p>在 Claude Code 或 Devin 里让它"交给 Codex 做……"，派出的任务会出现在这里。</p></div></div></div>`;
  let html = '';
  for (const g of Object.keys(GROUPS)) {
    const rows = tasks.filter(t => t.day === g);
    if (!rows.length) continue;
    html += `<div class="tgroup">${GROUPS[g]}${GROUP_DATE[g] ? `<span class="mono">${GROUP_DATE[g]}</span>` : `<span class="mono">${rows.length}</span>`}</div>` + rows.map(taskRow).join('');
  }
  return `<div class="edge"><div class="tlist scroll">${html}</div></div>`;
}
function stateLine(t) {
  const cls = { run: 'run', done: 'ok', fail: 'fail', stop: 'warn' }[t.state];
  const text = t.state === 'run' ? `进行中 · 已运行 ${t.dur}` : t.state === 'done' ? `已完成 · 用时 ${t.dur}` : t.state === 'fail' ? `失败 · exit=${t.exit}` : '已中断';
  return `<span class="dh-state ${cls}">${mark(t.state)}${text}</span>`;
}
function detail() {
  const t = tasks.find(x => x.id === S.sel);
  if (!t) return `<div class="detail"><div class="empty">${ic('cursor-line')}<b>${S.scene === 'empty' ? '这里会显示任务的进展和汇报' : '选择一个任务'}</b><p>进展、汇报、改动的文件和派发参数都在这里看。</p></div></div>`;
  const acts = t.state === 'run' ? `<button class="btn sm danger">${ic('stop-circle-line')}停止</button>` : '';
  const head = `<div class="dh"><div class="dh-1">${''}<h2>${esc(t.name)}</h2>${t.managed ? '<span class="tag">' + ic('shield-check-line') + '托管</span>' : ''}<span class="acts">${acts}<button class="btn icon quiet" title="更多">${ic('more-2-fill')}</button></span></div>
    <div class="dh-2">${stateLine(t)}<span>${ic('folder-3-line')}${esc(t.project)}</span><span>${ic('user-3-line')}${esc(t.host)}${t.role ? ' · ' + esc(t.role) : ''}</span><span>${ic('time-line')}${t.start} 开始</span>${t.commit ? `<span>${ic('git-commit-line')}<span class="mono">${t.commit}</span></span>` : ''}</div></div>`;
  const nFiles = t.id === 't3' ? files3.length : t.id === 't1' ? 4 : t.id === 't6' ? 1 : 0;
  const tabs = { flow: '进展', report: '汇报', files: `改动${nFiles ? ` <span class="n">${nFiles}</span>` : ''}`, params: '参数' };
  const right = S.tab === 'flow' ? `<span class="sp"></span><span class="hint">显示思考<span class="toggle ${S.think ? 'on' : ''}" data-think></span></span>` : '';
  const bar = `<div class="dtabs"><div class="segm sm">${Object.entries(tabs).map(([k, v]) => `<button class="${k === S.tab ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>${right}</div>`;
  const body = { flow: flow, report: report, files: changes, params: params }[S.tab](t);
  return `<div class="detail">${head}${bar}<div class="dbody edge"><div class="scroll">${body}</div>${t.state === 'run' && S.tab === 'flow' ? '' : ''}</div></div>`;
}
function eventRow(e, i) {
  const [time, kind, a, exit, out] = e;
  if (kind === 'think' && !S.think) return '';
  if (kind === 'turn') return `<div class="tl k-turn"><span class="t mono">${time}</span><div class="c">${esc(a)}</div></div>`;
  const icons = { say: 'chat-3-line', think: 'lightbulb-line', file: 'file-edit-line', err: 'close-circle-line' };
  let c = '';
  let cls = `k-${kind}`;
  if (kind === 'say') c = `<div class="say"><p>${a}</p></div>`;
  else if (kind === 'think') c = esc(a);
  else if (kind === 'err') c = esc(a);
  else if (kind === 'file') c = `<div class="files">${a.map(([k, p]) => `<button class="fchip ${k}">${ic(k === 'add' ? 'add-line' : k === 'delete' ? 'delete-bin-line' : 'edit-line')}${esc(p)}</button>`).join('')}</div>`;
  else if (kind === 'cmd') {
    const running = exit === null;
    if (exit) cls += ' bad';
    const meta = running ? '<span class="x">运行中…</span>' : exit ? `<span class="x">exit=${exit}</span>` : '';
    const open = S.open.has(i) && out;
    c = `<button class="cmd" data-cmd="${i}" aria-expanded="${open ? 'true' : 'false'}">${out ? ic('arrow-right-s-line') : ''}<code>${esc(a)}</code>${meta}</button>${open ? `<pre class="out selectable">${esc(out)}</pre>` : ''}`;
    return `<div class="tl ${cls}"><span class="t mono">${time}</span>${running ? '<span class="mk run">' + ic('loader-4-line') + '</span>' : ic(exit ? 'close-circle-line' : 'terminal-box-line')}<div class="c">${c}</div></div>`;
  }
  return `<div class="tl ${cls}"><span class="t mono">${time}</span>${ic(icons[kind])}<div class="c">${c}</div></div>`;
}
function planBox(items) {
  const n = items.filter(p => p[1] === 'done').length;
  return `<div class="plan"><div class="plan-h"><b>计划</b><span class="mono">${n}/${items.length}</span><span class="bar"><span style="width:${n / items.length * 100}%"></span></span></div><ul>${items.map(([text, s]) => `<li class="${s}">${ic(s === 'done' ? 'checkbox-circle-fill' : s === 'now' ? 'arrow-right-circle-line' : 'checkbox-blank-circle-line')}<span>${esc(text)}</span></li>`).join('')}</ul></div>`;
}
function banner(kind, title, text, btn) {
  return `<div class="banner ${kind}">${mark(kind === 'fail' ? 'fail' : 'stop')}<div class="rt"><b>${title}</b><span>${text}</span></div>${btn ?? ''}</div>`;
}
function summary(items) {
  return `<div class="sum">${items.map(([i, k, v]) => `<span>${ic(i)}<em>${k}</em>${v}</span>`).join('')}<span class="sp"></span><button class="btn icon quiet" title="打开汇报文件">${ic('external-link-line')}</button></div>`;
}
function flow(t) {
  if (t.id === 't1') return planBox(plan1) + ev1.map(eventRow).join('') + `<div class="live-foot"><span class="dot run"></span>正在跟随最新进展</div>`;
  if (t.id === 't5') return banner('fail', 'Codex 异常退出（exit=1）', '原因见最后一条。要重试，在派活方的会话里重新派发；工作区里没提交的改动会保留。') + ev5.map(eventRow).join('');
  if (t.id === 't6') return banner('warn', '派发会话关闭，任务被一起中断', '任务是派发会话的子进程。在设置里打开"托管"后，关掉会话也不会中断任务。', '<button class="btn sm" data-page="settings">去设置</button>') + ev6.map(eventRow).join('');
  if (t.id === 't2') return planBox([['读任务说明', 'done'], ['分页组件', 'now'], ['接口参数', ''], ['验证、提交、汇报', '']]) + eventRow(['15:36', 'say', '先读任务说明和现有的搜索结果列表。']) + eventRow(['15:39', 'file', [['update', 'src/search/Results.tsx']]]);
  return eventRow([t.start, 'say', '已完成，见汇报。']);
}
function report(t) {
  if (t.state === 'run') return `<div class="empty">${ic('file-text-line')}<b>任务结束后显示汇报</b></div>`;
  if (t.id === 't3') return summary([['git-commit-line', '提交', '<span class="mono">4f2a9c1</span>'], ['time-line', '用时', '22.4 分钟']]) + `<div class="md selectable">${report3}</div>`;
  if (t.state === 'fail' || t.state === 'stop') return `<div class="empty">${ic('file-text-line')}<b>没有汇报</b><p>任务没有正常结束，Codex 没来得及写汇报。看"进展"了解停在哪里。</p></div>`;
  return summary(t.commit ? [['git-commit-line', '提交', `<span class="mono">${t.commit}</span>`], ['time-line', '用时', t.dur]] : [['time-line', '用时', t.dur], ['lock-line', '沙箱', '只读，没有改动文件']]) + `<div class="md"><h3>完成了什么</h3><p>排查结果：白屏是因为首次启动时读取空的设置文件抛错。只读任务，没有改动文件。</p></div>`;
}
function changes(t) {
  const list = t.id === 't3' ? files3 : t.id === 't1' ? [['add', 'src/inventory/drag.ts'], ['update', 'src/inventory/Inventory.ts'], ['update', 'src/ui/InventoryPanel.ts'], ['update', 'src/inventory/stack.ts']] : t.id === 't6' ? [['add', 'src/fx/pool.ts']] : [];
  if (!list.length) return `<div class="empty">${ic('file-copy-line')}<b>没有改动文件</b></div>`;
  const label = { add: '新增', update: '修改', delete: '删除' };
  return `<div class="sec-t">按 Codex 报告的改动汇总${t.state === 'run' ? '，任务进行中会继续增加' : ''}</div><div class="rows">${list.map(([k, p]) => `<div class="r ${k}">${ic(k === 'add' ? 'add-line' : k === 'delete' ? 'delete-bin-line' : 'edit-line')}<span class="muted" style="width:32px">${label[k]}</span><span class="v mono">${esc(p)}</span><button class="btn sm quiet">打开</button></div>`).join('')}</div>`;
}
function params(t) {
  const rec = t.record ?? t.name;
  const rows = [
    ['记录名', `<span class="mono">${esc(rec)}</span>`],
    ['任务说明', t.record ? '<span class="muted">直接给的任务文字</span>' : `<span class="mono">docs/specs/${esc(t.name)}.md</span>`, t.record ? '' : '打开'],
    ['角色', t.role ? esc(t.role) : '<span class="muted">不指定</span>'],
    ['派活方', esc(t.host)],
    ['干活方', 'Codex CLI <span class="mono muted">0.156.1</span>'],
    ['模型', '<span class="muted">跟随 Codex</span>'],
    ['推理强度', '<span class="muted">跟随 Codex</span>'],
    ['档位', '<span class="muted">跟随 Codex</span>'],
    ['沙箱', `<span class="mono">${t.sandbox}</span>`],
    ['托管', t.managed ? '是' : '否'],
    ['仓库', `<span class="mono">~/projects/${esc(t.project)}</span>`, '打开'],
  ];
  return `<div class="rows">${rows.map(([k, v, b]) => `<div class="r"><span class="k">${k}</span><span class="v">${v}</span>${b ? `<button class="btn sm quiet">${b}</button>` : ''}</div>`).join('')}</div>
  <div class="sec-t">记录文件</div><div class="rows">${[['进度', '.progress.log'], ['统一事件', '.events.jsonl'], ['原始输出', '.log']].map(([k, ext]) => `<div class="r"><span class="k">${k}</span><span class="v mono muted">.codex-runs/${esc(rec)}${ext}</span><button class="btn sm quiet">打开</button></div>`).join('')}</div>`;
}
function tasksPage() {
  const all = S.scene === 'empty' ? [] : tasks;
  const count = f => all.filter(f).length;
  const filters = [['全部', count(() => true), true], ['进行中', count(t => t.state === 'run')], ['失败或中断', count(t => t.state === 'fail' || t.state === 'stop')]];
  return `<div class="page-h"><h1>任务</h1><div class="segm">${filters.map(([l, n, on]) => `<button class="${on ? 'on' : ''}">${l} <span class="n">${n}</span></button>`).join('')}</div><button class="sel"><span class="ph">全部项目</span>${ic('arrow-down-s-line')}</button><span class="sp"></span><button class="btn icon quiet" title="导入旧任务">${ic('folder-add-line')}</button></div>
  <div class="split">${taskList()}${detail()}</div>`;
}

// ---------- 连接页 ----------
function kv(m, lb, val, tag) { return `<div class="kv">${m}<span class="lb">${lb}</span><span class="val">${val}</span>${tag ?? ''}</div>`; }
const okm = `<span class="mk ok">${ic('checkbox-circle-line')}</span>`, warnm = `<span class="mk warn">${ic('error-warning-line')}</span>`, failm = `<span class="mk fail">${ic('close-circle-line')}</span>`, infom = `<span class="mk info">${ic('information-line')}</span>`, skipm = `<span class="mk skip">${ic('indeterminate-circle-line')}</span>`;
function hostCard(name, icon, path, skills, foot, cls = '') {
  return `<div class="card ${cls}"><div class="card-h">${ic(icon)}<b>${name}</b><span class="aside">${cls === 'is-off' ? '未检测到' : '<span class="mk ok">' + ic('checkbox-circle-line') + '</span>已检测到'}</span></div><div class="card-b">${path ? `<div class="path mono" style="margin:-6px 0 6px">${path}</div>` : ''}${skills}</div><div class="card-f">${foot}</div></div>`;
}
function connectPage() {
  const sc = S.scene;
  const latest = '<span class="tag ok">最新</span>';
  const upd = '<span class="tag info">可更新到 0.1.1</span>';
  const cc = sc === 'custom'
    ? kv(warnm, 'codex-dispatch', '<span class="mono">自己改过的版本</span>', '<span class="tag warn">不会自动替换</span>') + kv(okm, 'dual-role-workflow', '<span class="mono">0.1.0</span>', latest)
      + `<div class="hint">${infom}<span>这份 codex-dispatch 不是 DispatchDock 装的，或者装好后被改过。更新时默认跳过它；要换成公开版，先备份再替换，随时可以回退。</span></div>`
    : kv(sc === 'update' ? infom : okm, 'codex-dispatch', '<span class="mono">0.1.0</span>', sc === 'update' ? upd : latest) + kv(sc === 'update' ? infom : okm, 'dual-role-workflow', '<span class="mono">0.1.0</span>', sc === 'update' ? upd : latest);
  const ccFoot = sc === 'custom' ? `<span class="note">替换前会备份</span><button class="btn sm">备份后替换…</button>` : sc === 'update' ? `<span class="note">更新前会备份，可以回退</span><button class="btn sm quiet">回退</button><button class="btn sm primary">更新</button>` : `<span class="note">上次安装 10-08 09:12</span><button class="btn sm quiet">回退</button><button class="btn sm">重新安装</button>`;
  const devinOn = sc !== 'nocodex';
  const devin = devinOn ? hostCard('Devin', 'robot-2-line', '%APPDATA%\\devin\\skills', kv(sc === 'update' ? infom : okm, 'codex-dispatch', '<span class="mono">0.1.0</span>', sc === 'update' ? upd : latest) + kv(skipm, 'dual-role-workflow', '<span class="muted">未安装</span>', ''), `<span class="note">dual-role-workflow 需要 codex-dispatch</span><button class="btn sm">安装</button>`)
    : hostCard('Devin', 'robot-2-line', '', `<div class="hint">${skipm}<span>没有找到 Devin。装好以后点右上角"重新检测"。</span></div>`, '', 'is-off');
  const codex = sc === 'nocodex'
    ? `<div class="card is-fail"><div class="card-h">${ic('terminal-box-line')}<b>Codex CLI</b><span class="aside">${failm}找不到</span></div><div class="card-b">${kv(failm, '状态', '找不到 Codex CLI')}<div class="hint">${infom}<span>确认在终端里能运行 <span class="mono">codex --version</span>。用 pnpm、scoop 这类方式装的，可以手动指定 Codex 的位置。</span></div></div><div class="card-f"><button class="btn sm">指定位置…</button><button class="btn sm primary">重新检测</button></div></div>`
    : `<div class="card"><div class="card-h">${ic('terminal-box-line')}<b>Codex CLI</b><span class="aside">${okm}可以运行</span></div><div class="card-b">${kv(okm, '版本', '<span class="mono">codex-cli 0.156.1</span>')}${kv(okm, '位置', '<span class="mono">自动查找 · npm 全局安装</span>')}${kv(okm, '登录', '已登录')}${sc === 'update' ? `<div class="hint">${infom}<span>Codex 从 0.155.0 升级到了 0.156.1。如果任务进展里出现大量没整理过的原始文本，可能是它的输出格式变了。</span></div>` : ''}</div><div class="card-f"><span class="note">上次检测 15:40</span><button class="btn sm quiet">指定位置…</button></div></div>`;
  return `<div class="doc scroll"><div class="page-h sticky"><h1>连接</h1><span class="lead">谁在派活、谁在干活</span><span class="sp"></span><button class="btn">${ic('refresh-line')}重新检测</button></div><div class="doc-in">
    <div class="sect"><h2>派活方</h2><p>在这些工具里装上技能，它们就能把工作派给 Codex。装之前会备份原来的版本，可以回退。</p><div class="cards2">${hostCard('Claude Code', 'terminal-line', '~/.claude/skills', cc, ccFoot, sc === 'custom' ? 'is-warn' : '')}${devin}</div></div>
    <div class="sect"><h2>干活方</h2><p>实际执行任务的程序。v0.1 只支持 Codex CLI。</p>${codex}</div></div></div>`;
}

// ---------- 设置页 ----------
function setRow(title, desc, ctl) { return `<div class="set-r"><div class="l">${title}<span>${desc}</span></div><div class="ctl">${ctl}</div></div>`; }
function sel(text, ph) { return `<button class="sel"><span class="${ph ? 'ph' : ''}">${text}</span>${ic('arrow-down-s-line')}</button>`; }
function settingsPage() {
  const c = S.scene === 'custom';
  const follow = cur => `跟随 Codex<span class="muted">（${cur}）</span>`;
  return `<div class="doc scroll"><div class="page-h sticky"><h1>设置</h1></div><div class="doc-in">
    <div class="sect"><h2>派发默认值</h2><p>派活方派发时没有单独指定的，就用这里的值。"跟随 Codex"表示不传这个参数，由 Codex 自己的配置决定。单次任务的参数（例如调研用只读）仍由派活方决定。</p><div class="set">
      ${setRow('模型', c ? '' : '括号里是 Codex 现在的配置', c ? sel('<span class="mono">gpt-x-large</span>') : sel(follow('gpt-x'), true))}
      ${setRow('推理强度', '', c ? sel('high') : sel(follow('medium'), true))}
      ${setRow('服务档位', c ? '<span style="color:var(--warn)">环境变量 CODEX_TIER 正在覆盖这一项（priority）</span>' : '', c ? sel('default') : sel(follow('default'), true))}
      ${setRow('沙箱', '派出的工作要写文件、提交，所以默认可写工作区', `<div class="segm"><button class="on">可写工作区</button><button>只读</button></div>`)}
    </div></div>
    <div class="sect"><h2>托管</h2><p>任务默认是派活方会话的子进程，关掉会话可能连带中断任务。</p><div class="set">
      ${setRow('由 DispatchDock 托管任务', '打开后，派出的任务由本软件启动。关掉 Claude Code 或 Devin 的会话，任务照常进行；要停止就在这里停。软件没开时，任务照旧由派活方启动。', `<span class="toggle ${c ? 'on' : ''}"></span>`)}
    </div></div>
    <div class="sect"><h2>进度窗口</h2><div class="set">
      ${setRow('弹出只读进度窗口', '"自动"：本软件开着时不弹，在这里看；没开时弹出终端窗口', `<div class="segm"><button class="on">自动</button><button>总是</button><button>从不</button></div>`)}
    </div></div>
    <div class="sect"><h2>通知</h2><div class="set">
      ${setRow('任务结束时通知', '完成、失败、中断都会通知；点通知直接打开这个任务', `<span class="toggle on"></span>`)}
    </div></div>
    <div class="sect"><h2>外观</h2><div class="set">
      ${setRow('主题', '', `<div class="segm icons"><button class="on" title="跟随系统">${ic('computer-line')}</button><button title="浅色">${ic('sun-line')}</button><button title="深色">${ic('moon-line')}</button></div>`)}
    </div></div>
    <div class="sect"><h2>配置文件</h2><div class="set">
      ${setRow('位置', '<span class="mono">%APPDATA%\\codex-dispatch\\config.json</span>', '<button class="btn sm quiet">打开所在文件夹</button>')}
    </div></div>
  </div></div>`;
}

// ---------- 首次引导 ----------
function choice(on, title, desc, off) { return `<div class="choice ${off ? 'off' : ''}"><span class="cb ${on ? 'on' : ''}">${on ? ic('check-line') : ''}</span><span class="ct">${title}<span>${desc}</span></span></div>`; }
function wizardPage() {
  const step = { s1: 1, s2: 2, s3: 3 }[S.scene];
  const steps = ['检测', '技能', '默认值'].map((t, i) => `<span class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><b>${i + 1 < step ? ic('check-line') : i + 1}</b>${t}</span>`).join('<span class="ln"></span>');
  let body = '';
  if (step === 1) body = `<h1>欢迎使用 DispatchDock</h1><p>它让 Claude Code、Devin 把工作派给 Codex，你在这里统一查看、停止和验收。先看看这台电脑上有什么。</p>
    <div class="card"><div class="card-b" style="padding-top:8px;padding-bottom:8px">${kv(okm, 'Claude Code', '<span class="mono">~/.claude</span>')}${kv(okm, 'Devin', '<span class="mono">%APPDATA%\\devin</span>')}${kv(okm, 'Codex CLI', '<span class="mono">codex-cli 0.156.1</span>')}</div></div>`;
  if (step === 2) body = `<h1>安装技能</h1><p>技能装在派活方里，告诉它怎么派活、怎么看结果。已有的版本会先备份。</p>
    ${choice(true, 'Claude Code · codex-dispatch', '派活、看进度、收汇报')}${choice(true, 'Claude Code · dual-role-workflow', '可选：让对话的模型当设计负责人，Codex 做执行')}${choice(true, 'Devin · codex-dispatch', '派活、看进度、收汇报')}${choice(false, 'Devin · dual-role-workflow', '可选')}`;
  if (step === 3) body = `<h1>派发默认值</h1><p>不确定就保持"跟随 Codex"，以后在设置里随时改。</p><div class="set">
    ${setRow('模型', '', sel('跟随 Codex<span class="muted">（gpt-x）</span>', true))}${setRow('推理强度', '', sel('跟随 Codex<span class="muted">（medium）</span>', true))}${setRow('服务档位', '', sel('跟随 Codex<span class="muted">（default）</span>', true))}
    ${setRow('托管任务', '关掉派活方的会话也不中断任务', '<span class="toggle"></span>')}</div>`;
  const next = step === 3 ? '完成' : step === 2 ? '安装并继续' : '下一步';
  return `<div class="wiz"><div class="wiz-steps">${steps}</div><div class="wiz-body">${body}</div><div class="wiz-f">${step > 1 ? '<button class="btn quiet">上一步</button>' : ''}<span class="sp"></span><button class="btn quiet">跳过</button><button class="btn primary">${next}</button></div></div>`;
}

// ---------- 说明 ----------
const NOTES = {
  tasks: ['标题行、滚动条按现有查看器的做法：标题行 64px，滚动后才出现分隔线；系统滚动条隐藏，换成悬浮滑块（滚动或悬停时出现，0.8 秒后淡出，悬停变粗、可拖）。', '任务页是主界面：左边列表、右边详情同时可见，选中不再替换掉列表。', '列表分组：进行中固定在最上面，其余按天。进行中的任务第二行显示最新一条进展，右边是实时用时。', '详情四个标签：进展（时间线，计划固定在顶部）、汇报、改动、参数。思考默认隐藏。', '汇报里高亮"TODO(design)"和"推断清单"：这是 dual-role-workflow 的汇报格式，没有这两节就不高亮。'],
  connect: ['连接页合并了"宿主检测与技能安装"和"干活方检测"。', '"自用版"场景：用户自己改过或手装的技能默认不替换，只提示。', '品牌图标是占位：图标库的许可不允许拿图标当 logo，正式图标要另画。'],
  settings: ['设置页沿用文档页样式：小节标题 + 细线分隔的行，标签和说明在左，控件在右。', '下拉框里"跟随 Codex（当前值）"：把 Codex 自己的配置读出来做参考，用户就知道不改会是什么。', '环境变量覆盖时在那一行说明，免得用户改了设置不生效还找不到原因。'],
  wizard: ['首次打开的引导：检测 → 安装技能 → 默认值，三步都能跳过。', '只装技能、没装软件的人走安装命令里的问答，内容和第 3 步一致。'],
};
function notes() {
  document.getElementById('pv-notes').innerHTML = `<h4>这一页的设计要点（讨论用，不是产品文案）</h4><ul>${NOTES[S.page].map(n => `<li>${n}</li>`).join('')}</ul>`;
}

// ---------- 吸顶分隔线与悬浮滑块（和现有查看器同一做法） ----------
// 系统滚动条隐藏；每个滚动区一根浮动滑块，放在独立的固定层里，按滚动比例定位，轨道从吸顶标题下面开始。
// 滚动或悬停时出现，停 0.8 秒后淡出；悬停或拖动时变粗。滚动区一离开顶部，上沿的分隔线才出现。
let disposeScroll = () => {};
function installScroll(root) {
  disposeScroll();
  const layer = document.createElement('div'); layer.className = 'thumb-layer'; document.body.append(layer);
  const placers = [], offs = [];
  for (const box of root.querySelectorAll('.scroll')) {
    const thumb = document.createElement('span'); thumb.className = 'sc-thumb'; layer.append(thumb);
    const head = box.querySelector(':scope > .page-h.sticky');
    const edge = box.parentElement.classList.contains('edge') ? box.parentElement : null;
    let hovered = false, timer = 0, drag;
    const geom = () => { const top = (head?.offsetHeight ?? 0) + 4; return { top, track: box.clientHeight - top - 4, range: box.scrollHeight - box.clientHeight }; };
    const place = () => {
      const scrolled = box.scrollTop > 0;
      head?.classList.toggle('stuck', scrolled); edge?.classList.toggle('edge-on', scrolled);
      const { top, track, range } = geom();
      thumb.hidden = range <= 1 || track <= 0;
      if (thumb.hidden) return;
      const size = Math.min(track, Math.max(28, track * box.clientHeight / box.scrollHeight)), r = box.getBoundingClientRect();
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translate(${Math.round(r.right - 7)}px, ${Math.round(r.top + top + (track - size) * Math.min(1, box.scrollTop / range))}px)`;
    };
    const show = () => { clearTimeout(timer); thumb.classList.add('show'); };
    const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (!hovered && !drag) thumb.classList.remove('show'); }, 800); };
    const enter = () => { hovered = true; show(); }, leave = () => { hovered = false; later(); };
    for (const el of [box, thumb]) { el.addEventListener('mouseenter', enter); el.addEventListener('mouseleave', leave); }
    box.addEventListener('scroll', () => { place(); show(); later(); }, { passive: true });
    thumb.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { track, range } = geom(), travel = track - thumb.offsetHeight;
      if (travel <= 0) return;
      drag = { id: e.pointerId, y: e.clientY, from: box.scrollTop, k: range / travel };
      thumb.setPointerCapture(e.pointerId); thumb.classList.add('drag'); document.body.classList.add('dragging'); show();
    });
    thumb.addEventListener('pointermove', e => { if (drag?.id === e.pointerId) box.scrollTop = drag.from + (e.clientY - drag.y) * drag.k; });
    const end = () => { drag = undefined; thumb.classList.remove('drag'); document.body.classList.remove('dragging'); later(); };
    thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
    place(); placers.push(place); offs.push(() => clearTimeout(timer));
  }
  const all = () => placers.forEach(f => f());
  window.addEventListener('resize', all); document.addEventListener('scroll', all, true);
  disposeScroll = () => { offs.forEach(f => f()); layer.remove(); window.removeEventListener('resize', all); document.removeEventListener('scroll', all, true); };
}

// ---------- 渲染与交互 ----------
let lastView = '';
function render() {
  // 同一视图内的重绘（展开命令输出、切思考）保留各滚动区的位置
  const view = [S.page, S.scene, S.sel, S.tab, S.size].join('|');
  const keep = view === lastView ? [...document.querySelectorAll('#win .scroll')].map(el => el.scrollTop) : [];
  lastView = view;
  chrome();
  const win = document.getElementById('win');
  win.className = 'win' + (S.size === 'min' ? ' min' : '');
  const page = { tasks: tasksPage, connect: connectPage, settings: settingsPage, wizard: wizardPage }[S.page];
  win.innerHTML = `<div class="tb-l">${BRAND}DispatchDock</div><div class="tb-r"><span>${ic('subtract-line')}</span><span>${ic('checkbox-blank-line')}</span><span>${ic('close-line')}</span></div>${nav()}<section class="content">${page()}</section>`;
  win.querySelectorAll('.scroll').forEach((el, i) => { if (keep[i]) el.scrollTop = keep[i]; });
  installScroll(win);
  notes();
}
document.addEventListener('click', e => {
  const b = e.target.closest('button, [data-think]');
  if (!b) return;
  const d = b.dataset;
  if (d.page && (PAGES[d.page])) { S.page = d.page; S.scene = Object.keys(SCENES[d.page])[0]; if (d.page === 'tasks') [S.sel, S.tab] = SCENE_SEL[S.scene]; }
  else if (d.scene) { S.scene = d.scene; if (S.page === 'tasks') [S.sel, S.tab] = SCENE_SEL[S.scene]; if (S.page === 'settings') S.managed = d.scene === 'custom'; }
  else if (d.theme) S.theme = d.theme;
  else if (d.size) S.size = d.size;
  else if (d.task) { S.sel = d.task; const t = tasks.find(x => x.id === d.task); S.tab = t.state === 'done' ? 'report' : 'flow'; }
  else if (d.tab) S.tab = d.tab;
  else if (d.cmd !== undefined) { const i = Number(d.cmd); S.open.has(i) ? S.open.delete(i) : S.open.add(i); }
  else if (b.hasAttribute('data-think')) S.think = !S.think;
  else if (b.classList.contains('toggle')) { b.classList.toggle('on'); return; }
  else return;
  render();
});
document.addEventListener('click', e => { const t = e.target.closest('.toggle:not([data-think])'); if (t && !t.closest('button')) t.classList.toggle('on'); });
try { const q = new URLSearchParams(location.search); for (const k of ['page', 'scene', 'theme', 'size']) if (q.get(k)) S[k] = q.get(k); if (S.page === 'tasks' && SCENE_SEL[S.scene]) [S.sel, S.tab] = SCENE_SEL[S.scene]; } catch {}
render();
