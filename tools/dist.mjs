import { checkFont } from './fonts.mjs';

try { await checkFont(); }
catch { console.error('MiSans 字体缺失或 SHA-256 不符，请运行 npm run fonts。'); process.exit(1); }
// 禁止自动发现本机证书，发行包明确不签名。
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
await import('./build.mjs');
const { build, Platform, Arch } = await import('electron-builder');
await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), config: 'electron-builder.config.cjs' });
