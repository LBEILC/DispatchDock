import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const tag = process.env.RELEASE_TAG;
if (!tag) throw Error('缺少 RELEASE_TAG');
const files = (await fs.readdir('release')).filter(name => /^DispatchDock-.*-mac-arm64\.(dmg|zip)$/.test(name));
if (files.length !== 2 || !files.some(name => name.endsWith('.dmg')) || !files.some(name => name.endsWith('.zip'))) throw Error('需要一个 DMG 和一个 ZIP');
execFileSync('gh', ['release', 'upload', tag, ...files.map(name => path.join('release', name)), '--clobber'], { stdio: 'inherit' });
if (!JSON.parse(await fs.readFile('release/signing.json', 'utf8')).signed) {
  const warning = 'macOS 包本次未签名：第一次打开会被拦下，到"系统设置 → 隐私与安全性"底部点"仍要打开"。';
  const body = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--json', 'body'], { encoding: 'utf8' })).body || '';
  if (!body.includes(warning)) {
    const notes = path.resolve('release/notes.txt');
    await fs.writeFile(notes, body.trimEnd() + '\n\n' + warning + '\n');
    execFileSync('gh', ['release', 'edit', tag, '--notes-file', notes], { stdio: 'inherit' });
  }
}
