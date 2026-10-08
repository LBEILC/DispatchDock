import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { composeSkill } from '../installer/lib/compose.mjs';
import { createPlan, executePlan, installationStatus, detectHosts, getStatus, rollback, uninstall, readTree, project, version } from '../installer/lib/install.mjs';
import { runInstaller } from '../installer/cli.mjs';
import { readCodexConfig } from '../installer/lib/codex-config.mjs';
import { readConfig, writeConfig, loadConfig, formatConfig } from '../skills/codex-dispatch/lib/config.mjs';
import { resolveLauncher, codex } from '../skills/codex-dispatch/adapters/codex.mjs';

const snapshot = root => [...readTree(root)].map(([name, item]) => [name, item?.data.toString('base64') ?? null]);
function setup(t) {
  const base = fs.mkdtempSync(join(tmpdir(), '安装 测试 '));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^CODEX_|^CLAUDE|^FAKE_/.test(key)) delete env[key];
  Object.assign(env, { USERPROFILE: join(base, '用户'), HOME: join(base, '用户'), APPDATA: join(base, '应用 数据'),
    CLAUDE_CONFIG_DIR: join(base, 'Claude 配置'), CODEX_HOME: join(base, 'Codex 配置'), CODEX_DISPATCH_HOME: join(base, '派发 配置'), XDG_CONFIG_HOME: join(base, 'XDG 配置') });
  for (const key of ['USERPROFILE', 'HOME', 'APPDATA', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CODEX_DISPATCH_HOME', 'XDG_CONFIG_HOME']) {
    const rel = relative(resolve(tmpdir()), resolve(env[key]));
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), key);
    fs.mkdirSync(env[key], { recursive: true });
  }
  fs.mkdirSync(join(env.APPDATA, 'devin'));
  t.after(() => { assert.equal(dirname(base), resolve(tmpdir())); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const options = { env, platform: 'win32' }, target = (host = 'claude-code', skill = 'codex-dispatch') => join(detectHosts(options).find(h => h.host === host).root, skill);
  const cli = (args = [], script = join(project, 'installer/install.mjs')) => spawnSync(process.execPath, [script, ...args], { env, cwd: base, encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000 });
  return { base, env, options, target, cli, home: env.CODEX_DISPATCH_HOME };
}
function install(s, extra = {}) { return executePlan(createPlan({ ...s.options, ...extra }), s.options); }
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('首次安装可撤销和重做，卸载可恢复并再次撤销，每批记录缺失状态', t => {
  const s = setup(t), first = install(s);
  const record = result => JSON.parse(fs.readFileSync(join(result.backup, 'backup.json')));
  assert.ok(record(first).items.every(i => i.existed === false));
  assert.deepEqual(fs.readdirSync(first.backup), ['backup.json']);
  const installed = snapshot(s.target());
  const undone = rollback(s.options);
  assert.equal(record(undone).reason, 'rollback');
  assert.ok(record(undone).items.every(i => i.existed === true));
  for (const item of first.changed) assert.ok(!fs.existsSync(item.target));
  const redone = rollback(s.options);
  assert.ok(record(redone).items.every(i => i.existed === false));
  assert.deepEqual(snapshot(s.target()), installed);
  const removed = uninstall(s.options);
  assert.equal(record(removed).reason, 'uninstall');
  assert.ok(record(removed).items.every(i => i.existed === true));
  rollback(s.options); assert.deepEqual(snapshot(s.target()), installed);
  rollback(s.options);
  for (const item of removed.changed) assert.ok(!fs.existsSync(item.target));
});

test('兼容无 existed 的旧备份，声明存在却缺少目录时拒绝且不改文件', t => {
  const s = setup(t); install(s);
  const original = snapshot(s.target()), result = install(s);
  const file = join(result.backup, 'backup.json'), record = JSON.parse(fs.readFileSync(file));
  for (const item of record.items) delete item.existed;
  write(file, JSON.stringify(record));
  rollback(s.options); assert.deepEqual(snapshot(s.target()), original);
  const latest = fs.readdirSync(join(s.home, 'backups')).sort().at(-1);
  const latestRoot = join(s.home, 'backups', latest);
  const source = join(latestRoot, 'claude-code', 'codex-dispatch');
  assert.ok(relative(s.base, source) && !relative(s.base, source).startsWith('..'));
  fs.rmSync(source, { recursive: true });
  const before = snapshot(s.base);
  assert.throws(() => rollback(s.options), /备份技能目录缺失/);
  assert.deepEqual(snapshot(s.base), before);
});

test('完成摘要包含实际数量、备份和撤销命令，无改动不打印撤销命令', async t => {
  const s = setup(t); write(join(s.target(), '自用.txt'), '保留');
  for (const [args, summary, action] of [
    [[], '已安装 3 个，跳过 1 个。', '安装'],
    [['--rollback'], '已回退 3 个。', '回退'],
    [['--rollback'], '已回退 3 个。', '回退'],
    [['--uninstall'], '已卸载 3 个。', '卸载'],
  ]) {
    const output = [];
    const result = await runInstaller(args, { ...s.options, output: line => output.push(line) });
    assert.equal(output.at(-2), summary);
    assert.equal(output.at(-1), `${action === '安装' ? '' : `原来的版本已备份到 ${result.backup}。`}要撤销这次${action}：node installer/install.mjs --rollback`);
  }
  const before = snapshot(s.base), output = [];
  await runInstaller(['--uninstall'], { ...s.options, output: line => output.push(line) });
  assert.deepEqual(output.slice(1), ['没有需要改动的技能。']);
  assert.deepEqual(snapshot(s.base), before);
});

test('卸载确认默认否且仅接受 y 或 yes，回退确认显示备份时间且默认是', async t => {
  const s = setup(t); install(s);
  for (const answer of ['', 'n', 'ok', 'yep']) {
    const before = snapshot(s.base);
    await runInstaller(['--uninstall'], { ...s.options, interactive: true, output() {}, ask: async prompt => {
      assert.equal(prompt, '卸载上面列出的技能？卸载前会备份，可以用 --rollback 恢复。[y/N] ');
      return answer;
    } });
    assert.deepEqual(snapshot(s.base), before);
  }
  for (const answer of ['y', ' YES ']) {
    const result = await runInstaller(['--uninstall'], { ...s.options, interactive: true, output() {}, ask: async () => answer });
    assert.equal(result.changed.length, 4);
    const at = JSON.parse(fs.readFileSync(join(result.backup, 'backup.json'))).at;
    const date = new Date(at), pad = n => String(n).padStart(2, '0');
    const restored = await runInstaller(['--rollback'], { ...s.options, interactive: true, output() {}, ask: async prompt => {
      assert.equal(prompt, `回退到 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} 之前的状态？当前版本会先备份，之后还能再回退。[Y/n] `);
      return '';
    } });
    assert.equal(restored.changed.length, 4); assert.ok(fs.existsSync(s.target()));
  }
});

test('配置表的中英文值按显示宽度对齐来源列', t => {
  const s = setup(t);
  assert.deepEqual(formatConfig(s.home, {}).split('\n').slice(1), [
    'model        跟随 Codex            内置默认',
    'effort       跟随 Codex            内置默认',
    'tier         跟随 Codex            内置默认',
    'sandbox      workspace-write       内置默认',
    'path         自动查找              内置默认',
    'watchWindow  auto                  内置默认',
  ]);
  writeConfig(s.home, { model: '中文模型' });
  assert.equal(formatConfig(s.home, {}).split('\n')[1], 'model        中文模型              config.json');
});

// 预期合成独立按正文的固定段名替换；不调用被测合成器生成答案。
function expected(skill, host) {
  let source = fs.readFileSync(join(project, 'skills', skill, 'SKILL.md'), 'utf8');
  if (host === 'devin') {
    const overlay = fs.readFileSync(join(project, 'skills/_hosts/devin', `${skill}.md`), 'utf8');
    source = source.replace(/  - Read(\r?\n)  - Grep\r?\n  - Glob/, (_, newline) => `  - read${newline}  - grep${newline}  - glob`);
    for (const section of skill === 'codex-dispatch' ? ['dispatch', 'wait', 'interrupt'] : ['agents-md', 'look']) {
      const pattern = new RegExp(`^[ \\t]*<!-- host:${section} -->\\r?\\n[\\s\\S]*?^[ \\t]*<!-- /host:${section} -->(?:\\r?\\n|$)`, 'm');
      source = source.replace(pattern, overlay.match(pattern)[0]);
    }
  }
  return source.replace(/^[ \t]*<!-- \/?host:[a-z0-9-]+ -->\r?\n/gm, '');
}

test('两个技能乘两个宿主合成与独立预期完全相同', t => {
  const s = setup(t), plan = createPlan(s.options);
  assert.equal(plan.items.length, 4);
  for (const item of plan.items) assert.equal(item.files.get('SKILL.md').data.toString(), expected(item.skill, item.host));
  assert.equal(composeSkill('---\nname: example\nvalue:\n  nested: old\n---\n<!-- host:a -->\nA\n<!-- /host:a -->\n', '---\nvalue:\n  nested: new\n---\n'), '---\nname: example\nvalue:\n  nested: new\n---\nA\n');
});

test('合成违规全部在写入前失败', t => {
  const s = setup(t), base = '---\nname: example\n---\n<!-- host:a -->\nA\n<!-- /host:a -->\n';
  const before = snapshot(s.base);
  for (const [source, overlay] of [[base, '<!-- host:b -->\nB\n<!-- /host:b -->\n'], [base, '---\nname: changed\n---\n'], [base.replace('<!-- /host:a -->',''), ''], [base + '<!-- host:a -->\n<!-- /host:a -->\n', ''], [base.replace('A\n', '<!-- host:b -->\n'), ''], [base, 'prefix <!-- host:bad -->'], [base.replace('host:a','host:UPPER'), '']]) assert.throws(() => composeSkill(source, overlay));
  assert.deepEqual(snapshot(s.base), before);
  // 后一个技能出错时，前一个技能也不能安装。
  const sourceRoot = join(s.base, '损坏源');
  for (const skill of ['codex-dispatch', 'dual-role-workflow']) write(join(sourceRoot, skill, 'SKILL.md'), base);
  write(join(sourceRoot, '_hosts/devin/dual-role-workflow.md'), '<!-- host:absent -->\n<!-- /host:absent -->\n');
  assert.throws(() => createPlan({ ...s.options, sourceRoot }));
  assert.ok(!fs.existsSync(s.target()));
});

test('安装记录版本和每个哈希正确，升级备份完整并可回退及再次回退', t => {
  const s = setup(t);
  assert.equal(install(s).changed.length, 4);
  const target = s.target(), record = JSON.parse(fs.readFileSync(join(target, '.dispatchdock.json')));
  assert.equal(record.version, version); assert.equal(record.v, 1); assert.equal(record.host, 'claude-code'); assert.ok(record.installedAt > 0);
  for (const [name, digest] of Object.entries(record.files)) assert.equal(createHash('sha256').update(fs.readFileSync(join(target, name))).digest('hex'), digest);
  assert.ok(!Object.hasOwn(record.files, '.dispatchdock.json'));
  record.version = '0.0.9'; write(join(target, '.dispatchdock.json'), JSON.stringify(record));
  const old = snapshot(target), result = install(s);
  assert.deepEqual(snapshot(join(result.backup, 'claude-code/codex-dispatch')), old);
  assert.equal(JSON.parse(fs.readFileSync(join(result.backup, 'backup.json'))).reason, 'install');
  const newer = snapshot(target);
  rollback(s.options); assert.deepEqual(snapshot(target), old);
  rollback(s.options); assert.deepEqual(snapshot(target), newer);
});

test('改过和别人的版本默认跳过，强制替换和卸载均先备份', t => {
  const s = setup(t); install(s);
  write(join(s.target(), '用户 文件.txt'), '保留');
  const foreign = s.target('devin'); fs.unlinkSync(join(foreign, '.dispatchdock.json'));
  fs.mkdirSync(join(foreign, '空目录'));
  assert.equal(installationStatus(s.target(), 'claude-code', 'codex-dispatch').state, 'modified');
  assert.equal(installationStatus(foreign, 'devin', 'codex-dispatch').state, 'foreign');
  const before = snapshot(s.target()), foreignBefore = snapshot(foreign);
  install(s); assert.deepEqual(snapshot(s.target()), before); assert.deepEqual(snapshot(foreign), foreignBefore);
  uninstall(s.options); assert.deepEqual(snapshot(s.target()), before); assert.deepEqual(snapshot(foreign), foreignBefore);
  const replacement = install(s, { replaceExisting: true });
  assert.deepEqual(snapshot(join(replacement.backup, 'devin/codex-dispatch')), foreignBefore);
  write(join(s.target(), 'changed.txt'), '新文件');
  const removed = uninstall({ ...s.options, replaceExisting: true });
  assert.ok(removed.backup); assert.ok(!fs.existsSync(s.target()));
  rollback(s.options); assert.equal(fs.readFileSync(join(s.target(), 'changed.txt'), 'utf8'), '新文件');
});

test('只保留最近五批备份；复制失败保留全部原目录且清理暂存', t => {
  const s = setup(t); install(s);
  for (let n = 0; n < 7; n++) install(s);
  assert.equal(fs.readdirSync(join(s.home, 'backups')).length, 5);
  const before = snapshot(s.base);
  let writes = 0;
  assert.throws(() => executePlan(createPlan(s.options), { ...s.options, onWrite: () => { if (++writes === 8) throw new Error('模拟复制出错'); } }), /模拟复制出错/);
  assert.deepEqual(snapshot(s.base), before);
  let commits = 0;
  assert.throws(() => executePlan(createPlan(s.options), { ...s.options, onCommit: () => { if (++commits === 2) throw new Error('模拟替换出错'); } }), /模拟替换出错/);
  assert.deepEqual(snapshot(s.base), before);
});

test('status 与 dry-run 前后目录快照不变，命令行非交互不写配置', t => {
  const s = setup(t), before = snapshot(s.base);
  for (const flag of ['--status', '--dry-run']) { const result = s.cli([flag]); assert.equal(result.status, 0, result.stderr); assert.deepEqual(snapshot(s.base), before); }
  const result = s.cli(['--yes']); assert.equal(result.status, 0, result.stderr);
  assert.ok(!readConfig(s.home).exists);
});

test('交互默认不替换，逐个允许替换，首次配置写入及已有配置不再问', async t => {
  const s = setup(t); write(join(s.target(), '自用.txt'), '不要覆盖');
  const questions = [], output = [], answers = ['', '', 'demo-model', 'high', 'demo-tier', 'read-only'];
  await runInstaller([], { ...s.options, interactive: true, ask: async q => { questions.push(q); return answers.shift(); }, output: line => output.push(line) });
  assert.equal(fs.readFileSync(join(s.target(), '自用.txt'), 'utf8'), '不要覆盖');
  assert.equal(questions[0], 'claude-code / codex-dispatch：备份后替换？[y/N] ');
  assert.deepEqual(readConfig(s.home).config.agents.codex, { model: 'demo-model', effort: 'high', tier: 'demo-tier', sandbox: 'read-only' });
  const nextQuestions = [];
  await runInstaller(['--host', 'claude-code', '--skill', 'codex-dispatch'], { ...s.options, interactive: true, ask: async q => { nextQuestions.push(q); return 'y'; }, output() {} });
  assert.equal(nextQuestions.length, 2); assert.ok(!fs.existsSync(join(s.target(), '自用.txt')));
});

test('全部回车仍写默认配置；yes 和 no-config 不询问配置；拒绝安装不写', async t => {
  for (const mode of ['default', 'yes', 'no-config', 'decline']) {
    const s = setup(t), questions = [];
    await runInstaller(mode === 'yes' ? ['--yes'] : mode === 'no-config' ? ['--no-config'] : [], { ...s.options, interactive: true, ask: async q => { questions.push(q); return mode === 'decline' ? 'n' : ''; }, output() {} });
    assert.equal(readConfig(s.home).exists, mode === 'default');
    assert.equal(questions.length, mode === 'default' ? 5 : mode === 'yes' ? 0 : 1);
    if (mode === 'default') assert.deepEqual(readConfig(s.home).config.agents.codex, { model: null, effort: null, tier: null, sandbox: 'workspace-write' });
    if (mode === 'decline') assert.ok(!fs.existsSync(s.target()));
  }
});

test('安装后的两个宿主直接派发，假 agent 清单识别宿主', t => {
  const s = setup(t); install(s);
  const fake = join(s.base, '假 agent.mjs'); fs.copyFileSync(join(project, 'tests/fixtures/fake-agent.txt'), fake);
  Object.assign(s.env, { CODEX_DISPATCH_TEST_AGENT: fake, CODEX_NO_WATCH: '1', FAKE_FIXTURES: JSON.stringify([join(project, 'tests/fixtures/codex-sample.jsonl')]), FAKE_ECHO: join(s.base, '参数.json') });
  for (const host of ['claude-code', 'devin']) {
    if (host === 'claude-code') s.env.CLAUDECODE = '1'; else delete s.env.CLAUDECODE;
    const result = s.cli(['测试任务', '--name', host], join(s.target(host), 'codex-task.mjs'));
    assert.equal(result.status, 0, result.stderr);
    const rows = fs.readFileSync(join(s.home, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.filter(r => r.event === 'start').at(-1).dispatcher.host, host);
    assert.match(result.stdout, new RegExp(`^记录名：${host}\\r?\\n进度：`));
    assert.match(result.stdout, /配置：未找到 config.json，模型、强度、档位跟随 Codex 自己的配置/);
  }
});

test('配置命令：查看、来源、修改、清空、init、未知键、拒写坏文件、保留未知字段', t => {
  const s = setup(t), entry = join(project, 'skills/codex-dispatch/codex-task.mjs'), invoke = args => s.cli(['--config', ...args], entry);
  let result = invoke([]); assert.equal(result.status, 0); assert.match(result.stdout, /不存在/); assert.match(result.stdout, /自动查找/); assert.match(result.stdout, /内置默认/);
  assert.ok(!fs.existsSync(join(s.base, '.codex-runs')));
  assert.equal(invoke(['init']).status, 0); const initial = fs.readFileSync(join(s.home, 'config.json'));
  assert.match(invoke(['init']).stdout, /已存在/); assert.deepEqual(fs.readFileSync(join(s.home, 'config.json')), initial);
  write(join(s.home, 'config.json'), JSON.stringify({ v: 1, unknown: { keep: true }, agents: { future: { keep: true }, codex: { unknown: 7 } } }));
  assert.equal(invoke(['model=test-model', 'effort=high', 'watchWindow=never', `path=${process.execPath}`]).status, 0);
  assert.equal(readConfig(s.home).config.unknown.keep, true); assert.equal(readConfig(s.home).config.agents.codex.unknown, 7);
  s.env.CODEX_MODEL = 'env-model'; assert.match(invoke([]).stdout, /env-model\s+环境变量 CODEX_MODEL/); delete s.env.CODEX_MODEL;
  assert.match(invoke([]).stdout, /test-model\s+config.json/);
  assert.equal(invoke(['model=-', 'path=-']).status, 0); assert.equal(readConfig(s.home).config.agents.codex.model, null);
  for (const arg of ['unknown=x', 'watchWindow=invalid', 'path=relative', 'init', 'model']) {
    const before = fs.readFileSync(join(s.home, 'config.json'));
    if (arg !== 'init') assert.notEqual(invoke([arg]).status, 0);
    else assert.equal(invoke([arg]).status, 0);
    assert.deepEqual(fs.readFileSync(join(s.home, 'config.json')), before);
  }
  for (const [bad, reason] of [['{', '不是有效的 JSON'], ['{"v":2}', 'v 不是 1']]) {
    write(join(s.home, 'config.json'), bad);
    assert.match(invoke([]).stdout, new RegExp(`无法读取（${reason}）`));
    assert.notEqual(invoke(['model=new']).status, 0); assert.equal(fs.readFileSync(join(s.home, 'config.json'), 'utf8'), bad);
  }
});

test('配置类型错误标明字段和来源，空环境变量不能遮住文件', t => {
  const s = setup(t);
  writeConfig(s.home, { model: 'file-model' });
  assert.equal(loadConfig(s.home, {}, { CODEX_MODEL: '' }).settings.model, 'file-model');
  assert.throws(() => loadConfig(s.home, { model: 1 }, {}), /命令行.*model/);
  assert.throws(() => loadConfig(s.home, {}, { CODEX_MODEL: 1 }), /环境变量 CODEX_MODEL.*model/);
  assert.throws(() => loadConfig(s.home, { 'watch-window': 'bad' }, {}), /命令行.*watchWindow/);
  write(join(s.home, 'config.json'), '{"v":1,"watchWindow":"bad"}');
  assert.throws(() => loadConfig(s.home, {}, {}), /config.json.*watchWindow/);
  write(join(s.home, 'config.json'), '{"v":1,"agents":{"codex":{"model":42}}}');
  assert.throws(() => loadConfig(s.home, {}, {}), /config.json.*model/);
});

test('指定入口优先于 PATH：js/mjs/cjs、exe、cmd/bat 和不存在的路径', t => {
  const s = setup(t);
  for (const extension of ['js', 'mjs', 'cjs']) {
    const file = join(s.base, `假入口.${extension}`); write(file, "console.log('codex-cli fake');");
    assert.deepEqual(resolveLauncher({ PATH: '' }, 'win32', file), { executable: process.execPath, args: [file] });
    assert.equal(codex.detect({ env: s.env, settings: { path: file } }).version, 'codex-cli fake');
  }
  assert.deepEqual(resolveLauncher({}, 'win32', process.execPath), { executable: process.execPath, args: [] });
  for (const extension of ['cmd', 'bat']) {
    const file = join(s.base, `包装.${extension}`); write(file, '"%_prog%" "%dp0%\\假入口.mjs" %*');
    assert.equal(resolveLauncher({}, 'win32', file).args[0], join(s.base, '假入口.mjs'));
    write(file, 'not npm'); assert.throws(() => resolveLauncher({}, 'win32', file), /无法解析 Codex 的启动包装：.*agents.codex.path/);
  }
  assert.throws(() => resolveLauncher({}, 'win32', join(s.base, 'missing.exe')), /找不到 Codex CLI。确认 codex --version 能运行/);
});

test('宿主路径注入、显式指定未安装宿主、仅装工作流提示依赖、最小 TOML 解析', async t => {
  const s = setup(t);
  assert.equal(detectHosts(s.options)[0].root, join(s.env.CLAUDE_CONFIG_DIR, 'skills'));
  assert.equal(detectHosts({ env: s.env, platform: 'linux' })[1].root, join(s.env.HOME, '.config/devin/skills'));
  const absent = { ...s.options, claudeDir: join(s.base, '没有 Claude'), devinDir: join(s.base, '没有 Devin') };
  assert.equal(createPlan(absent).items.length, 0);
  assert.equal(createPlan({ ...absent, host: 'claude-code' }).items.length, 2);
  assert.equal(createPlan({ ...s.options, skill: 'dual-role-workflow' }).warnings.length, 2);
  assert.equal(readCodexConfig(s.env), null);
  write(join(s.env.CODEX_HOME, 'config.toml'), 'model = "示例模型" # 注释\nmodel_reasoning_effort = \'high\'\nservice_tier = "example"\n[profile]\nmodel = "忽略"\n');
  assert.deepEqual(readCodexConfig(s.env).values, { model: '示例模型', model_reasoning_effort: 'high', service_tier: 'example' });
});
test('清单 spec 和进度文件路径统一为 /，无效配置提示文案及错误前缀完整', t => {
  const s = setup(t), fake = join(s.base, '假 agent.mjs');
  fs.copyFileSync(join(project, 'tests/fixtures/fake-agent.txt'), fake);
  const samples = join(s.base, '事件.jsonl');
  write(samples, JSON.stringify({ type: 'item.completed', item: { type: 'error', message: '示例条目错误' } }) + '\n' + JSON.stringify({ type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'add', path: join(s.base, 'src/new.ts') }] } }) + '\n');
  write(join(s.base, 'docs/任务.md'), '任务');
  Object.assign(s.env, { CODEX_NO_WATCH: '1', FAKE_FIXTURES: JSON.stringify([samples]), FAKE_ECHO: join(s.base, '参数.json') });
  const entry = join(project, 'skills/codex-dispatch/codex-task.mjs');
  writeConfig(s.home, { path: fake });
  let result = s.cli([join(s.base, 'docs/任务.md')], entry); assert.equal(result.status, 0, result.stderr);
  let row = fs.readFileSync(join(s.home, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)[0];
  assert.equal(row.spec, 'docs/任务.md');
  assert.match(fs.readFileSync(row.progress, 'utf8'), /新增文件：src\/new.ts/);
  assert.match(fs.readFileSync(row.progress, 'utf8'), /出错：示例条目错误/);
  for (const [invalid, reason] of [['{', '不是有效的 JSON'], ['{"v":2}', 'v 不是 1']]) {
    write(join(s.home, 'config.json'), invalid); s.env.CODEX_DISPATCH_TEST_AGENT = fake;
    result = s.cli(['任务'], entry); assert.equal(result.status, 0, result.stderr);
    const warning = `配置：config.json 无法读取（${reason}），本次按内置默认运行`;
    assert.ok(result.stdout.includes(warning));
    row = fs.readFileSync(join(s.home, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.event === 'start').at(-1);
    assert.ok(fs.readFileSync(row.progress, 'utf8').split('\n')[1].endsWith(warning));
  }
});

test('限定回退仅恢复指定项；损坏的备份拒绝写入；无宿主不创建配置', async t => {
  const s = setup(t); install(s);
  const old = snapshot(s.target()); install(s);
  const devin = snapshot(s.target('devin'));
  rollback({ ...s.options, host: 'claude-code', skill: 'codex-dispatch' });
  assert.deepEqual(snapshot(s.target()), old); assert.deepEqual(snapshot(s.target('devin')), devin);
  const latest = fs.readdirSync(join(s.home, 'backups')).sort().at(-1), file = join(s.home, 'backups', latest, 'backup.json');
  const record = JSON.parse(fs.readFileSync(file)); record.items[0].from = join(s.base, '其他 目录'); write(file, JSON.stringify(record));
  const before = snapshot(s.base); assert.throws(() => rollback(s.options), /不一致/); assert.deepEqual(snapshot(s.base), before);
  const s2 = setup(t); let asked = false;
  await runInstaller(['--claude-dir', join(s2.base, '不存在1'), '--devin-dir', join(s2.base, '不存在2')], { ...s2.options, interactive: true, ask: () => { asked = true; return ''; }, output() {} });
  assert.equal(asked, false); assert.equal(readConfig(s2.home).exists, false);
});
