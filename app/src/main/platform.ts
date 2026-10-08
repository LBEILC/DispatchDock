import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export interface ProcessInfo {
    pid: number;
    name: string;
    command: string;
    created: number;
}
export interface Platform {
    processes(pids: number[]): Promise<ProcessInfo[]>;
    killTree(pid: number): Promise<void>;
    open(file: string): Promise<void>;
}
const run = promisify(execFile);
export function dispatchMatches(p: ProcessInfo | undefined, started: number) { return !!p && p.name.toLowerCase() === 'node.exe' && /(?:^|[\\/\s"])codex-task\.mjs(?:["\s]|$)/i.test(p.command) && p.created <= started && started - p.created < 60000; }
export function windowsPlatform(openFile: (file: string) => Promise<string>): Platform {
    return {
        async processes(pids) {
            if (!pids.length)
                return [];
            if (pids.some(p => !Number.isSafeInteger(p) || p <= 0))
                throw Error('Invalid PID');
            const filter = pids.map(p => `ProcessId = ${p}`).join(' OR ');
            const script = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { @{pid=$_.ProcessId;name=$_.Name;command=$_.CommandLine;created=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()} }) | ConvertTo-Json -Compress`;
            const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
            const value = JSON.parse(stdout.trim() || '[]');
            return (Array.isArray(value) ? value : [value]).map(p => ({ ...p, command: p.command ?? '' }));
        },
        async killTree(pid) { if (!Number.isSafeInteger(pid) || pid <= 0)
            throw Error('Invalid PID'); await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }); },
        async open(file) { const error = await openFile(file); if (error)
            throw Error(error); },
    };
}
