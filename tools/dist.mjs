import { checkFont } from './fonts.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function distributionOptions(args, host = process.platform) {
  const accepted = new Set(['--mac', '--win', '--arm64', '--x64', '--dir', '--ad-hoc']);
  for (const arg of args) if (!accepted.has(arg)) throw Error(`未知打包参数：${arg}`);
  if (args.includes('--mac') && args.includes('--win')) throw Error('一次只构建一个平台，请分别使用 --mac 或 --win');
  const platform = args.includes('--mac') ? 'mac' : args.includes('--win') ? 'win' : host === 'darwin' ? 'mac' : 'win';
  if (platform === 'mac' && host !== 'darwin') throw Error('macOS 安装包请在 macOS 上构建');
  const architectures = ['arm64', 'x64'].filter(arch => args.includes(`--${arch}`));
  if (!architectures.length) architectures.push(platform === 'mac' ? 'arm64' : 'x64');
  if (platform === 'win' && architectures.includes('arm64')) throw Error('Windows 安装包目前只支持 --x64');
  if (platform !== 'mac' && args.includes('--ad-hoc')) throw Error('--ad-hoc 只用于 macOS 临时签名');
  return { platform, architectures, unpacked: args.includes('--dir'), adHoc: args.includes('--ad-hoc') };
}

async function distribute() {
  const options = distributionOptions(process.argv.slice(2));
  if (options.platform === 'mac') {
    const { packageMac } = await import('./package-macos.mjs');
    return packageMac(options);
  }
  try { await checkFont(); }
  catch { throw Error('MiSans 字体缺失或 SHA-256 不符，请运行 npm run fonts。'); }
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  await import('./build.mjs');
  const { build, Platform, Arch } = await import('electron-builder');
  const platform = options.platform === 'mac' ? Platform.MAC : Platform.WINDOWS;
  const formats = options.unpacked ? ['dir'] : options.platform === 'mac' ? ['dmg', 'zip'] : ['nsis'];
  const config = 'electron-builder.config.cjs';
  // 构建命令只生成本地产物，发布由维护者另行决定。
  await build({ targets: platform.createTarget(formats, ...options.architectures.map(arch => Arch[arch])), config, publish: 'never' });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  distribute().catch(error => { console.error(error.message); process.exit(1); });
}
