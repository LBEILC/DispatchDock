import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPlan, executePlan } from '../../installer/lib/install.mjs';

export async function preferenceFixture(home, { install = true } = {}) {
  const user = path.join(home, 'user'), appdata = path.join(user,'AppData','Roaming');
  const env = { ...process.env, CODEX_DISPATCH_HOME: home, USERPROFILE: user, HOME: user, APPDATA: appdata,
    CLAUDE_CONFIG_DIR: path.join(user,'.claude'), CODEX_HOME: path.join(user,'.codex'), XDG_CONFIG_HOME: path.join(user,'.config'),
    CODEX_DISPATCH_TEST_AGENT: path.join(home,'fake-codex.cjs') };
  for(const key of ['CODEX_MODEL','CODEX_EFFORT','CODEX_TIER','CODEX_SANDBOX','CODEX_NO_WATCH']) delete env[key];
  // 所有检测与安装都在同一个隔离目录，绝不回落到真实 PATH 或宿主。
  env.CODEX_TIER='priority';
  for(const dir of [env.CLAUDE_CONFIG_DIR,env.CODEX_HOME,path.join(appdata,'devin'),path.join(user,'.config','devin')]) await mkdir(dir,{recursive:true});
  await writeFile(path.join(env.CODEX_HOME,'config.toml'),'model = "gpt-x"\nmodel_reasoning_effort = "medium"\nservice_tier = "default"\n');
  await writeFile(env.CODEX_DISPATCH_TEST_AGENT,`const fs=require('node:fs');const path=require('node:path');const state=JSON.parse(fs.readFileSync(path.join(__dirname,'fake-codex.json'),'utf8'));if(state.missing)process.exit(1);if(process.argv.includes('--version')){console.log(state.version);process.exit(0);}if(process.argv.slice(-2).join(' ')==='login status'){console.error(state.loggedIn?'Logged in using ChatGPT':'Not logged in');process.exit(state.loggedIn?0:1);}process.exit(2);\n`);
  await writeFile(path.join(home,'fake-codex.json'),JSON.stringify({version:'codex-cli 0.156.1',loggedIn:true}));
  if (install) {
    executePlan(createPlan({env,host:'claude-code'}),{env});
    executePlan(createPlan({env,host:'devin',skill:'codex-dispatch'}),{env});
  }
  return env;
}
