module.exports = {
  appId: 'io.github.lbeilc.dispatchdock',
  productName: 'DispatchDock',
  directories: { app: 'app/dist', output: 'release', buildResources: 'build' },
  // 派发脚本需要由独立 Node 进程读取，保留普通文件目录。
  asar: false,
  npmRebuild: false,
  files: [
    'main.cjs', 'preload.cjs', 'renderer.js', '*.html', '*.css',
    'preferences.mjs', 'managed.mjs', 'package.json',
    'skills/**/*', 'installer/**/*', 'fonts/**/*', 'icons/**/*',
    'LICENSE', 'THIRD_PARTY_NOTICES.md',
    '!node_modules/**/*',
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icons/app.ico', signtoolOptions: { sign: async () => {} } },
  nsis: {
    oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true, packElevateHelper: false,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    artifactName: 'DispatchDock-Setup-${version}-${arch}.${ext}',
  },
};
