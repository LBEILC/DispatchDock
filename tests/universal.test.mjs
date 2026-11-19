import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workflow as publicWorkflow, invoke } from '../skills/codex-dispatch/index.mjs';
import { runWorkflow, planWorkflow } from '../skills/codex-dispatch/lib/workflow.mjs';
import { resolveActor, invokeAgent } from '../skills/codex-dispatch/lib/invoke.mjs';
import { agentEnvironment, profileOptions } from '../skills/codex-dispatch/lib/profiles.mjs';
import { runProgram } from '../skills/codex-dispatch/lib/program.mjs';
import { importProfiles } from '../skills/codex-dispatch/lib/config.mjs';

const cli = fileURLToPath(new URL('../skills/codex-dispatch/dispatch.mjs', import.meta.url));
async function fixture(t, { rogue = false } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'dispatchdock-universal-')), root = path.join(base, 'repo'), home = path.join(base, 'home');
  await mkdir(root); await mkdir(home); await writeFile(path.join(root, '.gitignore'), '.codex-runs/\n');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, windowsHide: true }).status, 0);
  const calls = [], counts = { lead: 0, builder: 0, judge: 0 };
  const keyNames = { lead: 'LEAD_CRED', builder: 'BUILD_CRED', judge: 'JUDGE_CRED' };
  const env = { ...process.env, CODEX_DISPATCH_HOME: home, CODEX_NO_WATCH: '1', LEAD_CRED: 'fixture-lead', BUILD_CRED: 'fixture-build', JUDGE_CRED: 'fixture-judge' }; delete env.CODEX_DRY_RUN;
  const server = createServer(async (req, res) => {
    const role = req.url.split('/')[1]; let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input); calls.push(role); counts[role]++;
    assert.equal(req.headers.authorization, 'Bearer ' + env[keyNames[role]]);
    assert.equal(body.thinking, undefined, '通用接口不能强塞某一家模型的参数');
    assert.equal(body.model, 'arbitrary-' + role);
    const tool = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'tool-' + counts[role], type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    let message;
    if (role === 'lead') {
      assert.match(body.messages[0].content, /plan/);
      message = { role: 'assistant', content: JSON.stringify({ tasks: [{ id: 'one', prompt: 'write result', acceptance: 'done with newline', files: [rogue ? '../outside' : 'result.txt'] }] }) };
    } else if (role === 'builder') {
      if (body.messages.at(-1).role === 'user') {
        const rework = body.messages.at(-1).content.includes('append newline');
        message = rework ? tool('replace_text', { path: 'result.txt', old_text: 'done', new_text: 'done\n' }) : tool('write_file', { path: 'result.txt', content: 'done' });
      } else message = { role: 'assistant', content: 'Worker artifact is ready for independent review.' };
    } else {
      assert.match(body.messages[0].content, /review/);
      assert.ok(!body.tools.some(tool => tool.function.name === 'write_file'));
      if (body.messages.at(-1).role === 'user') message = tool('read_file', { path: 'result.txt', start_line: 1, line_count: 10 });
      else {
        const content = JSON.parse(body.messages.at(-1).content).content;
        message = { role: 'assistant', content: JSON.stringify({ decision: content === 'done\n' ? 'accept' : 'rework', feedback: content === 'done\n' ? 'artifact checked' : 'append newline' }) };
      }
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(base, { recursive: true, force: true, maxRetries: 5 }); });
  const agents = Object.fromEntries(Object.keys(counts).map(role => [role, { adapter: 'chat-completions', model: 'arbitrary-' + role, api: { baseUrl: `http://127.0.0.1:${server.address().port}/${role}`, apiKeyEnv: keyNames[role] } }]));
  const config = { v: 1, agents }; await writeFile(path.join(home, 'config.json'), JSON.stringify(config));
  const request = { v: 1, name: 'universal', goal: 'complete the artifact', director: 'lead', worker: 'builder', reviewer: 'judge', files: ['result.txt'], checks: [{ name: 'content', executable: '@node', args: ['-e', 'process.exit(require("node:fs").readFileSync("result.txt","utf8").trim()==="done"?0:1)'], timeoutMs: 5000 }] };
  return { base, root, home, env, config, request, calls, counts };
}

