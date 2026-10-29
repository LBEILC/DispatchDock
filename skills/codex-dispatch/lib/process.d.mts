export interface ListedProcess {
    pid: number;
    parent: number;
    created: number;
    command: string;
}

export function processList(pid?: number, platform?: NodeJS.Platform, timeout?: number): Promise<ListedProcess[]>;
export function killProcessTree(pid: number, options?: {
    platform?: NodeJS.Platform;
    timeout?: number;
    expectedCreated?: number;
}): Promise<void>;
