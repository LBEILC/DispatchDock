import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codex, mapLine, limitOutput, shortCommand, resolveLauncher } from '../skills/codex-dispatch/adapters/codex.mjs';
import { loadConfig, homeDirectory } from '../skills/codex-dispatch/lib/config.mjs';
import { dispatcher, parseArgs, taskDetails } from '../skills/codex-dispatch/lib/options.mjs';
import { formatProgress } from '../skills/codex-dispatch/lib/progress.mjs';
import { recordPaths, registryWriter } from '../skills/codex-dispatch/lib/records.mjs';
import { viewerTakesOver, shouldWatch, watchCommand } from '../skills/codex-dispatch/lib/watch.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(project, 'skills/codex-dispatch/codex-task.mjs');
const fixture = name => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const samples = ['codex-sample.jsonl', 'codex-extra.jsonl'].map(fixture);
const sampleLines = samples.flatMap(file => fs.readFileSync(file, 'utf8').trimEnd().split('\n'));
const jsonl = file => fs.readFileSync(file, 'utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse);

function setup(t) {
  const base = fs.mkdtempSync(path.join(tmpdir(), 'dispatch 测试 '));
  assert.ok(path.isAbsolute(base));
  t.after(() => {
    // 仅清理由本测试创建、位于系统临时目录中的目录。
    assert.equal(path.dirname(base), path.resolve(tmpdir()));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const root = path.join(base, '示例 仓库'), home = path.join(base, '公共 配置');
  fs.mkdirSync(root); fs.mkdirSync(home);
  const fake = path.join(base, '假 agent.mjs');
  fs.copyFileSync(fixture('fake-agent.txt'), fake);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CODEX_|^CLAUDECODE$|^CLAUDE_CODE_SESSION_ID$|^FAKE_/.test(k)) delete env[k];
  Object.assign(env, { USERPROFILE: base, HOME: base, APPDATA: base, CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex'), XDG_CONFIG_HOME: base, CODEX_DISPATCH_HOME: home, CODEX_NO_WATCH: '1', CODEX_DISPATCH_TEST_AGENT: fake,
    FAKE_ECHO: path.join(base, 'argv.json'), FAKE_FIXTURES: JSON.stringify(samples) });
  for (const key of ['USERPROFILE', 'HOME', 'APPDATA', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'CODEX_DISPATCH_HOME']) {
    const relative = path.relative(path.resolve(tmpdir()), env[key]);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }
  const config = value => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(value));
  config({ v: 1 });
  const invoke = (args = [], overrides = {}, script = entry) => spawnSync(process.execPath, [script, '只回复 OK', '--name', '中文 记录', ...args], {
    cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15000, windowsHide: true, shell: false,
  });
  return { base, root, home, env, config, invoke };
}

test('端到端：参数完整、清单兼容、事件顺序、原始日志和汇报', t => {
  const s = setup(t), result = s.invoke(['--host', 'claude-code'], { CLAUDE_CODE_SESSION_ID: 'fake-session' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /DEP0190/);
  const rows = jsonl(path.join(s.home, 'runs.jsonl'));
  assert.deepEqual(rows.map(e => e.event), ['start', 'spawned', 'end']);
  const [start, spawned, end] = rows;
  for (const key of ['repo', 'progress', 'report', 'raw', 'events']) assert.ok(path.isAbsolute(start[key]), key);
  assert.equal(start.name, '中文 记录');
  assert.ok(start.progress.endsWith('.progress.log')); assert.ok(start.report.endsWith('.md'));
  for (const key of ['spec', 'role', 'model', 'effort', 'tier']) assert.equal(start[key], null);
  for (const key of ['pid', 'started']) assert.ok(Number.isFinite(start[key]));
  assert.equal(start.agent, 'codex'); assert.equal(start.agentVersion, 'codex-cli test-fixture');
  assert.equal(start.sandbox, 'workspace-write'); assert.equal(start.title, '只回复 OK');
  assert.deepEqual(start.dispatcher, { host: 'claude-code', session: 'fake-session' });
  assert.equal(spawned.agentPid, spawned.codexPid); assert.ok(spawned.agentPid > 0);
  assert.equal(end.id, start.id); assert.equal(spawned.id, start.id); assert.equal(end.exit, 0);
  assert.equal(fs.readFileSync(start.report, 'utf8'), 'OK\n');
  const echo = JSON.parse(fs.readFileSync(s.env.FAKE_ECHO, 'utf8'));
  assert.deepEqual(echo.args, ['exec', '--json', '-C', s.root, '-s', 'workspace-write', '-o', start.report, '-']);
  assert.equal(echo.prompt, '任务：\n只回复 OK');
  const events = jsonl(start.events);
  events.forEach((e, n) => { assert.equal(e.seq, n + 1); assert.equal(e.v, 1); assert.ok(e.at >= start.started); });
  assert.deepEqual(new Set(events.map(e => e.kind)), new Set(['say', 'think', 'cmd', 'file', 'plan', 'tool', 'turn', 'error', 'text']));
  const commands = events.filter(e => e.kind === 'cmd');
  assert.deepEqual(commands.map(e => e.phase), ['start', 'end', 'start', 'end']);
  assert.equal(commands[0].id, commands[1].id); assert.equal(commands[2].id, commands[3].id);
  assert.equal(commands[1].exit, 0); assert.notEqual(commands[3].exit, 0);
  assert.equal(commands[0].command, 'node check.mjs');
  assert.equal(commands[1].output, '验证通过\n'); assert.equal(commands[1].truncated, false);
  assert.equal(events.find(e => e.kind === 'say').text, '已检查示例仓库。\n接下来执行验证。');
  const raw = fs.readFileSync(start.raw, 'utf8').trimEnd().split('\n');
  assert.equal(raw.length, sampleLines.length);
  raw.forEach((line, n) => {
    if (!sampleLines[n].startsWith('{')) { assert.equal(line, sampleLines[n]); return; }
    const parsed = JSON.parse(line), { _at, ...original } = parsed;
    assert.ok(Number.isFinite(_at)); assert.deepEqual(original, JSON.parse(sampleLines[n]));
  });
});

test('固定进度标准答案：与定稿协议逐行一致', t => {
  const s = setup(t); assert.equal(s.invoke().status, 0);
  const current = fs.readFileSync(path.join(s.root, '.codex-runs/中文 记录.progress.log'), 'utf8');
  const normalize = text => text.replace(/\[\d{2}:\d{2}:\d{2}\] /g, '').replace(/  \d{4}\/.* ===\n/, '  <时间> ===\n')
    .replace(/用时 [\d.]+ 分钟，汇报在 .* ===/, '用时 <分钟> 分钟，汇报在 <路径> ===');
  assert.equal(normalize(current), fs.readFileSync(fixture('expected-progress.txt'), 'utf8').replaceAll('\r\n', '\n'));
});

test('配置优先级：命令行 > 环境变量 > 文件 > 默认；null 不传模型参数', t => {
  const s = setup(t);
  s.config({ v: 1, agents: { codex: { model: 'file-model', effort: 'low', tier: 'default', sandbox: 'read-only' } }, watchWindow: 'never' });
  const env = { CODEX_MODEL: 'env-model', CODEX_EFFORT: 'medium', CODEX_TIER: 'env-tier', CODEX_SANDBOX: 'workspace-write' };
  assert.equal(s.invoke(['--model', 'cli-model', '--effort', 'high', '--tier', 'cli-tier', '--sandbox', 'read-only'], env).status, 0);
  const row = jsonl(path.join(s.home, 'runs.jsonl'))[0];
  assert.equal(row.model, 'cli-model'); assert.equal(row.effort, 'high'); assert.equal(row.tier, 'cli-tier'); assert.equal(row.sandbox, 'read-only');
  const args = JSON.parse(fs.readFileSync(s.env.FAKE_ECHO, 'utf8')).args;
  assert.ok(args.includes('model_reasoning_effort="high"')); assert.ok(args.includes('service_tier="cli-tier"'));
  assert.equal(loadConfig(s.home, {}, env).settings.model, 'env-model');
  assert.equal(loadConfig(s.home, {}, {}).settings.model, 'file-model');
  assert.equal(loadConfig(s.home, {}, { CODEX_NO_WATCH: '1' }).settings.watchWindow, 'never');
  assert.equal(loadConfig(s.home, { 'watch-window': 'always' }, { CODEX_NO_WATCH: '1' }).settings.watchWindow, 'always');
  s.config({ v: 1, agents: { codex: { model: null, effort: null, tier: null } } });
  const settings = loadConfig(s.home, {}, {}).settings;
  assert.deepEqual(settings, { model: null, effort: null, tier: null, sandbox: 'workspace-write', path: null, watchWindow: 'auto' });
  const command = codex.command({ root: s.root, report: path.join(s.root, '汇报.md'), prompt: 'OK', settings, env: s.env });
  assert.ok(!command.args.includes('-m')); assert.ok(!command.args.includes('-c'));
});

test('配置缺失和解析失败只提示一次，继续完成任务', t => {
  const s = setup(t);
  for (const invalid of [null, '{', '{"v":2}']) {
    if (invalid === null) fs.unlinkSync(path.join(s.home, 'config.json'));
    else fs.writeFileSync(path.join(s.home, 'config.json'), invalid);
    const result = s.invoke(); assert.equal(result.status, 0, result.stderr);
    const start = jsonl(path.join(s.home, 'runs.jsonl')).filter(e => e.event === 'start').at(-1);
    assert.equal((fs.readFileSync(start.progress, 'utf8').match(/配置：/g) ?? []).length, 1);
    assert.equal(start.model, null);
  }
});

test('公共目录隔离及 Windows / XDG 回退', t => {
  const s = setup(t);
  assert.equal(homeDirectory({ CODEX_DISPATCH_HOME: s.home, APPDATA: s.root }, 'win32'), s.home);
  assert.equal(homeDirectory({ APPDATA: s.home }, 'win32'), path.join(s.home, 'codex-dispatch'));
  assert.equal(homeDirectory({ XDG_CONFIG_HOME: s.home }, 'linux'), path.join(s.home, 'codex-dispatch'));
  assert.equal(homeDirectory({ HOME: s.home }, 'linux'), path.join(s.home, '.config/codex-dispatch'));
});

test('重名追加序号，dry-run 不创建目录或修改已有文件', t => {
  const s = setup(t);
  assert.equal(s.invoke([], { CODEX_DRY_RUN: '1' }).status, 0);
  assert.ok(!fs.existsSync(path.join(s.root, '.codex-runs')));
  assert.ok(!fs.existsSync(path.join(s.home, 'runs.jsonl')));
  assert.ok(!fs.existsSync(s.env.FAKE_ECHO));
  assert.equal(s.invoke().status, 0);
  const first = path.join(s.root, '.codex-runs/中文 记录.progress.log'), before = fs.readFileSync(first);
  assert.match(s.invoke([], { CODEX_DRY_RUN: '1' }).stdout, /记录名：中文 记录-2/);
  assert.equal(s.invoke().status, 0); assert.equal(s.invoke().status, 0);
  assert.deepEqual(jsonl(path.join(s.home, 'runs.jsonl')).filter(e => e.event === 'start').map(e => e.name), ['中文 记录', '中文 记录-2', '中文 记录-3']);
  assert.deepEqual(fs.readFileSync(first), before);
});

test('并发派发独占记录名，不覆盖同名任务', async t => {
  const s = setup(t);
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, '只回复 OK', '--name', '同时 派发'], { cwd: s.root, env: s.env, stdio: 'ignore', windowsHide: true });
    child.on('error', reject); child.on('close', resolve);
  });
  assert.deepEqual(await Promise.all([launch(), launch()]), [0, 0]);
  const names = jsonl(path.join(s.home, 'runs.jsonl')).filter(e => e.event === 'start').map(e => e.name).sort();
  assert.deepEqual(names, ['同时 派发', '同时 派发-2']);
});

