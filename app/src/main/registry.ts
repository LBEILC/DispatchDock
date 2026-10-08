import { watch, type FSWatcher } from 'node:fs';
import { open, readFile, writeFile, appendFile, mkdir, rename, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Task } from '../shared/types';
import { commitFrom } from '../shared/markdown';
import { c } from '../shared/copy';
import { dispatchMatches, type Platform, type ProcessInfo } from './platform';
export function mergeLine(tasks: Map<string, Task>, line: string) {
    try {
        const e = JSON.parse(line);
        if (e.v !== 1 || typeof e.id !== 'string')
            return;
        if (e.event === 'start') {
            if (!['repo', 'name', 'progress', 'report'].every(k => typeof e[k] === 'string') || !Number.isFinite(e.started) || !Number.isFinite(new Date(e.started).getTime()) || !path.isAbsolute(e.repo) || !path.isAbsolute(e.progress) || !path.isAbsolute(e.report))
                return;
            const t: Task = { id: e.id, repo: e.repo, name: e.name, title: typeof e.title === 'string' ? e.title : e.name, spec: typeof e.spec === 'string' ? e.spec : null, role: typeof e.role === 'string' ? e.role : null, pid: Number.isSafeInteger(e.pid) && e.pid > 0 ? e.pid : 0, started: e.started, progress: e.progress, report: e.report, model: typeof e.model === 'string' ? e.model : null, effort: typeof e.effort === 'string' ? e.effort : null, tier: typeof e.tier === 'string' ? e.tier : null, status: 'run', last: '' };
            for (const key of ['raw', 'events', 'sandbox', 'agent', 'agentVersion'] as const)
                if (typeof e[key] === 'string')
                    t[key] = e[key];
            if (e.dispatcher && typeof e.dispatcher.host === 'string')
                t.dispatcher = { host: e.dispatcher.host, session: typeof e.dispatcher.session === 'string' ? e.dispatcher.session : null };
            t.managed = e.managed === true;
            tasks.set(t.id, t);
        }
        else {
            const t = tasks.get(e.id);
            if (!t)
                return;
            if (e.event === 'spawned')
                t.agentPid = e.agentPid ?? e.codexPid;
            if (e.event === 'end') {
                t.exit = Number.isInteger(e.exit) ? e.exit : null;
                t.ended = Number.isFinite(e.at) ? e.at : undefined;
                t.minutes = Number.isFinite(e.minutes) && e.minutes >= 0 ? e.minutes : undefined;
                t.status = t.exit === 0 ? 'done' : 'fail';
            }
            if (e.event === 'interrupted' && t.exit === undefined) {
                t.ended = Number.isFinite(e.at) ? e.at : undefined;
                t.signal = typeof e.signal==='string' ? e.signal : undefined;
                t.status = 'stop';
            }
        }
    }
    catch { /* 单行损坏不影响后续记录。 */ }
}
export function parseRegistry(text: string) { const tasks = new Map<string, Task>(); for (const line of text.slice(0, text.lastIndexOf('\n') + 1).split('\n'))
    mergeLine(tasks, line); return [...tasks.values()]; }
