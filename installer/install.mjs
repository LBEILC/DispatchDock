import { createInterface } from 'node:readline/promises';
import { runInstaller } from './cli.mjs';

let terminal;
try {
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  await runInstaller(process.argv.slice(2), { interactive, ask: prompt => {
    terminal ??= createInterface({ input: process.stdin, output: process.stdout });
    return terminal.question(prompt);
  } });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { terminal?.close(); }
