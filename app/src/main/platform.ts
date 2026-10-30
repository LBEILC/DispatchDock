import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { posix } from 'node:path';
import { processList, killProcessTree } from '../../../skills/codex-dispatch/lib/process.mjs';
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
export function dispatchMatches(p: ProcessInfo | undefined, started: number) { return !!p && ['node', 'node.exe'].includes(p.name.toLowerCase()) && /(?:^|[\\/\s"])codex-task\.mjs(?:["\s]|$)/i.test(p.command) && p.created <= started && started - p.created < 60000; }
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

export function macosPlatform(openFile: (file: string) => Promise<string>): Platform {
    const identities = new Map<number, ProcessInfo>();
    return {
        async processes(pids) {
            if (!pids.length) return [];
            if (pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw Error('Invalid PID');
            const requested = [...new Set(pids)];
            for (const pid of requested) identities.delete(pid);
            const snapshot = await processList(undefined, 'darwin');
            // args 中带空格的可执行路径没有可靠的引号，单独读取 comm 核对 Node 身份。
            let stdout: string;
            try {
                ({ stdout } = await run('/bin/ps', ['-p', requested.join(','), '-o', 'pid=,comm='], { timeout: 5000, maxBuffer: 1024 * 1024 }));
            } catch (error) {
                const failure = error as { code?: unknown; stdout?: string };
                // macOS 在所有目标进程均已退出时返回 1，并且没有进程行。
                if (failure.code === 1 && !failure.stdout?.trim()) return [];
                throw error;
            }
            const names = new Map(stdout.split('\n').flatMap(line => {
                const match = line.trim().match(/^(\d+)\s+(.+)$/);
                return match ? [[+match[1], posix.basename(match[2])] as const] : [];
            }));
            const result = snapshot.flatMap(p => {
                const name = names.get(p.pid);
                return name && requested.includes(p.pid) && Number.isFinite(p.created) ? [{ pid: p.pid, name, command: p.command, created: p.created }] : [];
            });
            for (const p of result) identities.set(p.pid, p);
            return result;
        },
        async killTree(pid) {
            const known = identities.get(pid);
            if (!known || !dispatchMatches(known, known.created)) throw Error('Invalid process identity');
            // 再次核对创建时间后才发送信号，避免进程退出后 PID 被其他进程复用。
            await killProcessTree(pid, { platform: 'darwin', expectedCreated: known.created });
            identities.delete(pid);
        },
        async open(file) { const error = await openFile(file); if (error) throw Error(error); },
    };
}

export function createPlatform(openFile: (file: string) => Promise<string>, platform = process.platform): Platform {
    if (platform === 'win32') return windowsPlatform(openFile);
    if (platform === 'darwin') return macosPlatform(openFile);
    throw Error(`Unsupported platform: ${platform}`);
}
