import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({entryPoints:['tests/monitor.ts'],outfile:'app/dist/monitor-check.cjs',bundle:true,platform:'node',format:'cjs',target:'node24'});
const result=spawnSync(process.execPath,['--test','app/dist/monitor-check.cjs'],{stdio:'inherit'});process.exitCode=result.status??1;
