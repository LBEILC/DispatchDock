import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkFont } from './fonts.mjs';
import { distributionOptions } from './dist.mjs';

export function signingError(error, env = process.env) {
  let message = String(error?.message || error);
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_APP_SPECIFIC_PASSWORD']) {
    if (env[key]) message = message.split(env[key]).join('[已隐藏]');
  }
  // security 的错误会回显命令参数，包括临时钥匙串密码。
  return message.replace(/(-[pPk]\s+)(?:"[^"]*"|'[^']*'|\S+)/g, '$1[已隐藏]');
}

const credentials = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID'];
export async function withSigningEnvironment(source, adHoc, action) {
  const env = { ...source };
  const signed = !adHoc && Boolean(env.CSC_LINK?.trim());
  let temporary;
  try {
    if (signed) {
      for (const key of ['CSC_KEY_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID']) {
        if (!env[key]?.trim()) throw Error(`已配置签名但缺少 ${key}`);
      }
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
      temporary = await fs.mkdtemp(path.join(env.RUNNER_TEMP || os.tmpdir(), 'dispatchdock-notarize-'));
      env.APPLE_API_KEY = path.join(temporary, 'AuthKey.p8');
      await fs.writeFile(env.APPLE_API_KEY, env.APPLE_API_KEY_P8, { mode: 0o600 });
    } else {
      for (const key of credentials) delete env[key];
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    }
    delete env.APPLE_API_KEY_P8;
    delete env.APPLE_ID;
    delete env.APPLE_APP_SPECIFIC_PASSWORD;
    return await action(env, signed);
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
export async function packageMac(options, source = process.env) {
  if (process.platform !== 'darwin') throw Error('macOS 安装包请在 macOS 上构建');
  try { await checkFont(); }
  catch { throw Error('MiSans 字体缺失或 SHA-256 不符，请运行 npm run fonts。'); }
  await withSigningEnvironment(source, options.adHoc, async (env, signed) => {
    // electron-builder 和 afterSign 在当前进程读取环境，结束时还原。
    const previous = { ...process.env };
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    try {
      await import('./build.mjs');
      const { build, Platform, Arch } = await import('electron-builder');
      await build({
        targets: Platform.MAC.createTarget(options.unpacked ? ['dir'] : ['dmg', 'zip'], ...options.architectures.map(arch => Arch[arch])),
        config: {
          extends: './electron-builder.config.cjs',
          forceCodeSigning: signed,
          afterSign: 'tools/notarize-macos.mjs',
          mac: { ...(signed ? {} : { identity: '-' }), hardenedRuntime: signed, notarize: false },
        },
        publish: 'never',
      });
    } catch (error) {
      throw Error(signingError(error, env));
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await packageMac(distributionOptions(['--mac', ...process.argv.slice(2)])); }
  catch (error) { console.error(signingError(error)); process.exit(1); }
}
