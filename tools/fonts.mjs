import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export const fontFile = 'build/fonts/MiSansVF.ttf';
export const fontHash = '5daf8d5447bfd423cfdec94a0e07c53b205892223ccc6ea21b7b8a37248b44d9';
export const downloadPage = 'https://hyperos.mi.com/font/download';
export async function checkFont(file = fontFile) {
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== fontHash) throw Error('MiSans SHA-256 不符');
  return bytes;
}
// 只读取 ZIP 中指定的文件，不把压缩包里的路径写入文件系统。
function zipDirectory(bytes, offset = 0) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw Error('官方字体包不是有效的 ZIP');
  let at = bytes.readUInt32LE(end + 16) - offset;
  if (at < 0) throw Error('官方字体包目录超过读取范围');
  const entries = [];
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw Error('ZIP 目录无效');
    const length = bytes.readUInt16LE(at + 28), name = bytes.subarray(at + 46, at + 46 + length).toString('utf8');
    entries.push({ name, local: bytes.readUInt32LE(at + 42), size: bytes.readUInt32LE(at + 20), method: bytes.readUInt16LE(at + 10) });
    at += 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return entries;
}
function unpack(bytes, method) {
  if (method === 0) return bytes;
  if (method === 8) return inflateRawSync(bytes);
  throw Error('官方字体包使用了不支持的压缩方式');
}
function zipEntry(bytes, pattern) {
  const entry = zipDirectory(bytes).find(e => pattern.test(e.name));
  if (!entry) throw Error('官方包没有所需的字体文件');
  const start = entry.local + 30 + bytes.readUInt16LE(entry.local + 26) + bytes.readUInt16LE(entry.local + 28);
  return unpack(bytes.subarray(start, start + entry.size), entry.method);
}
export async function request(url, headers, expectedStatus, { timeoutMs = 120000, retryDelayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`HTTP ${response.status}: ${url}`);
      }
      if (expectedStatus && response.status !== expectedStatus) {
        await response.body?.cancel();
        throw Error('官方下载不再支持范围读取');
      }
      // 读取响应体也可能断线，必须与请求一起重试；解压和哈希校验在重试之外。
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes };
    } catch (error) {
      if (response?.ok && expectedStatus && response.status !== expectedStatus) throw error;
      const retryable =
        response?.ok || !response || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= 3) throw error;
      const backoff = retryDelayMs * 2 ** attempt;
      console.warn(`字体下载失败，${backoff}ms 后重试（${attempt + 1}/3）：${url}`);
      await delay(backoff);
    }
  }
}
export async function remoteEntry(url, pattern, requestOptions) {
  // 官方包很大；支持 Range 时仅下载中央目录及所需条目。
  const tail = await request(url, { Range: 'bytes=-65557' }, undefined, requestOptions);
  const bytes = tail.bytes;
  if (tail.status === 200) return zipEntry(bytes, pattern);
  const offset = Number(tail.headers.get('content-range')?.match(/^bytes (\d+)-/)?.[1]);
  if (!Number.isFinite(offset)) throw Error('官方下载返回了无效的范围');
  const entry = zipDirectory(bytes, offset).find(e => pattern.test(e.name));
  if (!entry) throw Error('官方包没有所需的字体文件');
  const headerResponse = await request(url, { Range: `bytes=${entry.local}-${entry.local + 29}` }, 206, requestOptions);
  const header = headerResponse.bytes;
  if (header.readUInt32LE(0) !== 0x04034b50) throw Error('ZIP 文件头无效');
  const start = entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  // 每块独立计时和重试，全部拼接后才解压，避免慢速链路上的大请求超时。
  const chunks = [];
  const chunkSize = 4 * 1024 * 1024;
  for (let at = start; at < start + entry.size; at += chunkSize) {
    const end = Math.min(at + chunkSize, start + entry.size) - 1;
    const response = await request(url, { Range: `bytes=${at}-${end}` }, 206, requestOptions);
    if (response.bytes.length !== end - at + 1) throw Error('官方下载返回了无效的范围长度');
    chunks.push(response.bytes);
  }
  return unpack(Buffer.concat(chunks), entry.method);
}
export async function prepareFont() {
  const html = (await request(downloadPage)).bytes.toString('utf8');
  let source = html;
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
    const url = new URL(match[1], downloadPage);
    if (url.hostname === 'hyperos.mi.com') source += (await request(url)).bytes.toString('utf8');
  }
  const match = [...source.matchAll(/["']([^"']*MiSans(?:%20| )[Vv][Ff][^"']*\.ttf|[^"']*MiSans\.zip)["']/g)][0];
  // 当前官方页面用 origin + 下载目录 + downloadLink 动态生成地址。
  const directory = source.match(/window\.location\.origin\+["']([^"']+)["']/)?.[1];
  const dynamic = directory && /downloadLink:["']MiSans["']/.test(source) && source.includes('.concat(e.downloadLink,".zip")') ? `${directory}/MiSans.zip` : null;
  if (!match && !dynamic) throw Error('官方下载页未提供可识别的 MiSans 包，请检查站点变更');
  let url = new URL(match?.[1] || dynamic, downloadPage);
  const fontPattern = /(?:^|\/)MiSans ?VF\.ttf$/;
  let bytes = url.pathname.endsWith('.ttf') ? (await request(url)).bytes : await remoteEntry(url, fontPattern);
  if (createHash('sha256').update(bytes).digest('hex') !== fontHash && directory && source.includes('/MiSans_Global_ALL.zip')) {
    console.log('单独下载包的字体版本已变化，检查同页官方全量包中的指定版本。');
    url = new URL(`${directory}/MiSans_Global_ALL.zip`, downloadPage);
    bytes = zipEntry(await remoteEntry(url, /(?:^|\/)MiSans\.zip$/), fontPattern);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== fontHash) throw Error('字体版本的 SHA-256 与定稿不一致，拒绝使用');
  await mkdir(path.dirname(fontFile), { recursive: true });
  await writeFile(fontFile, bytes);
  console.log(JSON.stringify({ source: String(url), version: '4.003', sha256: fontHash, bytes: bytes.length }));
}
export async function copyFont(out, source = fontFile) {
  const target = path.join(out, 'fonts', 'MiSansVF.ttf');
  try { const bytes = await checkFont(source); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); return true; }
  catch (error) { await rm(target, { force: true }); console.warn(`警告：MiSans 字体缺失或 SHA-256 不符，使用系统字体；运行 npm run fonts。${error.code || error.message}`); return false; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareFont();