test('显式 host 优先，Claude 自动识别优先于 Devin 路径，会话不猜测', t => {
  const s = setup(t);
  const env = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'fake-session', DEVIN_SESSION_ID: 'unverified' };
  assert.deepEqual(dispatcher('devin', env, '/skills/codex'), { host: 'devin', session: null });
  assert.deepEqual(dispatcher(undefined, env, '/devin/skills/codex'), { host: 'claude-code', session: 'fake-session' });
  assert.deepEqual(dispatcher(undefined, {}, '/Devin/skills/codex'), { host: 'devin', session: null });
  assert.deepEqual(dispatcher(undefined, {}, '/skills/codex'), { host: 'unknown', session: null });
  assert.equal(s.invoke([], { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'fake-session' }).status, 0);
  assert.equal(jsonl(path.join(s.home, 'runs.jsonl'))[0].dispatcher.host, 'claude-code');
  assert.throws(() => parseArgs(['task', '--host', 'other']));
});

test('角色、共同规则、说明文件、补充说明的指令拼装保持原样', t => {
  const s = setup(t);
  fs.mkdirSync(path.join(s.root, 'docs/roles'), { recursive: true });
  fs.writeFileSync(path.join(s.root, 'AGENTS.md'), '共同规则');
  fs.writeFileSync(path.join(s.root, 'docs/roles/engineering.md'), '# 角色：工程负责人\n职责');
  fs.writeFileSync(path.join(s.root, '任务 说明.md'), '任务');
  const result = taskDetails(s.root, parseArgs(['任务 说明.md', '补充内容', '--role', 'engineering']));
  assert.equal(result.name, '任务 说明');
  assert.equal(result.prompt, '你在本项目中的角色是「工程负责人」。\n请先阅读仓库根目录的 AGENTS.md（共同规则）。\n再阅读你的角色文档 docs/roles/engineering.md，严格遵守其中的职责、硬规则、完成标准和汇报格式。\n然后完成任务说明 任务 说明.md 中的全部内容，按要求验证、提交，最后给出汇报。\n补充内容');
  assert.throws(() => taskDetails(s.root, parseArgs(['task', '--role', 'missing'])));
  for (const name of ['../outside', 'CON', 'bad/name', 'trailing.']) assert.throws(() => taskDetails(s.root, parseArgs(['task', '--name', name])));
});