export function statusOf(t: Task, ps: ProcessInfo[]): Task['status'] { return t.exit !== undefined ? (t.exit === 0 ? 'done' : 'fail') : t.status === 'stop' ? 'stop' : dispatchMatches(ps.find(p => p.pid === t.pid), t.started) ? 'run' : 'stop'; }
export class RegistryReader {
    rows = new Map<string, Task>();
    private offset = 0;
    private identity = '';
    async read(file: string) {
        const h = await open(file, 'r').catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT')
            throw e; return null; });
        if (!h) {
            this.rows.clear();
            this.offset = 0;
            return [];
        }
        try {
            const s = await h.stat(), identity = `${s.ino}:${s.birthtimeMs}`;
            if (identity !== this.identity || s.size < this.offset) {
                this.rows.clear();
                this.offset = 0;
                this.identity = identity;
            }
            // 每次只保留尾部未完成的偏移，不缓存已读清单文本。
            while (this.offset < s.size) {
                const b = Buffer.alloc(Math.min(2 * 1024 * 1024, s.size - this.offset));
                await h.read(b, 0, b.length, this.offset);
                const end = b.lastIndexOf(10) + 1;
                if (!end)
                    break;
                for (const line of b.subarray(0, end).toString('utf8').split('\n'))
                    mergeLine(this.rows, line);
                this.offset += end;
            }
            return [...this.rows.values()].map(t => ({ ...t }));
        }
        finally {
            await h.close();
        }
    }
}
export async function tail(file: string, first = false) { try {
    const h = await open(file, 'r');
    try {
        const size = (await h.stat()).size, start = first ? 0 : Math.max(0, size - 65536), b = Buffer.alloc(Math.min(size, 65536));
        await h.read(b, 0, b.length, start);
        const text = b.toString('utf8');
        return start ? text.slice(text.indexOf('\n') + 1) : text;
    }
    finally {
        await h.close();
    }
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return '';
    throw e;
} }
export async function reportText(file: string) { try {
    return await readFile(file, 'utf8');
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return '';
    throw e;
} }
export async function importTasks(folder: string): Promise<Task[]> {
    const repo = path.basename(folder) === '.codex-runs' ? path.dirname(folder) : folder, dir = path.join(repo, '.codex-runs');
    const tasks: Task[] = [];
    for (const file of await readdir(dir)) {
        if (!file.endsWith('.progress.log'))
            continue;
        const progress = path.join(dir, file), head = (await tail(progress, true)).split('\n')[0], m = head.match(/^=== Codex 开始：(.*?)\s{2}(\d{4})\/(\d+)\/(\d+)\s+(?:(上午|下午))?(\d+):(\d+):(\d+) ===\r?$/);
        if (!m)
            continue;
        let hour = +m[6];
        if (m[5] === '下午' && hour < 12)
            hour += 12;
        if (m[5] === '上午' && hour === 12)
            hour = 0;
        const started = new Date(+m[2], +m[3] - 1, +m[4], hour, +m[7], +m[8]).getTime(), name = file.slice(0, -13), end = (await tail(progress)).trimEnd().match(/=== Codex 结束：exit=(null|-?\d+)，用时 ([\d.]+) 分钟[^\n]*===$/);
        const exit = end ? (end[1] === 'null' ? null : +end[1]) : undefined, minutes = end ? +end[2] : undefined;
        tasks.push({ id: 'import-' + createHash('sha256').update(`${repo}\0${name}\0${started}`).digest('hex').slice(0, 24), repo, name, title: m[1].replace(/（角色：.*）$/, ''), role: m[1].match(/（角色：(.*)）$/)?.[1] ?? null, spec: null, pid: 0, started, progress, report: path.join(dir, name + '.md'), model: null, effort: null, tier: null, last: '', status: end ? (exit === 0 ? 'done' : 'fail') : 'stop', exit, minutes, ended: end ? started + minutes! * 60000 : (await stat(progress)).mtimeMs, imported: true });
    }
    return tasks;
}
export class Registry {
    tasks: Task[] = [];
    private reader = new RegistryReader();
    private imports: Task[] = [];
    private hidden = new Set<string>();
    private watchers: FSWatcher[] = [];
    private signature = '';
    private timer?: ReturnType<typeof setTimeout>;
    private fallback?: ReturnType<typeof setInterval>;
    private work?: Promise<void>;
    private ready = false;
    private closed = false;
    private mutations: Promise<unknown> = Promise.resolve();
    constructor(readonly home: string, readonly data: string, readonly platform: Platform, private changed: (tasks: Task[]) => void, private finished: (t: Task) => void, private error: (e: unknown) => void) { }
    get file() { return path.join(this.home, 'runs.jsonl'); }
    private key(t: Task) { return `${t.id}:${t.started}`; }
    async start() {
        await mkdir(this.home, { recursive: true });
        await mkdir(this.data, { recursive: true });
        const saved = await reportText(path.join(this.data, 'tasks.json'));
        if (saved) {
            const v = JSON.parse(saved);
            this.imports = Array.isArray(v.imports) ? v.imports.flatMap((value:Task)=>{
                if(!value?.imported||!['done','fail','stop'].includes(value.status))return [];
                const task=parseRegistry(JSON.stringify({...value,v:1,event:'start',pid:0})+'\n')[0];
                if(!task)return [];
                task.imported=true;task.status=value.status;
                task.exit=value.status==='done'?0:value.status==='fail'?(Number.isInteger(value.exit)?value.exit:null):undefined;
                task.ended=Number.isFinite(value.ended)?value.ended:undefined;
                task.minutes=Number.isFinite(value.minutes)&&value.minutes!>=0?value.minutes:undefined;
                return [task];
            }) : [];
            this.hidden = new Set(Array.isArray(v.hidden)?v.hidden.filter((key:unknown)=>typeof key==='string'):[]);
        }
        await this.refresh();
        this.ready = true;
        await this.viewer();
        this.fallback = setInterval(() => void this.refresh().catch(this.error), 2000);
    }
    refresh() { if (this.work)
        return this.work; this.work = this.refreshOnce().finally(() => { this.work = undefined; }); return this.work; }
    private async refreshOnce() {
        if (this.closed)
            return;
        const rows = await this.reader.read(this.file), ps = await this.platform.processes(rows.filter(t => t.status === 'run' && t.pid).map(t => t.pid));
        for (const t of rows) {
            t.status = statusOf(t, ps);
            if (t.status === 'stop' && !t.ended)
                t.ended = this.tasks.find(x => x.id === t.id)?.ended ?? Date.now();
        }
        const identities = new Set(rows.map(t => `${t.repo.toLowerCase()}:${t.name}:${Math.floor(t.started / 1000)}`));
        const next = [...rows, ...this.imports.filter(t => !identities.has(`${t.repo.toLowerCase()}:${t.name}:${Math.floor(t.started / 1000)}`))].filter(t => t.status === 'run' || !this.hidden.has(this.key(t))).sort((a, b) => b.started - a.started);
        for (const t of next) {
            t.last = (await tail(t.progress)).trimEnd().split('\n').at(-1)?.replace(/^\[.*?\]\s*/, '') ?? '';
            t.commit = commitFrom(await reportText(t.report));
        }
        if (this.ready)
            for (const t of next)
                if (t.status !== 'run' && this.tasks.find(x => x.id === t.id)?.status === 'run')
                    this.finished(t);
        if (this.closed)
            return;
        const different = JSON.stringify(this.tasks) !== JSON.stringify(next);
        this.tasks = next;
        if (different)
            this.changed(next);
        const dirs = [...new Set([this.home, ...next.map(t => path.dirname(t.progress))])].sort(), signature = dirs.join('\0');
        if (signature !== this.signature) {
            this.watchers.forEach(w => w.close());
            this.watchers = [];
            this.signature = signature;
            for (const dir of dirs)
                try {
                    const w = watch(dir, () => { clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh().then(() => this.changed(this.tasks)).catch(this.error), 200); });
                    w.on('error', e => { this.signature = ''; this.error(e); });
                    this.watchers.push(w);
                }
                catch {
                    this.signature = '';
                }
        }
    }
    async viewer() { await writeFile(path.join(this.home, 'viewer.json'), JSON.stringify({ app: 'DispatchDock', pid: process.pid, suppressWatchWindow: true, acceptsManaged: true, updated: Date.now() })); }
    private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.mutations.then(fn); this.mutations = p.catch(() => { }); return p; }
    private async save() { const file = path.join(this.data, 'tasks.json'); await writeFile(file + '.tmp', JSON.stringify({ imports: this.imports, hidden: [...this.hidden] })); await rename(file + '.tmp', file); }
    import(folder: string) { return this.serial(async () => { const incoming = await importTasks(folder); this.imports = [...new Map([...this.imports, ...incoming].map(t => [t.id, t])).values()]; await this.save(); await this.refresh(); }); }
    hide(id: string) { return this.serial(async () => { await this.refresh(); const t = this.tasks.find(t => t.id === id); if (!t || t.status === 'run')
        throw Error(c.changed); const ps = t.pid ? await this.platform.processes([t.pid]) : []; if (dispatchMatches(ps[0], t.started))
        throw Error(c.changed); this.hidden.add(this.key(t)); await this.save(); await this.refresh(); }); }
    stop(id: string) {
        return this.serial(async () => {
            await this.refresh();
            const t = this.tasks.find(t => t.id === id);
            if (!t || t.imported || t.status !== 'run' || !t.pid)
                throw Error(c.changed);
            const ps = await this.platform.processes([t.pid]);
            if (!dispatchMatches(ps.find(p => p.pid === t.pid), t.started))
                throw Error(c.changed);
            await this.platform.killTree(t.pid);
            const after = await this.platform.processes([t.pid]);
            if (after.some(p => ps.some(old => old.pid === p.pid && old.created === p.created)))
                throw Error(c.changed);
            await appendFile(this.file, '\n' + JSON.stringify({ v: 1, event: 'interrupted', id, signal: 'stopped-by-app', at: Date.now() }) + '\n');
            await this.refresh();
        });
    }
    async close() { this.closed = true; clearTimeout(this.timer); clearInterval(this.fallback); this.watchers.forEach(w => w.close()); await this.work?.catch(() => { }); await this.mutations; const file = path.join(this.home, 'viewer.json'); try {
        if (JSON.parse(await readFile(file, 'utf8')).pid === process.pid)
            await unlink(file);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            this.error(e);
    } }
}
