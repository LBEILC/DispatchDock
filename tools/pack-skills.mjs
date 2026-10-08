import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

// ZIP32 使用 UTF-8 文件名、原始 DEFLATE 和中央目录；超过格式上限时明确失败。
export function zip(entries) {
  if (entries.length > 65535) throw Error('ZIP32 文件数量超限');
  const local = [], directory = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(name, 'utf8'), data = deflateRawSync(bytes);
    if (filename.length > 65535 || bytes.length > 0xffffffff || offset + data.length + 30 + filename.length > 0xffffffff) throw Error('ZIP32 大小超限');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 固定为 1980-01-01，使相同输入可重复打包。
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 30); central.writeUInt32LE(offset, 42);
    local.push(header, filename, data); directory.push(central, filename);
    offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  if (offset + central.length > 0xffffffff) throw Error('ZIP32 大小超限');
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}

export async function packSkills(root = process.cwd(), output = path.join(root, 'release')) {
  const entries = [];
  async function add(name, optional = false) {
    let info;
    try { info = await lstat(path.join(root, name)); }
    catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw Error(`不打包符号链接：${name}`);
    if (info.isDirectory()) {
      for (const child of (await readdir(path.join(root, name))).sort()) await add(`${name}/${child}`);
    } else if (info.isFile()) entries.push({ name, bytes: await readFile(path.join(root, name)) });
    else throw Error(`不支持的文件类型：${name}`);
  }
  for (const name of ['skills', 'installer', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await add(name);
  for (const name of ['README.md', 'README.en.md']) await add(name, true);
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw Error('无效版本号');
  const filename = `dispatchdock-skills-${version}.zip`;
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, filename), zip(entries));
  return { filename, files: entries.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(await packSkills()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
