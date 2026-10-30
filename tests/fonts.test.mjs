import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { zip } from '../tools/pack-skills.mjs';
import { request, remoteEntry } from '../tools/fonts.mjs';

const chunkSize = 4 * 1024 * 1024;
const raw = randomBytes(2 * chunkSize + 123);
const archive = zip([{ name: 'fixture.ttf', bytes: raw }]);
const start = 30 + Buffer.byteLength('fixture.ttf');
const size = archive.readUInt32LE(18);
const ranges = Array.from({ length: Math.ceil(size / chunkSize) }, (_, i) =>
  `bytes=${start + i * chunkSize}-${start + Math.min((i + 1) * chunkSize, size) - 1}`);
const options = { timeoutMs: 1000, retryDelayMs: 1 };

async function serve(t, handler) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.headers.range);
    handler(req, res, calls);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  return { url: `http://127.0.0.1:${server.address().port}/font.zip`, calls };
}

function sendRange(req, res) {
  const range = req.headers.range;
  const [from, to] = range === 'bytes=-65557'
    ? [archive.length - 65557, archive.length - 1]
    : range.slice(6).split('-').map(Number);
  res.writeHead(206, { 'Content-Range': `bytes ${from}-${to}/${archive.length}`, 'Content-Length': to - from + 1 });
  res.end(archive.subarray(from, to + 1));
}

test('大条目按 4 MiB 分块拼接后解压，字节与 SHA-256 一致', async t => {
  const s = await serve(t, sendRange);
  const result = await remoteEntry(s.url, /fixture\.ttf$/, options);
  assert.deepEqual(result, raw);
  assert.equal(createHash('sha256').update(result).digest('hex'), createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(s.calls, ['bytes=-65557', 'bytes=0-29', ...ranges]);
});

test('中间块响应体超时后只重试该块，已完成的块不重读', async t => {
  let stalled = false;
  const s = await serve(t, (req, res) => {
    if (req.headers.range === ranges[1] && !stalled) {
      stalled = true;
      res.writeHead(206, { 'Content-Length': chunkSize });
      res.write(Buffer.from([1])); // 已收到响应头，响应体保持未完成直到客户端超时。
      return;
    }
    sendRange(req, res);
  });
  assert.deepEqual(await remoteEntry(s.url, /fixture\.ttf$/, options), raw);
  assert.deepEqual(s.calls, ['bytes=-65557', 'bytes=0-29', ranges[0], ranges[1], ranges[1], ranges[2]]);
});

test('响应体断线会重新请求并成功读取', async t => {
  const s = await serve(t, (_req, res, calls) => {
    res.writeHead(200, { 'Content-Length': 2 });
    res.write('a');
    if (calls.length === 1) setImmediate(() => res.destroy());
    else res.end('b');
  });
  assert.equal((await request(s.url, undefined, undefined, options)).bytes.toString(), 'ab');
  assert.equal(s.calls.length, 2);
});

for (const status of [429, 503]) {
  test(`HTTP ${status} 最多重试三次，用尽后报错`, async t => {
    const s = await serve(t, (_req, res) => { res.writeHead(status); res.end(); });
    await assert.rejects(request(s.url, undefined, undefined, options), new RegExp(`HTTP ${status}`));
    assert.equal(s.calls.length, 4);
  });
}

for (const status of [400, 403, 404, 416]) {
  test(`HTTP ${status} 不重试`, async t => {
    const s = await serve(t, (_req, res) => { res.writeHead(status); res.end(); });
    await assert.rejects(request(s.url, undefined, undefined, options), new RegExp(`HTTP ${status}`));
    assert.equal(s.calls.length, 1);
  });
}

test('首次 Range 被忽略时保留完整 ZIP 读取兼容', async t => {
  const s = await serve(t, (_req, res) => res.end(archive));
  assert.deepEqual(await remoteEntry(s.url, /fixture\.ttf$/, options), raw);
  assert.deepEqual(s.calls, ['bytes=-65557']);
});

for (const ignored of ['bytes=0-29', ranges[1]]) {
  test(`后续 Range ${ignored} 返回 200 时立即取消且不重试`, async t => {
    const s = await serve(t, (req, res) => {
      if (req.headers.range === ignored) {
        res.writeHead(200);
        res.write('ignored'); // 不结束响应，验证收到状态后即拒绝，无需等待响应体。
      } else sendRange(req, res);
    });
    await assert.rejects(remoteEntry(s.url, /fixture\.ttf$/, options), /不再支持范围读取/);
    assert.equal(s.calls.filter(range => range === ignored).length, 1);
    assert.equal(s.calls.at(-1), ignored);
  });
}