test('输出按 200 行 / 16KB 截断，UTF-8 不出现半字；命令去 shell 外壳', () => {
  assert.equal(limitOutput(Array(201).fill('行').join('\n')).output.split('\n').length, 200);
  const limited = limitOutput('汉'.repeat(6000));
  assert.ok(Buffer.byteLength(limited.output) <= 16384); assert.ok(limited.truncated); assert.doesNotMatch(limited.output, /�/);
  assert.deepEqual(limitOutput('OK\n'), { output: 'OK\n', truncated: false });
  assert.equal(shortCommand("powershell.exe -NoProfile -Command 'Write-Output ''hello'''"), "Write-Output 'hello'");
  assert.equal(shortCommand('node script.mjs -Command arg'), 'node script.mjs -Command arg');
});

test('文件转相对路径；完整文本、计划替换、未知事件和错误处理', t => {
  const s = setup(t), map = e => mapLine(JSON.stringify(e), { root: s.root });
  assert.deepEqual(map({ type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'add', path: path.join(s.root, 'src/a.ts') }] } }),
    [{ kind: 'file', files: [{ kind: 'add', path: 'src/a.ts' }] }]);
  assert.deepEqual(map({ type: 'future', item: { type: 'agent_message', text: 'ignored' } }), []);
  assert.deepEqual(mapLine(' ', { root: s.root }), []);
  assert.deepEqual(mapLine('null', { root: s.root }), []);
  assert.deepEqual(map({ type: 'item.completed', item: { type: 'todo_list', items: [] } }), [{ kind: 'plan', items: [] }]);
  assert.deepEqual(map({ type: 'item.completed', item: { type: 'error', message: '测试错误' } }), [{ kind: 'error', text: '测试错误' }]);
  assert.deepEqual(formatProgress({ kind: 'error', text: '测试错误' }), ['出错：测试错误']);
});

