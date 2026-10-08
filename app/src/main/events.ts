import { open } from 'node:fs/promises';
import type { Task, Event, Cursor, Page } from '../shared/types';
export const PAGE_BYTES = 2 * 1024 * 1024;
export function parseEvent(line: string, offset: number, legacy = false): Event | null {
    const base: Event = { v: 1, seq: offset, at: 0, offset, kind: 'text' };
    if (legacy) {
        if (!line.trim() || line.startsWith('==='))
            return null;
        const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (match) {
            base.time = match[1];
            line = match[2];
        }
        base.text = line;
        for (const [prefix, kind] of Object.entries({ '说：': 'say', '思考：': 'think', '出错：': 'error', '错误：': 'error', '搜索：': 'tool', '工具：': 'tool' }))
            if (line.startsWith(prefix))
                return { ...base, kind: kind as Event['kind'], text: line.slice(prefix.length) };
        // 旧文本没有成功结束事件，不能把历史命令永远显示成运行中。
        if (line.startsWith('运行：'))
            return { ...base, kind: 'cmd', id: `legacy:${offset}`, command: line.slice(3) };
        const fail = line.match(/^\s*命令失败（exit (-?\d+)）：(.*)$/);
        if (fail)
            return { ...base, kind: 'cmd', phase: 'end', command: fail[2], exit: +fail[1] };
        const file = line.match(/^(新增|修改|删除)文件：(.*)$/);
        if (file)
            return { ...base, kind: 'file', files: [{ kind: ({ '新增': 'add', '修改': 'update', '删除': 'delete' } as const)[file[1] as '新增'], path: file[2] }] };
        if (line.startsWith('计划：'))
            return { ...base, kind: 'plan', items: [...line.matchAll(/\[([x ])\]\s*(.*?)(?=\s*\[[x ]\]|$)/g)].map(m => ({ text: m[2], done: m[1] === 'x' })) };
        if (line.startsWith('一轮结束'))
            base.kind = 'turn';
        return base;
    }
    try {
        const e = JSON.parse(line);
        if (e.v !== 1 || !Number.isSafeInteger(e.seq) || !Number.isFinite(e.at) || !Number.isFinite(new Date(e.at).getTime()) || !['say', 'think', 'cmd', 'file', 'plan', 'tool', 'turn', 'error', 'text'].includes(e.kind))
            return null;
        const out: Event = { ...base, seq: e.seq, at: e.at, kind: e.kind };
        for (const key of ['text', 'id', 'command', 'output', 'name', 'detail'] as const)
            if (typeof e[key] === 'string')
                out[key] = e[key];
        if (e.phase === 'start' || e.phase === 'end')
            out.phase = e.phase;
        if (e.exit === null || Number.isInteger(e.exit))
            out.exit = e.exit;
        out.truncated = e.truncated === true;
        if (Array.isArray(e.files))
            out.files = e.files.filter((f: any) => f && ['add', 'update', 'delete'].includes(f.kind) && typeof f.path === 'string').map((f: any) => ({ kind: f.kind, path: f.path }));
        if (Array.isArray(e.items))
            out.items = e.items.filter((p: any) => p && typeof p.text === 'string' && typeof p.done === 'boolean').map((p: any) => ({ text: p.text, done: p.done }));
        if (e.usage)
            out.usage = { input: Number.isFinite(e.usage.input) ? e.usage.input : null, output: Number.isFinite(e.usage.output) ? e.usage.output : null };
        return out;
    }
    catch {
        return null;
    }
}
export function validCursor(c: unknown): c is Cursor | undefined {
    if (c === undefined)
        return true;
    const x = c as Cursor;
    return !!x && typeof x.source === 'string' && x.source.length < 4096 && Number.isSafeInteger(x.start) && Number.isSafeInteger(x.end) && x.start >= 0 && x.end >= x.start;
}
export async function readEvents(task: Task, cursor?: Cursor, before = false): Promise<Page> {
    let legacy = false;
    const missing = (e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT')
        throw e; return null; };
    let h = task.events ? await open(task.events, 'r').catch(missing) : null;
    if (!h) {
        legacy = true;
        h = await open(task.progress, 'r').catch(missing);
    }
    if (!h)
        return { events: [], cursor: { source: '', start: 0, end: 0 }, reset: !cursor || cursor.source !== '' };
    try {
        const s = await h.stat(), source = `${legacy ? 'progress' : 'events'}:${s.ino}:${s.birthtimeMs}`;
        const reset = !cursor || cursor.source !== source || cursor.end > s.size;
        const back = before && !reset, end = back ? cursor!.start : s.size;
        let start = reset || back ? Math.max(0, end - PAGE_BYTES) : cursor!.end;
        const size = Math.min(PAGE_BYTES, end - start), b = Buffer.alloc(size);
        await h.read(b, 0, size, start);
        let from = 0;
        if (start > 0 && (reset || back)) {
            const prev = Buffer.alloc(1);
            await h.read(prev, 0, 1, start - 1);
            if (prev[0] !== 10)
                from = b.indexOf(10) + 1 || b.length;
        }
        const finish = b.lastIndexOf(10) + 1;
        const events: Event[] = [];
        for (let at = from; at < finish;) {
            const next = b.indexOf(10, at), e = parseEvent(b.subarray(at, next).toString('utf8').replace(/\r$/, ''), start + at, legacy);
            if (e)
                events.push(e);
            at = next + 1;
        }
        // 超长的未完单行暂不消费，完成后由独立分页边界处理；普通尾部半行下次重读。
        return { events, reset, cursor: { source, start: reset || back ? start + from : cursor!.start, end: back ? cursor!.end : start + Math.max(from, finish) } };
    }
    finally {
        await h.close();
    }
}
