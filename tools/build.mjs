import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { copyFont } from './fonts.mjs';
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
const out='app/dist';await mkdir(out+'/icons',{recursive:true});
await Promise.all([
  build({entryPoints:['app/src/main/index.ts'],outfile:out+'/main.cjs',platform:'node',format:'cjs',bundle:true,external:['electron'],target:'node24'}),
  build({entryPoints:['app/src/preload/index.ts'],outfile:out+'/preload.cjs',platform:'node',format:'cjs',bundle:true,external:['electron'],target:'node24'}),
  build({entryPoints:['app/src/renderer/index.ts'],outfile:out+'/renderer.js',platform:'browser',format:'iife',bundle:true,loader:{'.svg':'text'},target:'chrome140'}),
  copyFile('node_modules/remixicon/License',out+'/icons/License'),copyFile('app/src/renderer/index.html',out+'/index.html'),copyFile('app/src/renderer/style.css',out+'/style.css'),copyFile('app/design/tokens.css',out+'/tokens.css'),cp('node_modules/remixicon/fonts',out+'/icons',{recursive:true})
]);

const {name,version,type,license,description,repository}=JSON.parse(await readFile('package.json','utf8'));
// 运行代码已打包，图标为静态资源，运行目录不需要开发依赖或 node_modules。
await Promise.all([cp('skills',out+'/skills',{recursive:true}),cp('installer',out+'/installer',{recursive:true}),writeFile(out+'/package.json',JSON.stringify({name,version,type,license,description,repository,main:'main.cjs'},null,2)),copyFile('LICENSE',out+'/LICENSE'),copyFile('THIRD_PARTY_NOTICES.md',out+'/THIRD_PARTY_NOTICES.md'),copyFile('app/src/main/preferences.mjs',out+'/preferences.mjs'),copyFile('app/src/main/managed.mjs',out+'/managed.mjs'),copyFont(out)]);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve,reject)=>{const child=spawn(electron,['tools/icons.mjs'],{env,stdio:'inherit',windowsHide:true,shell:false});child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(Error('图标生成失败：'+(signal||code))));});
for(const size of [16,20,24,32,40,48,64,128,256])await copyFile('build/icons/app-'+size+'.png',out+'/icons/app-'+size+'.png');
await copyFile('build/icons/app.ico',out+'/icons/app.ico');