test('窗口策略及 viewer 存活检查，路径引号正确处理', t => {
  const s = setup(t);
  assert.equal(viewerTakesOver(s.home), false);
  fs.writeFileSync(path.join(s.home, 'viewer.json'), JSON.stringify({ pid: process.pid, suppressWatchWindow: true }));
  assert.equal(viewerTakesOver(s.home), true);
  assert.equal(viewerTakesOver(s.home, () => { throw new Error('进程已退出'); }), false);
  for (const [policy, takeover, expected] of [['auto', true, false], ['auto', false, true], ['always', true, true], ['never', false, false]]) {
    assert.equal(shouldWatch({ platform: 'win32', interactive: false, policy, takeover }), expected);
  }
  assert.equal(shouldWatch({ platform: 'win32', interactive: true, policy: 'always', takeover: false }), false);
  assert.equal(shouldWatch({ platform: 'linux', interactive: false, policy: 'always', takeover: false }), false);
  assert.ok(watchCommand("中文 '记录", "C:\\示例 路径\\a'b.log").includes("a''b.log"));
});

test('npm cmd 包装解析为 Node 入口，检测版本且没有 shell', t => {
  const s = setup(t), wrapper = path.join(s.base, 'npm 安装'); fs.mkdirSync(wrapper);
  fs.copyFileSync(fixture('fake-agent.txt'), path.join(wrapper, 'codex.js'));
  fs.writeFileSync(path.join(wrapper, 'codex.cmd'), '@echo off\n"%_prog%" "%dp0%\\codex.js" %*\n');
  assert.deepEqual(resolveLauncher({ PATH: wrapper }, 'win32'), { executable: process.execPath, args: [path.join(wrapper, 'codex.js')] });
  assert.equal(codex.detect({ env: s.env }).version, 'codex-cli test-fixture');
  assert.equal(codex.detect({ env: { PATH: '' } }).installed, false);
  fs.writeFileSync(path.join(wrapper, 'codex.cmd'), '@echo unsupported');
  assert.throws(() => resolveLauncher({ PATH: wrapper }, 'win32'), /无法解析/);
});