test('三个任意命名 API 分别规划、执行和验收；返工后完成且恢复不重复规划', async t => {
  const f = await fixture(t);
  assert.equal(await runWorkflow({ request: f.request, root: f.root, env: f.env }), 0);
  const state = JSON.parse(await readFile(path.join(f.root, '.codex-runs/universal.queue.json'), 'utf8'));
  assert.equal(state.status, 'done'); assert.equal(state.tasks[0].attempts, 2); assert.equal(state.reviews, 2);
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'done\n');
  assert.equal(f.counts.lead, 1); assert.ok(f.counts.builder >= 4); assert.ok(f.counts.judge >= 4);
  const count = f.calls.length; assert.equal(await runWorkflow({ request: f.request, root: f.root, env: f.env, resume: true }), 0); assert.equal(f.calls.length, count);
  const doctor = await runProgram(process.execPath, [cli, 'agents', 'check', 'builder'], { root: f.root, env: f.env });
  assert.equal(doctor.code, 0); const data = JSON.parse(doctor.stdout); assert.equal(data.agent, 'builder'); assert.equal(data.networkChecked, false); assert.doesNotMatch(doctor.stdout, /fixture-build/);
});

test('规划模型提出范围外文件时拒绝，不启动下级', async t => {
  const f = await fixture(t, { rogue: true });
  await assert.rejects(planWorkflow({ request: f.request, root: f.root, env: f.env }), /扩大/);
  assert.deepEqual(f.calls, ['lead']);
});

test('AI 配置或目标改变后不能悄悄恢复旧工作流', async t => {
  const f = await fixture(t);
  await runWorkflow({ request: f.request, root: f.root, env: f.env });
  await assert.rejects(runWorkflow({ request: { ...f.request, goal: 'different' }, root: f.root, env: f.env, resume: true }), /目标或授权范围改变/);
  f.config.agents.builder.model = 'changed'; await writeFile(path.join(f.home, 'config.json'), JSON.stringify(f.config));
  await assert.rejects(runWorkflow({ request: f.request, root: f.root, env: f.env, resume: true }), /AI 配置已改变/);
});

test('凭据名称不含 KEY/TOKEN 的配置同样按角色隔离；保留原有 Codex 配置别名', () => {
  const config = { agents: { a: { adapter: 'bridge', credentialEnv: ['ODD_A'] }, b: { adapter: 'bridge', credentialEnv: ['ODD_B'] }, critic: { adapter: 'codex', model: 'sample' } } };
  const actor = resolveActor(config, 'a');
  assert.deepEqual(agentEnvironment(actor.settings, { ODD_A: 'own', ODD_B: 'other', PATH: 'runtime', OPENAI_API_KEY: 'unneeded' }, 'a'), { ODD_A: 'own', PATH: 'runtime' });
  assert.equal(resolveActor(config, 'critic').settings.adapter, 'codex');
  assert.throws(() => profileOptions({ adapter: 'chat-completions' }), /必须提供 api/);
  assert.throws(() => profileOptions({ api: { baseUrl: 'https://example.com', apiKeyEnv: 'X', apiKey: 'inline' } }), /密钥或未知/);
});

