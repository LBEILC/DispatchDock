import type { Task } from '../shared/types';

export type TaskFilter = 'all' | 'run' | 'issues';
const searchable = (value: string) => value.normalize('NFC').toLowerCase().replaceAll('\\', '/');

export function selectTasks(tasks: Task[], repo: string, filter: TaskFilter, query: string) {
    const words = searchable(query).trim().split(/\s+/).filter(Boolean);
    const counts = { all: 0, run: 0, issues: 0 };
    const visible: Task[] = [];
    for (const task of tasks) {
        if (repo && task.repo !== repo) continue;
        if (words.length) {
            const fields = [task.title, task.name, task.repo].map(searchable);
            if (!words.every(word => fields.some(field => field.includes(word)))) continue;
        }
        counts.all++;
        if (task.status === 'run') counts.run++;
        if (task.status === 'fail' || task.status === 'stop') counts.issues++;
        if (filter === 'all' || (filter === 'run' ? task.status === 'run' : task.status === 'fail' || task.status === 'stop')) visible.push(task);
    }
    return { tasks: visible, counts };
}

export interface ListEntry {
    key: string;
    tag: 'button' | 'div';
    signature: string;
    render(node: HTMLElement): void;
}

// 后台进展通常只改变一行；复用按钮，避免重建全部历史任务并丢失键盘焦点。
export class TaskListView {
    private entries = new Map<string, { node: HTMLElement; signature: string }>();
    constructor(private box: HTMLElement) { }

    update(rows: ListEntry[]) {
        const scroll = this.box.scrollTop;
        const focused = this.box.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
        const keys = new Set(rows.map(row => row.key));
        for (const [key, entry] of this.entries) if (!keys.has(key)) {
            entry.node.remove();
            this.entries.delete(key);
        }
        let cursor = this.box.firstChild;
        for (const row of rows) {
            let entry = this.entries.get(row.key);
            if (!entry) {
                entry = { node: document.createElement(row.tag), signature: row.signature };
                row.render(entry.node);
                this.entries.set(row.key, entry);
            } else if (entry.signature !== row.signature) {
                row.render(entry.node);
                entry.signature = row.signature;
            }
            if (entry.node !== cursor) this.box.insertBefore(entry.node, cursor);
            cursor = entry.node.nextSibling;
        }
        if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
        this.box.scrollTop = scroll;
    }
}
