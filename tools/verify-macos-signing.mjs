import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { runStapler } from './macos-stapler.mjs';

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const output = (result.stdout || '') + (result.stderr || '');
  console.log(output.trim());
  if (result.error || result.status !== 0)
    throw Error(`${command} failed: ${output}`, { cause: result.error });
  return output;
};
async function verify(app) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (!process.env.CSC_LINK?.trim()) {
    console.log('未签名，跳过公证检查');
    return;
  }
  const signature = run('codesign', ['-dv', '--verbose=4', app]);
  if (
    !signature.includes('Authority=Developer ID Application:') ||
    !process.env.APPLE_TEAM_ID ||
    !signature.includes(`TeamIdentifier=${process.env.APPLE_TEAM_ID}`)
  )
    throw Error('Unexpected signing identity');
  const assessment = run('spctl', ['-a', '-vvv', '-t', 'exec', app]);
  if (!assessment.includes('source=Notarized Developer ID'))
    throw Error('Missing notarized Developer ID assessment');
  await runStapler('validate', app);
  console.log(`Verified signed and stapled app: ${app}`);
}
const root = path.resolve('release');
const entries = await fs.readdir(root);
const appDirs = entries.filter((name) => name === 'mac' || name.startsWith('mac-'));
if (appDirs.length !== 1) throw Error('Expected one macOS package directory');
const bundleName = 'DispatchDock.app';
await verify(path.join(root, appDirs[0], bundleName));
const zips = entries.filter((name) => name.endsWith('.zip'));
if (zips.length !== 1) throw Error('Expected one update ZIP');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatchdock-signed-zip-'));
try {
  run('ditto', ['-x', '-k', path.join(root, zips[0]), temporary]);
  await verify(path.join(temporary, bundleName));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
