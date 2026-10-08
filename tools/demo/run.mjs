import { spawn } from 'node:child_process';
import electron from 'electron';
import { preferenceFixture } from './preferences.mjs';
import { demo } from './index.mjs';
const fixture=await demo();
try {
  const env={...await preferenceFixture(fixture.home),CODEX_DISPATCH_HOME:fixture.home};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electron,['.'],{env,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  process.exitCode=Number(code)||0;
} finally { await fixture.close(); }
