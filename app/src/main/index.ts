import { app, BrowserWindow, ipcMain, nativeTheme, Notification, dialog, shell, clipboard, screen } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { Registry, reportText } from './registry';
import { windowsPlatform } from './platform';
import { readEvents, validCursor } from './events';
import type { Task, Snapshot } from '../shared/types';
import { c } from '../shared/copy';
const home = process.env.CODEX_DISPATCH_HOME || (process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'codex-dispatch') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'codex-dispatch'));
// 隔离任务连同 Electron 缓存一起放在临时 home，避免开发触及用户配置。
if (process.env.CODEX_DISPATCH_HOME)
    app.setPath('userData', path.join(home, 'monitor'));
const data = app.getPath('userData');
if (process.env.DISPATCHDOCK_SHOTS)
    app.disableHardwareAcceleration();
let win: BrowserWindow, registry: Registry, quitting = false;
let prefsWorker: Worker;
let managedWorker: Worker;
function closeManaged() {
    if (!managedWorker || managedWorker.threadId === -1) return Promise.resolve();
    // 等当前认领完成再退出线程，不能在改名与启动执行者之间强制终止。
    return new Promise<void>(resolve => { managedWorker.once('exit', () => resolve()); managedWorker.postMessage('close'); });
}
let notifications = true;
let windowSave: Promise<void> = Promise.resolve();
const reportCache = new Map<string, {
    stamp: string;
    text: string;
}>();
async function cachedReport(file: string) {
    const info = await stat(file).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT')
        throw e; return null; });
    if (!info) {
        reportCache.delete(file);
        return '';
    }
    const stamp = `${info.ino}:${info.mtimeMs}:${info.size}`, cached = reportCache.get(file);
    if (cached?.stamp === stamp)
        return cached.text;
    const text = await reportText(file);
    reportCache.set(file, { stamp, text });
    return text;
}
const platform = windowsPlatform(file => shell.openPath(file));
const snapshot = (select?: string): Snapshot => ({ tasks: registry?.tasks ?? [], theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', version: app.getVersion(), select });
const publish = (select?: string) => { if (win && !win.isDestroyed())
    win.webContents.send('snapshot', snapshot(select)); };
const errors = (e: unknown) => console.error(e instanceof Error ? e.message : String(e));
function finished(t: Task) {
    if (!notifications || !Notification.isSupported())
        return;
    const project = path.basename(t.repo), body = t.status === 'done' ? `${project} · ${c.elapsed} ${t.minutes ?? Math.round(((t.ended ?? Date.now()) - t.started) / 60000)} ${c.minutes}` : t.status === 'fail' ? `${project} · exit=${t.exit}` : project;
    const n = new Notification({ title: `${c.status[t.status]}：${t.title}`, body });
    n.on('click', () => { win.show(); if (win.isMinimized())
        win.restore(); win.focus(); publish(t.id); });
    n.show();
}
app.whenReady().then(async () => {
    await mkdir(data, { recursive: true });
    prefsWorker = new Worker(path.join(__dirname, 'preferences.mjs'), { workerData: { root: __dirname, data } });
    let requestId = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    prefsWorker.on('message', ({ id, value, error }) => { const p = pending.get(id); pending.delete(id); if (error) p?.reject(Error(error)); else p?.resolve(value); });
    prefsWorker.on('error', error => { for (const p of pending.values()) p.reject(error); pending.clear(); });
    const preferences = (action: string, payload?: Record<string, unknown>) => new Promise<any>((resolve, reject) => { const id = ++requestId; pending.set(id, { resolve, reject }); prefsWorker.postMessage({ id, action, payload }); });
    const initial = await preferences('settings');
    notifications = initial.own.notifications;
    nativeTheme.themeSource = initial.own.theme;
    const tokens = await readFile(path.join(__dirname, 'tokens.css'), 'utf8');
    const token = (key: string) => tokens.match(new RegExp(`\\[data-theme="${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}"\\]\\s*\\{([^}]+)`))![1].match(new RegExp(`--${key}:\\s*([^;]+)`))![1].trim();
    let bounds: {
        width: number;
        height: number;
        x?: number;
        y?: number;
    } = { width: 1160, height: 720 };
    try {
        const saved = JSON.parse(await readFile(path.join(data, 'window.json'), 'utf8'));
        if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
            bounds = { width: Math.max(960, saved.width), height: Math.max(600, saved.height) };
            if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some(d => saved.x < d.workArea.x + d.workArea.width && saved.x + saved.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + 44 > d.workArea.y)) {
                bounds.x = saved.x;
                bounds.y = saved.y;
            }
        }
    }
    catch { }
    const shotMode=!!(process.env.DISPATCHDOCK_SHOTS&&process.env.CODEX_DISPATCH_HOME);
    win = new BrowserWindow({ ...bounds, minWidth: 960, minHeight: 600, show: false, icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'app.ico' : 'app-256.png'), title: c.app, autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: token('bg'), symbolColor: token('text-2'), height: 44 }, backgroundColor: token('bg'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen:shotMode, backgroundThrottling:!shotMode } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    registry = new Registry(home, data, platform, () => publish(), finished, errors);
    managedWorker = new Worker(path.join(__dirname, 'managed.mjs'), { workerData: { root: __dirname } });
    await new Promise<void>((resolve, reject) => { managedWorker.once('message', () => resolve()); managedWorker.once('error', reject); });
    managedWorker.on('error', errors);
    await registry.start();
    // IPC 只接受来自本窗口主 frame 的有限操作，路径全部从已读取的任务导出。
    const handle = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(name, (e, ...args) => { if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame)
        throw Error('Invalid sender'); return fn(...args); });
    const task = (id: unknown) => { if (typeof id !== 'string')
        throw Error('Invalid task'); const t = registry.tasks.find(x => x.id === id); if (!t)
        throw Error(c.changed); return t; };
    handle('preferences', async (action, payload) => {
      const operation = async () => {
        if (typeof action !== 'string' || !['settings','detect','save','own','finish','ack','install','choosePath','openConfig'].includes(action)) throw Error('Invalid preference action');
        if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) throw Error('Invalid payload');
        if (action === 'openConfig') { await mkdir(home, { recursive: true }); const error = await shell.openPath(home); if (error) throw Error(error); return; }
        if (action === 'choosePath') {
            const selected = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Codex', extensions: ['exe','cmd','js'] }] });
            if (selected.canceled) return null;
            action = 'save'; payload = { key: 'path', value: selected.filePaths[0] };
        }
        const result = await preferences(action, payload);
        if (result?.own) notifications = result.own.notifications;
        if (action === 'own' && payload?.key === 'theme') nativeTheme.themeSource = result.own.theme;
        return result;
      };
      try { return { ok: true, value: await operation() }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    });
    handle('snapshot', () => snapshot());
    handle('detail', async (id) => ({ report: await cachedReport(task(id).report) }));
    const allowedFiles = new Map<string, Set<string>>();
    handle('events', async (id, cursor, before) => { if (!validCursor(cursor) || before !== undefined && typeof before !== 'boolean')
        throw Error('Invalid cursor'); const t = task(id), page = await readEvents(t, cursor, before); const files = allowedFiles.get(id) ?? new Set<string>(); for (const e of page.events)
        for (const f of e.files ?? [])
            files.add(f.path); allowedFiles.set(id, files); return page; });
    handle('import', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (!result.canceled && result.filePaths[0])
        await registry.import(result.filePaths[0]); });
    handle('action', async (id, action, value) => {
        const t = task(id);
        if (action === 'stop')
            return registry.stop(t.id);
        if (action === 'hide')
            return registry.hide(t.id);
        if (action === 'copy') {
            clipboard.writeText(t.name);
            return;
        }
        if (action === 'link') {
            if (typeof value !== 'string' || !/^https?:\/\//i.test(value))
                throw Error('Invalid link');
            await shell.openExternal(value);
            return;
        }
        let file: string | undefined;
        if (['repo', 'report', 'progress', 'raw', 'events'].includes(action))
            file = t[action as 'repo'];
        if (action === 'spec' && t.spec)
            file = path.resolve(t.repo, t.spec);
        if (action === 'file' && typeof value === 'string' && allowedFiles.get(id)?.has(value))
            file = path.resolve(t.repo, value);
        if (!file || !path.isAbsolute(file))
            throw Error('Invalid path');
        await platform.open(file);
    });
    nativeTheme.on('updated', () => { win.setTitleBarOverlay({ color: token('bg'), symbolColor: token('text-2'), height: 44 }); win.setBackgroundColor(token('bg')); publish(); });
    win.on('close', () => { if(!quitting)windowSave = writeFile(path.join(data, 'window.json'), JSON.stringify(win.getNormalBounds())).catch(errors); });
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (process.env.DISPATCHDOCK_SHOTS && process.env.CODEX_DISPATCH_HOME) {
        if (process.env.DISPATCHDOCK_PACKAGED_VERIFY) {
            const { capturePackaged } = await import('./shots-packaged');
            await capturePackaged(win, process.env.DISPATCHDOCK_SHOTS);
        } else {
            const { capture } = await import('./shots');
            await capture(win, registry, process.env.DISPATCHDOCK_SHOTS);
        }
        app.quit();
    }
    else win.show();
}).catch(async (e) => { errors(e); await registry?.close(); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', e => {
    if(quitting)return;
    e.preventDefault();quitting=true;
    if(win&&!win.isDestroyed())windowSave=writeFile(path.join(data,'window.json'),JSON.stringify(win.getNormalBounds())).catch(errors);
    void Promise.all([registry?.close(),windowSave,prefsWorker?.terminate(),closeManaged()]).finally(()=>app.quit());
});