test('复制完整技能目录到 Devin 路径后仍能直接运行', t => {
  const s = setup(t), copied = path.join(s.base, 'Devin 技能/codex-dispatch');
  // 逐项复制，避免当前 Windows 环境下 cpSync 对含中文的嵌套目标静默漏文件。
  const copyTree = (source, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, item.name), to = path.join(target, item.name);
      if (item.isDirectory()) copyTree(from, to);
      else fs.copyFileSync(from, to);
    }
  };
  copyTree(path.join(project, 'skills/codex-dispatch'), copied);
  const result = s.invoke([], {}, path.join(copied, 'codex-task.mjs'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(jsonl(path.join(s.home, 'runs.jsonl'))[0].dispatcher, { host: 'devin', session: null });
});

test('退出前排空大块 stdout，保留最后事件；失败退出码传递', t => {
  const s = setup(t), result = s.invoke([], { FAKE_LARGE_FINAL: '1', FAKE_EXIT: '7', FAKE_STDERR: '1' });
  assert.equal(result.status, 7, result.stderr);
  const rows = jsonl(path.join(s.home, 'runs.jsonl'));
  const events = jsonl(rows[0].events);
  assert.equal(events.filter(e => e.kind === 'say').at(-1).text.length, 200000);
  assert.equal(events.at(-1).kind, 'error'); assert.equal(events.at(-1).text, '示例 stderr');
  assert.equal(rows.at(-1).exit, 7);
  assert.match(fs.readFileSync(rows[0].raw, 'utf8'), /示例 stderr/);
});

