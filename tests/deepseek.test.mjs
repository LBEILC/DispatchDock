import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runDeepSeek, readTool } from '../skills/codex-dispatch/workers/deepseek.mjs';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'dispatchdock-deepseek-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5 }));
  const repo = path.join(base, 'repo'); await mkdir(repo);
  await writeFile(path.join(repo, 'sample.txt'), '第一行\n第二行\n');
  return { base, repo, request: { v: 1, repo, prompt: '读取 sample.txt 并汇报', settings: { model: 'test-model', sandbox: 'read-only' } }, env: { DEEPSEEK_API_KEY: 'fake-test-key' } };
}
const reply = (message, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message }, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { headers: { 'Content-Type': 'application/json' } });

test('DeepSeek 工具闭环：实际读取隔离文件，保留上下文和用量，输出最终汇报', async t => {
  const f = await fixture(t), events = [], requests = [];
  await runDeepSeek(f.request, { env: f.env, emit: e => events.push(e), fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); requests.push(body);
    return requests.length === 1 ? reply({ content: null, reasoning_content: '保留协议字段', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'sample.txt', start_line: 2, line_count: 1 }) } }] }, 'tool_calls') : reply({ content: 'sample.txt:2 是第二行。' });
  } });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages[2].reasoning_content, '保留协议字段');
  assert.equal(JSON.parse(requests[1].messages[3].content).content, '第二行');
  assert.equal(events.at(-1).text, 'sample.txt:2 是第二行。');
  assert.equal(events.filter(e => e.kind === 'turn').length, 2);
  assert.doesNotMatch(JSON.stringify(events), /fake-test-key/);
});

test('DeepSeek 仓库边界、敏感文件、目录联接和工具参数', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'outside.txt'), '不可读');
  await writeFile(path.join(f.repo, '.env'), '不可读');
  await symlink(f.base, path.join(f.repo, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const file of ['../outside.txt', '.env', 'outside/outside.txt']) await assert.rejects(readTool(f.repo, 'read_file', { path: file, start_line: 1, line_count: 1 }), /范围/);
  await assert.rejects(readTool(f.repo, 'run_command', { path: '.' }), /未知工具/);
  await assert.rejects(readTool(f.repo, 'read_file', { path: 'sample.txt', start_line: 0, line_count: 1 }), /start_line/);
  const listing = await readTool(f.repo, 'list_files', { path: '.' });
  assert.deepEqual(listing.entries.map(item => item.name), ['sample.txt']);
});

test('DeepSeek 拒绝写权限、缺失密钥与不安全地址，未发起请求', async t => {
  const f = await fixture(t), fetcher = async () => { throw Error('不应请求'); };
  await assert.rejects(runDeepSeek({ ...f.request, settings: { ...f.request.settings, sandbox: 'workspace-write' } }, { env: f.env, fetcher }), /可写策略/);
  await assert.rejects(runDeepSeek(f.request, { env: {}, fetcher }), /DEEPSEEK_API_KEY/);
  await assert.rejects(runDeepSeek(f.request, { env: { ...f.env, DEEPSEEK_BASE_URL: 'http://example.com' }, fetcher }), /HTTPS/);
});

test('DeepSeek HTTP 错误不泄漏响应，截断与循环耗尽均失败', async t => {
  const f = await fixture(t), options = { env: f.env, emit() {} };
  await assert.rejects(runDeepSeek(f.request, { ...options, fetcher: async () => new Response('sensitive response', { status: 401 }) }), /^Error: DeepSeek API 返回 HTTP 401$/);
  await assert.rejects(runDeepSeek(f.request, { ...options, fetcher: async () => reply({ content: '部分汇报' }, 'length') }), /截断/);
  let calls = 0;
  await assert.rejects(runDeepSeek(f.request, { ...options, fetcher: async () => { calls++; return reply({ content: null, tool_calls: [{ id: `t-${calls}`, type: 'function', function: { name: 'list_files', arguments: '{"path":"."}' } }] }, 'tool_calls'); } }), /12 轮/);
  assert.equal(calls, 12);
});

test('真实派发入口通过本机假 API 完成 DeepSeek 文件检查并记录汇报', async t => {
  const f = await fixture(t), home = path.join(f.base, 'home'); await mkdir(home);
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ v: 1 }));
  let calls = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/chat/completions'); assert.equal(req.headers.authorization, 'Bearer fake-test-key');
    let input = ''; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input); calls++;
    const message = calls === 1 ? { content: null, tool_calls: [{ id: 'file', type: 'function', function: { name: 'read_file', arguments: '{"path":"sample.txt","start_line":1,"line_count":1}' } }] } : { content: JSON.parse(body.messages.at(-1).content).content + '：检查完成' };
    res.setHeader('Content-Type', 'application/json'); res.end(await reply(message, calls === 1 ? 'tool_calls' : 'stop').text());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = fileURLToPath(new URL('../skills/codex-dispatch/codex-task.mjs', import.meta.url));
  const env = { ...process.env, ...f.env, DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, CODEX_DISPATCH_HOME: home, CODEX_NO_WATCH: '1' };
  delete env.CODEX_DRY_RUN;
  const result = await promisify(execFile)(process.execPath, [entry, f.request.prompt, '--agent', 'deepseek', '--model', 'test-model', '--host', 'codex', '--name', 'ds-audit'], { cwd: f.repo, env, timeout: 15000, windowsHide: true });
  assert.match(result.stdout, /exit=0/); assert.equal(calls, 2);
  const registry = await readFile(path.join(home, 'runs.jsonl'), 'utf8');
  assert.doesNotMatch(registry, /fake-test-key/);
  const start = JSON.parse(registry.split('\n')[0]); assert.equal(start.agent, 'deepseek');
  assert.equal(await readFile(start.report, 'utf8'), '第一行：检查完成');
  assert.match(await readFile(start.events, 'utf8'), /read_file/);
});
