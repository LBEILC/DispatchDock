import { spawn } from 'node:child_process';
import { unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { demo } from './demo/index.mjs';
import { preferenceFixture } from './demo/preferences.mjs';
import { fontHash } from './fonts.mjs';

const fixture = await demo();
try {
  const out = path.resolve('app/dist/shots');
  for (const filename of ['packaged.json', 'packaged.png']) await unlink(path.join(out, filename)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const env = { ...await preferenceFixture(fixture.home, { install: false }), DISPATCHDOCK_SHOTS: out, DISPATCHDOCK_PACKAGED_VERIFY: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.resolve('release/win-unpacked/DispatchDock.exe'), [], { env, stdio: 'inherit', shell: false, windowsHide: true });
  const timer = setTimeout(() => child.kill(), 90000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, '打包程序验收成功退出');
    const evidence = JSON.parse(await readFile(path.join(out, 'packaged.json'), 'utf8'));
    assert.equal(evidence.fontHash, fontHash);
    console.log('打包程序实测通过：10 个演示任务、首次引导安装、连接页重装、实际 MiSans 绘制。');
  } finally { clearTimeout(timer); }
} finally { await fixture.close(); }
