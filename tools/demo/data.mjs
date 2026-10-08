const tasks = [
  { id: 't1', day: 'run', name: '012-背包拖拽与堆叠', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'run', start: '15:21', dur: '18:42', last: '运行：npm test -- inventory', sandbox: 'workspace-write' },
  { id: 't2', day: 'run', name: '007-搜索结果分页', project: 'notes-web', host: 'Devin', role: '工程负责人', state: 'run', start: '15:36', dur: '4:05', last: '修改文件：src/search/Results.tsx', sandbox: 'workspace-write' },
  { id: 't3', day: 'today', name: '011-存档版本迁移', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'done', start: '14:02', dur: '22.4 分钟', commit: '4f2a9c1', sandbox: 'workspace-write' },
  { id: 't4', day: 'today', name: '排查启动时白屏', record: 'task-20261008-1310', project: 'notes-web', host: 'Claude Code', role: null, state: 'done', start: '13:10', dur: '6.1 分钟', sandbox: 'read-only' },
  { id: 't5', day: 'today', name: '006-导出 PDF', project: 'notes-web', host: 'Devin', role: '工程负责人', state: 'fail', exit: 1, start: '11:47', dur: '9.8 分钟', sandbox: 'workspace-write' },
  { id: 't6', day: 'today', name: '010-粒子特效对象池', project: 'pixel-garden', host: 'Claude Code', role: '工程负责人', state: 'stop', start: '10:05', dur: '3.2 分钟', sandbox: 'workspace-write' },
  { id: 't10', day: 'today', name: '013-粒子对象池重构', project: 'notes-web', host: 'Devin', role: '工程负责人', state: 'stop', signal: 'stopped-by-app', start: '10:15', dur: '3.2 分钟', sandbox: 'workspace-write' },
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



export { tasks, plan1, ev1, ev5, ev6, files3 };
