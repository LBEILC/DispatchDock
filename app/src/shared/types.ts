export type Status = 'run' | 'done' | 'fail' | 'stop';
export interface Task {
    id: string;
    repo: string;
    name: string;
    title: string;
    spec: string | null;
    role: string | null;
    pid: number;
    started: number;
    progress: string;
    report: string;
    raw?: string;
    events?: string;
    model: string | null;
    effort: string | null;
    tier: string | null;
    sandbox?: string;
    agent?: string;
    agentVersion?: string;
    dispatcher?: {
        host: string;
        session: string | null;
    };
    agentPid?: number;
    managed?: boolean;
    status: Status;
    exit?: number | null;
    ended?: number;
    minutes?: number;
    signal?: string;
    imported?: boolean;
    commit?: string;
    last: string;
}
export interface Event {
    v: 1;
    seq: number;
    at: number;
    kind: 'say' | 'think' | 'cmd' | 'file' | 'plan' | 'tool' | 'turn' | 'error' | 'text';
    text?: string;
    id?: string;
    phase?: 'start' | 'end';
    command?: string;
    exit?: number | null;
    output?: string;
    truncated?: boolean;
    files?: {
        kind: 'add' | 'update' | 'delete';
        path: string;
    }[];
    items?: {
        text: string;
        done: boolean;
    }[];
    name?: string;
    detail?: string;
    usage?: {
        input: number | null;
        output: number | null;
    };
    offset: number;
    time?: string;
}
export interface Cursor {
    source: string;
    start: number;
    end: number;
}
export interface Page {
    events: Event[];
    cursor: Cursor;
    reset: boolean;
}
export interface Snapshot {
    tasks: Task[];
    theme: 'dark' | 'light';
    version: string;
    select?: string;
}
export interface API {
    preferences(action: string, payload?: Record<string, unknown>): Promise<any>;
    snapshot(): Promise<Snapshot>;
    detail(id: string): Promise<{
        report: string;
    }>;
    events(id: string, cursor?: Cursor, before?: boolean): Promise<Page>;
    action(id: string, action: string, value?: string): Promise<void>;
    import(): Promise<void>;
    subscribe(callback: (snapshot: Snapshot) => void): () => void;
}
export interface Settings {
    managed: boolean;
    values: Record<string, string | null>;
    exists: boolean;
    reason: string | null;
    file: string;
    current: Record<string, string | undefined>;
    overrides: Record<string, { name: string; value: string }>;
    own: { notifications: boolean; theme: 'system' | 'light' | 'dark'; wizardDone: boolean };
}
export interface Connections {
    availableVersion: string;
    hosts: { host: string; detected: boolean; root: string; installedAt: number; actions: string[]; skills: { skill: string; version: string | null; state: string; checked: boolean }[] }[];
    codex: { installed: boolean; version: string | null; login: string; path: string | null; change?: { old: string; next: string } };
}
declare global {
    interface Window {
        dock: API;
    }
}