test('原生 Codex 别名和通用桥接都收到一致的操作与 JSON 输出要求', async t => {
  const f = await fixture(t), codex = path.join(f.base, 'fake-codex.mjs');
  await writeFile(codex, `import fs from 'node:fs';if(process.argv.includes('--version')){console.log('fake codex');process.exit(0);}process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({decision:'accept',feedback:'native alias'}));});`);
  const config = { agents: { interchangeable: { adapter: 'codex', path: codex } } };
  const result = await invokeAgent({ config, selection: 'interchangeable', operation: 'review', prompt: 'review artifact', root: f.root, folder: path.join(f.base, 'native'), outputSchema: { type: 'object' }, env: f.env });
  assert.equal(result.value.decision, 'accept'); assert.equal(result.agent, 'interchangeable');
});
test('导入 AI 名称可复用且有恢复备份；错误配置不会部分写入', async t => {
  const f = await fixture(t), file = path.join(f.home, 'config.json'), before = await readFile(file, 'utf8');
  assert.throws(() => importProfiles(f.home, { unsafe: { apiKey: 'inline' } }), /字段无效/);
  assert.equal(await readFile(file, 'utf8'), before);
  const imported = importProfiles(f.home, { reusable: { adapter: 'codex', model: 'sample' } });
  assert.equal(await readFile(imported.backup, 'utf8'), before);
  assert.throws(() => importProfiles(f.home, { reusable: { adapter: 'codex' } }), /已存在/);
  const cliResult = await runProgram(process.execPath, [cli, 'agents', 'list'], { root: f.root, env: f.env });
  assert.ok(JSON.parse(cliResult.stdout).profiles.includes('reusable'));
});

test('通用 CLI 的真实入口完成规划、返工与验收，持久化进程身份', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'workflow.json'); await writeFile(file, JSON.stringify(f.request));
  const result = await runProgram(process.execPath, [cli, 'workflow', file], { root: f.root, env: f.env });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(f.counts.lead, 1);
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'done\n');
  const records = (await readFile(path.join(f.home, 'runs.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(records.find(row => row.event === 'start' && row.agent === 'queue').pidCreated > 0);
});

test('工作流在队列锁已持久化但状态尚未创建时仍可恢复', async t => {
  const f = await fixture(t);
  const { plan } = await planWorkflow({ request: f.request, root: f.root, env: f.env });
  const dir = path.join(f.root, '.codex-runs');
  await writeFile(path.join(dir, 'universal.workflow.json'), JSON.stringify({ v: 1, requestHash: createHash('sha256').update(JSON.stringify(f.request)).digest('hex'), plan }));
  await writeFile(path.join(dir, '.queue-workspace.lock'), JSON.stringify({ name: 'universal', pid: 0, created: 0, nonce: 'interrupted' }));
  assert.equal(await publicWorkflow({ request: f.request, root: f.root, env: f.env, resume: true }), 0);
  assert.equal(f.counts.lead, 1, '恢复采用原计划，不再次付费规划');
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'done\n');
});

test('嵌套或变体凭据字段拒绝落盘，普通模型参数仍可使用', async t => {
  const f = await fixture(t), file = path.join(f.home, 'config.json'), before = await readFile(file, 'utf8');
  for (const key of ['x-api-key', 'access_token', 'clientSecret', 'private_key', 'credentials', 'Authorization']) {
    assert.throws(() => importProfiles(f.home, { unsafe: { adapter: 'chat-completions', model: 'fixture', api: { baseUrl: 'https://example.test/v1', apiKeyEnv: 'TEST_KEY', parameters: { nested: { [key]: 'fixture-value' } } } } }), /密钥/);
    assert.equal(await readFile(file, 'utf8'), before);
  }
  assert.doesNotThrow(() => profileOptions({ adapter: 'chat-completions', api: { baseUrl: 'https://example.test/v1', apiKeyEnv: 'TEST_KEY', parameters: { temperature: 0.1, max_tokens: 200, thinking: { type: 'disabled' } } } }));
});

test('公开 JS 调用的未知操作在启动 AI 或访问接口前失败', async t => {
  const f = await fixture(t);
  await assert.rejects(invoke({ agent: 'lead', operation: 'reveiw', prompt: 'do not start', root: f.root, env: f.env }), /operation 必须/);
  assert.deepEqual(f.calls, []);
});
