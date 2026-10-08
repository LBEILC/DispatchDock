import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const sizes = [16,20,24,32,40,48,64,128,256];
export function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const at = 6 + index * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12); offset += png.length;
  });
  return Buffer.concat([header, ...images.map(i => i.png)]);
}
export async function generateIcons() {
  const { app, BrowserWindow } = await import('electron');
  app.disableHardwareAcceleration();
  // 图标光栅化使用独立缓存，不使用日常应用目录。
  app.setPath('userData', path.resolve('build/icons/electron-cache'));
  await app.whenReady();
  const win = new BrowserWindow({ show: false, transparent: true, frame: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    const svg = await readFile('app/design/icons/app.svg', 'utf8'), images = [];
    await mkdir('build/icons', { recursive: true });
    await win.loadURL('data:text/html,<html><body></body></html>');
    for (const size of sizes) {
      const source = size <= 20 ? svg.replace('stroke-width="2.2"', 'stroke-width="2.6"') : svg;
      const url = 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64');
      const encoded = await win.webContents.executeJavaScript(`(async()=>{const img=new Image();img.src=${JSON.stringify(url)};await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=${size};canvas.getContext('2d').drawImage(img,0,0,${size},${size});return canvas.toDataURL('image/png').split(',')[1];})()`);
      const png = Buffer.from(encoded,'base64'); images.push({size,png});
      await writeFile(`build/icons/app-${size}.png`,png);
    }
    await writeFile('build/icons/app.ico',ico(images));
  } finally { win.destroy(); app.quit(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateIcons().catch(error => { console.error(error); process.exit(1); });