test('干活方启动即拒绝：stderr 原因进出错事件、进度和标准输出，并附中文提示', t => {
  const s = setup(t), refusal = 'Not inside a trusted directory and --skip-git-repo-check was not specified.';
  const result = s.invoke([], { FAKE_REFUSE: refusal });
  assert.equal(result.status, 1, result.stderr);
  const rows = jsonl(path.join(s.home, 'runs.jsonl'));
  assert.deepEqual(rows.map(e => e.event), ['start', 'spawned', 'end']);
  const errors = jsonl(rows[0].events).filter(e => e.kind === 'error').map(e => e.text);
  assert.equal(errors.length, 2);
  assert.equal(errors[0], refusal);
  assert.match(errors[1], /^当前目录不是 git 仓库/);
  const progress = fs.readFileSync(rows[0].progress, 'utf8');
  assert.match(progress, /出错：Not inside a trusted directory/);
  assert.match(progress, /出错：当前目录不是 git 仓库/);
  // 原因排在 exit 行之前，后台派发的派活方读输出就能看到。
  assert.match(result.stdout, /出错：Not inside a trusted directory[^\n]*\r?\n出错：当前目录不是 git 仓库[^\n]*\r?\nexit=1 /);
  // 成功的任务即使有 stderr 也不报错。
  const ok = s.invoke([], { FAKE_STDERR: '1' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout, /出错：/);
});

test('清单不能写入时任务照常完成；找不到 agent 时记录错误和 end', t => {
  const s = setup(t), blocked = path.join(s.base, '不能作为目录'); fs.writeFileSync(blocked, '占位');
  assert.doesNotThrow(() => registryWriter(blocked)({ event: 'start' }));
  assert.equal(s.invoke([], { CODEX_DISPATCH_HOME: blocked }).status, 0);
  const result = s.invoke([], { CODEX_DISPATCH_TEST_AGENT: '', PATH: '', Path: '' });
  assert.equal(result.status, 1, result.stderr);
  const rows = jsonl(path.join(s.home, 'runs.jsonl'));
  assert.deepEqual(rows.map(e => e.event), ['start', 'end']);
  assert.equal(jsonl(rows[0].events)[0].kind, 'error');
});

test('适配器不写汇报时用最后一条 say；spawn 错误也有完整结束记录', t => {
  const s = setup(t), wrapper = path.join(s.base, '测试 入口.mjs');
  const runURL = new URL('../skills/codex-dispatch/lib/run.mjs', import.meta.url).href;
  const adapterURL = new URL('../skills/codex-dispatch/adapters/codex.mjs', import.meta.url).href;
  fs.writeFileSync(wrapper, `import { run } from ${JSON.stringify(runURL)};
import { codex } from ${JSON.stringify(adapterURL)};
const adapter = { ...codex, writesReport: false };
if (process.env.FAKE_SPAWN_ERROR) adapter.command = () => ({ executable: ${JSON.stringify(path.join(s.base, '不存在.exe'))}, args: [], stdin: '' });
process.exitCode = await run({ adapter, scriptPath: import.meta.filename });\n`);
  assert.equal(s.invoke([], { FAKE_SKIP_REPORT: '1' }, wrapper).status, 0);
  let rows = jsonl(path.join(s.home, 'runs.jsonl'));
  assert.equal(fs.readFileSync(rows[0].report, 'utf8'), '已检查示例仓库。\n接下来执行验证。');
  const result = s.invoke([], { FAKE_SPAWN_ERROR: '1' }, wrapper);
  assert.equal(result.status, 1, result.stderr);
  rows = jsonl(path.join(s.home, 'runs.jsonl'));
  const failed = rows.filter(e => e.event === 'start').at(-1);
  assert.equal(rows.at(-1).exit, 1); assert.match(fs.readFileSync(failed.events, 'utf8'), /启动 Codex 失败/);
});

test('派发信号保留 interrupted 记录，不停止其他进程', t => {
  const s = setup(t), wrapper = path.join(s.base, '信号 入口.mjs');
  const runURL = new URL('../skills/codex-dispatch/lib/run.mjs', import.meta.url).href;
  const adapterURL = new URL('../skills/codex-dispatch/adapters/codex.mjs', import.meta.url).href;
  // 假 agent 输出首行后，测试入口自行触发信号；假 agent 正常结束，不调用系统进程终止接口。
  fs.writeFileSync(wrapper, `import { run } from ${JSON.stringify(runURL)};
import { codex } from ${JSON.stringify(adapterURL)};
const adapter = { ...codex, mapLine(line, context) { process.emit('SIGTERM'); return codex.mapLine(line, context); } };
process.exitCode = await run({ adapter, scriptPath: import.meta.filename });\n`);
  const result = s.invoke([], {}, wrapper);
  assert.equal(result.status, 1, result.stderr);
  const rows = jsonl(path.join(s.home, 'runs.jsonl'));
  assert.deepEqual(rows.map(e => e.event), ['start', 'spawned', 'interrupted']);
  assert.equal(rows.at(-1).signal, 'SIGTERM');
  assert.match(fs.readFileSync(rows[0].progress, 'utf8'), /派发脚本收到 SIGTERM，被外部中断/);
});
