import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tasks, plan1, ev1, ev5, ev6, files3 } from './data.mjs';
export async function demo(){
  const home=await mkdtemp(path.join(os.tmpdir(),'dispatchdock-demo-'));const children=[];
  for(let i=0;i<2;i++){const child=fork(fileURLToPath(new URL('./codex-task.mjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});children.push(child);}
  const rows=[],now=Date.now();let active=0;
  for(const t of tasks){
    const repo=path.join(home,'projects',t.project),dir=path.join(repo,'.codex-runs');await mkdir(dir,{recursive:true});const name=t.record??t.name;
    // 演示进程创建时间必须与 started 接近，不能伪造身份时间。
    const started=t.state==='run'?now:new Date(new Date().setHours(...t.start.split(':').map(Number),0,0)).getTime()-(t.day==='yesterday'?86400000:0);
    const entry={v:1,event:'start',id:t.id,repo,name,title:t.name,spec:t.record?null:`docs/specs/${t.name}.md`,role:t.role,pid:t.state==='run'?children[active++].pid:0,started,progress:path.join(dir,name+'.progress.log'),report:path.join(dir,name+'.md'),events:path.join(dir,name+'.events.jsonl'),raw:path.join(dir,name+'.log'),model:null,effort:null,tier:null,sandbox:t.sandbox,managed:t.id==='t1',agent:'codex',agentVersion:'codex-cli 0.156.1',dispatcher:{host:t.host==='Devin'?'devin':'claude-code',session:null}};
    rows.push(entry);if(t.state==='done'||t.state==='fail')rows.push({v:1,event:'end',id:t.id,exit:t.exit??0,at:started+60000*parseFloat(t.dur),minutes:parseFloat(t.dur)});if(t.state==='stop')rows.push({v:1,event:'interrupted',id:t.id,at:started+192000,signal:t.signal??'session-closed'});
    const events=[];let seq=0;const add=e=>events.push({v:1,seq:++seq,at:started+seq*1000,...e});
    if(t.id==='t1')add({kind:'plan',items:plan1.map(([text,status])=>({text,done:status==='done'}))});
    if(t.id==='t2')add({kind:'plan',items:[{text:'读任务说明',done:true},{text:'分页组件',done:false},{text:'接口参数',done:false},{text:'验证、提交、汇报',done:false}]});
    const source=t.id==='t1'?ev1:t.id==='t5'?ev5:t.state==='stop'?ev6:t.id==='t2'?[['15:36','say','先读任务说明和现有的搜索结果列表。'],['15:39','file',[['update','src/search/Results.tsx']]]]:[[t.start,'say','已完成，见汇报。']];
    for(const [,kind,value,exit,output] of source){if(kind==='cmd'){const id=`cmd-${seq}`;add({kind,id,phase:'start',command:value});if(exit!==null)add({kind,id,phase:'end',command:value,exit,output,truncated:false});}else if(kind==='file')add({kind,files:value.map(([kind,path])=>({kind,path}))});else if(kind==='turn')add({kind:'turn',usage:t.id==='t5'?{input:64000,output:2100}:{input:182000,output:6400}});else add({kind:kind==='err'?'error':kind,text:String(value).replace(/<code>(.*?)<\/code>/g,'`$1`')});}
    if(t.id==='t3')add({kind:'file',files:files3.map(([kind,path])=>({kind,path}))});
    await writeFile(entry.events,events.map(e=>JSON.stringify(e)).join('\n')+'\n');await writeFile(entry.raw,'??????\n');
    await writeFile(entry.progress,`=== Codex 开始：${t.name}  ${new Date(started).toLocaleString('zh-CN',{hour12:false})} ===\n[15:39:00] ${t.last??'说：已完成，见汇报。'}\n`);
    if(entry.spec){await mkdir(path.join(repo,'docs/specs'),{recursive:true});await writeFile(path.join(repo,entry.spec??'docs/specs/demo.md'),`# ${t.name}\n`);}
    for(const e of events)for(const f of e.files??[]){const file=path.join(repo,f.path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'// 演示文件\n');}
    if(t.state==='done')await writeFile(entry.report,t.id==='t3'?['# 完成了什么','存档加了版本号，读取时按 v1 → v2 → v3 逐级迁移；旧存档读取后自动写回新格式，并保留一份 `.bak`。','提交：`4f2a9c1`','## 验证','- `npm test` 46/46 通过，新增迁移测试 9 条。','- 用 3 份旧存档样例实际读取，背包、地图、设置都对得上。','## TODO(design) 2 条','1. 迁移失败时给玩家看的提示文案，现在是占位“【文案待定：存档无法升级】”。','2. 是否在读取旧存档时提示“已升级”。','## 推断清单 3 条','1. 备份文件名用 `<存档名>.bak`，只保留最近一份。','2. 未知字段原样保留，不删除。','3. 版本号写在存档顶层 `v` 字段。','## 已知问题','无。'].join('\n'):t.id==='t4'?'# 完成了什么\n排查结果：白屏是因为首次启动时读取空的设置文件抛错。只读任务，没有改动文件。':`# 完成了什么\n已完成。\n提交：\`${t.commit}\`\n`);
  }
  await writeFile(path.join(home,'runs.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  return {home,children,async close(){await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.send('exit');})));}};
}
