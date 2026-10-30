import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCommand, runStapler } from './macos-stapler.mjs';

export async function notarizeApp(app, env, { run = runCommand, staple = runStapler } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatchdock-notary-submit-'));
  try {
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const archive = path.join(temporary, 'application.zip');
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
    // 公证只提交一次，票据重试不重新提交。
    const result = JSON.parse(
      run('xcrun', [
        'notarytool',
        'submit',
        archive,
        '--key',
        env.APPLE_API_KEY,
        '--key-id',
        env.APPLE_API_KEY_ID,
        '--issuer',
        env.APPLE_API_ISSUER,
        '--wait',
        '--output-format',
        'json',
      ]),
    );
    if (result.status !== 'Accepted')
      throw new Error(`Notarization rejected: ${JSON.stringify(result)}`);
    await staple('staple', app);
    await staple('validate', app);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin' || !process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await notarizeApp(app, process.env);
}
