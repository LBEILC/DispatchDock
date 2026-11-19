import { open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { processCreated, pidAlive } from './process.mjs';
const read = async file => JSON.parse(await readFile(file, 'utf8'));
export async function ownerAlive(owner) {
  if (!pidAlive(owner.pid)) return false;
  const actual = await processCreated(owner.pid);
  return actual === null || owner.created === null || actual === owner.created;
}
export async function acquireLease(file, name, { resume = false } = {}) {
  let handle;
  try { handle = await open(file, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await read(file);
    if (await ownerAlive(owner)) throw Error('队列已在运行，不能重复启动');
    if (owner.name !== name) throw Error('工作树有其他队列的中断现场，请先恢复原队列');
    if (!resume) throw Error('留下了中断锁，请显式使用 --resume');
    const recoveryFile = file + '.recovery';
    let recovery;
    try { recovery = await open(recoveryFile, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw Error('已有恢复操作，或恢复锁需要人工核对'); throw error; }
    try {
      if (await ownerAlive(await read(file))) throw Error('队列已经恢复运行');
      await unlink(file); handle = await open(file, 'wx');
    } finally { await recovery.close(); await unlink(recoveryFile); }
  }
  const owner = { name, pid: process.pid, created: await processCreated(process.pid), nonce: randomUUID() };
  await handle.writeFile(JSON.stringify(owner)); await handle.close();
  return async () => {
    try { if ((await read(file)).nonce === owner.nonce) await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
