import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,appendFile,mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRegistry, RegistryReader, statusOf, Registry, importTasks } from '../app/src/main/registry';
import { dispatchMatches } from '../app/src/main/platform';
import { parseEvent,readEvents,PAGE_BYTES } from '../app/src/main/events';
import { commitFrom,markdown } from '../app/src/shared/markdown';
import { combine } from '../app/src/renderer/timeline';
import { selectTasks } from '../app/src/renderer/taskList';
const row=(extra={})=>({v:1,event:'start',id:'sample',repo:path.resolve('/demo/project'),name:'task',title:'演示',spec:null,role:null,pid:42,started:100000,progress:path.resolve('/demo/project/task.progress.log'),report:path.resolve('/demo/project/task.md'),model:null,effort:null,tier:null,...extra});
const lines=(...rows:unknown[])=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';

test('任务搜索组合关键词、项目与状态，计数随搜索变化但不随状态筛选变化', () => {
    const base = parseRegistry(lines(row()))[0];
    const tasks = [
        { ...base, id: 'a', title: '修复登录', name: 'AUTH-123', repo: 'D:\\Projects\\中文', status: 'run' as const },
        { ...base, id: 'b', title: '登录测试', name: 'auth-124', repo: 'D:\\Projects\\中文', status: 'fail' as const },
        { ...base, id: 'c', title: '登录测试', name: 'auth-125', repo: 'D:\\Other', status: 'done' as const },
    ];
    const result = selectTasks(tasks, 'D:\\Projects\\中文', 'issues', '  登录 AUTH  ');
    assert.deepEqual(result.tasks.map(t => t.id), ['b']);
    assert.deepEqual(result.counts, { all: 2, run: 1, issues: 1 });
    assert.deepEqual(selectTasks(tasks, '', 'all', 'd:/projects/中文').tasks.map(t => t.id), ['a', 'b']);
    assert.equal(selectTasks(tasks, '', 'all', '   ').tasks.length, 3);
    assert.equal(selectTasks(tasks, '', 'all', '不存在').tasks.length, 0);
    assert.equal(selectTasks(tasks, '', 'run', 'AUTH-123').tasks[0], tasks[0]);
});

test('搜索按字面匹配并归一化 Unicode，不执行正则也不拼接字段制造命中', () => {
    const base = parseRegistry(lines(row()))[0];
    const tasks = [{ ...base, title: 'Café [登录]', name: 'record', repo: '/demo' }];
    assert.equal(selectTasks(tasks, '', 'all', 'CAFE\u0301 [登录]').tasks.length, 1);
    assert.equal(selectTasks(tasks, '', 'all', '.*').tasks.length, 0);
    assert.equal(selectTasks(tasks, '', 'all', ']record').tasks.length, 0);
});
const ps={pid:42,name:'node.exe',command:'node "C:\\demo\\codex-task.mjs"',created:99000};
const fixture=async()=>{const home=await mkdtemp(path.join(os.tmpdir(),'dispatchdock-test-'));await mkdir(path.join(home,'monitor'));const entry=row({repo:home,progress:path.join(home,'task.progress.log'),report:path.join(home,'task.md'),events:path.join(home,'task.events.jsonl')});await writeFile(path.join(home,'runs.jsonl'),lines(entry));return {home,entry,task:parseRegistry(lines(entry))[0]};};
test('清单合并、半行、坏行、未知字段，end 始终优先于 interrupted',()=>{
  const end={v:1,event:'end',id:'sample',exit:0,at:110000,minutes:1},stop={v:1,event:'interrupted',id:'sample',at:105000,signal:'stopped-by-app'};
  for(const middle of [[stop,end],[end,stop]]){const parsed=parseRegistry(lines(row({future:'ignore'}))+'broken\n'+lines(...middle)+JSON.stringify(row({id:'half'})));assert.equal(parsed.length,1);assert.equal(parsed[0].status,'done');assert.equal('future' in parsed[0],false);}
  assert.equal(parseRegistry(lines(row(),stop))[0].status,'stop');assert.equal(parseRegistry(lines(row(),{...end,exit:null}))[0].status,'fail');
});
test('进程核对拒绝复用 PID、错误进程、未来创建时间与超过 60 秒',()=>{const t=parseRegistry(lines(row()))[0];assert.equal(statusOf(t,[ps]),'run');for(const p of [{...ps,name:'cmd.exe'},{...ps,command:'node unrelated.mjs'},{...ps,created:100001},{...ps,created:40000},{...ps,pid:43}])assert.equal(statusOf(t,[p]),'stop');assert.equal(dispatchMatches(ps,100000),true);});
test('清单增量与截断恢复',async()=>{const {home,entry}=await fixture(),file=path.join(home,'runs.jsonl'),reader=new RegistryReader();assert.equal((await reader.read(file)).length,1);await appendFile(file,JSON.stringify({v:1,event:'end',id:'sample',exit:0,at:2}));assert.equal((await reader.read(file))[0].status,'run');await appendFile(file,'\n');assert.equal((await reader.read(file))[0].status,'done');await writeFile(file,lines({...entry,id:'new'}));assert.equal((await reader.read(file))[0].id,'new');});
test('事件尾页、增量半行与前向翻页按字节限制，未知事件忽略',async()=>{const {task}=await fixture();const make=(seq:number)=>({v:1,seq,at:seq,kind:'say',text:'中文'.repeat(60)});const source=Array.from({length:9000},(_,i)=>make(i+1));await writeFile(task.events!,lines(...source));const page=await readEvents(task);assert.ok(page.cursor.start>0);assert.ok(page.cursor.end-page.cursor.start<=PAGE_BYTES);assert.equal(page.events.at(-1)?.seq,9000);const before=await readEvents(task,page.cursor,true);assert.ok(before.events.length>0);assert.ok(before.events.at(-1)!.seq<page.events[0].seq);assert.equal(before.cursor.end,page.cursor.end);const next=make(9001);await appendFile(task.events!,JSON.stringify(next));assert.equal((await readEvents(task,page.cursor)).events.length,0);await appendFile(task.events!,'\n'+lines({v:1,seq:9002,at:0,kind:'future'}));const update=await readEvents(task,page.cursor);assert.equal(update.events.length,1);assert.equal(update.events[0].text,next.text);await writeFile(task.events!,lines(make(1)));assert.equal((await readEvents(task,update.cursor)).reset,true);});
test('旧进度解析包括错误、计划、命令失败与统一文件事件；不读取原始 log',async()=>{assert.equal(parseEvent('[12:00:00] 错误：失败',0,true)?.kind,'error');assert.equal(parseEvent('[12:00:00] 出错：失败',0,true)?.kind,'error');assert.deepEqual(parseEvent('[12:00:00] 计划：[x] 第一步 [ ] 第二步',0,true)?.items,[{text:'第一步',done:true},{text:'第二步',done:false}]);assert.equal(parseEvent('[12:00:00]   命令失败（exit 1）：npm test',0,true)?.exit,1);assert.equal(parseEvent('[12:00:00] 新增文件：src/demo.ts',0,true)?.files?.[0].kind,'add');const {task}=await fixture();task.raw=task.progress.replace('.progress.log','.log');await writeFile(task.raw,'private raw');await writeFile(task.progress,'[12:00:00] 说：进度\n');assert.equal((await readEvents(task)).events[0].text,'进度');});
test('提交号与安全 Markdown，只允许 http(s) 链接，无 HTML 执行',()=>{assert.equal(commitFrom('`123456` `4f2a9c1` `b81e0d2`'),'4f2a9c1');assert.equal(commitFrom('`1234567890123`'),undefined);const html=markdown('# 汇报\n<script>alert(1)</script>\n[bad](javascript:alert)\n[ok](https://example.org/)\n## TODO(design) 1 条\n- 待定\n## 推断清单\n1. 一项\n```html\n<img src=x onerror=alert(1)>\n```');assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('href="https://example.org/"'));assert.equal((html.match(/class="hl warn"/g)??[]).length,2);});
test('命令开始和结束按 id 合并，跨页保留顺序',()=>{const start=parseEvent(JSON.stringify({v:1,seq:1,at:1,kind:'cmd',id:'c',phase:'start',command:'npm test'}),10)!,end=parseEvent(JSON.stringify({v:1,seq:2,at:2,kind:'cmd',id:'c',phase:'end',command:'npm test',exit:1,output:'failed'}),200)!;const combined=combine([end,start]);assert.equal(combined.length,1);assert.equal(combined[0].offset,10);assert.equal(combined[0].exit,1);});
test('停止核对后调用假的 kill，半行隔开、通知只在状态转换时发送、隐藏不改清单',async()=>{const {home}=await fixture();let alive=true,killed=0,finished=0;const registry=new Registry(home,path.join(home,'monitor'),{processes:async()=>alive?[ps]:[],killTree:async()=>{killed++;alive=false;},open:async()=>{}},()=>{},()=>finished++,e=>{throw e;});try{await registry.start();assert.equal(finished,0);await assert.rejects(registry.hide('sample'));await appendFile(registry.file,'broken half');await registry.stop('sample');assert.equal(killed,1);assert.equal(finished,1);const text=await readFile(registry.file,'utf8');assert.ok(text.includes('broken half\n{"v":1,"event":"interrupted"'));assert.equal(registry.tasks[0].signal,'stopped-by-app');await registry.hide('sample');assert.equal(registry.tasks.length,0);assert.equal(await readFile(registry.file,'utf8'),text);}finally{await registry.close();}});
test('确认后身份变化时不 kill、不写 interrupted',async()=>{const {home}=await fixture();let calls=0,killed=0;const registry=new Registry(home,path.join(home,'monitor'),{processes:async()=>++calls<=2?[ps]:[{...ps,created:101000}],killTree:async()=>{killed++;},open:async()=>{}},()=>{},()=>{},()=>{});try{await registry.start();await assert.rejects(registry.stop('sample'),/任务状态已经变了/);assert.equal(killed,0);assert.ok(!(await readFile(registry.file,'utf8')).includes('interrupted'));}finally{await registry.close();}});
test('导入旧任务只在本地存储；viewer 退出只删除自己的 pid',async()=>{const {home}=await fixture();const dir=path.join(home,'.codex-runs');await mkdir(dir);await writeFile(path.join(dir,'old.progress.log'),'=== Codex 开始：旧任务（角色：工程负责人）  2026/10/8 10:05:00 ===\n[10:06:00] 说：完成\n=== Codex 结束：exit=0，用时 1.0 分钟，汇报在 demo.md ===\n');const imported=await importTasks(home);assert.equal(imported[0].title,'旧任务');assert.equal(imported[0].status,'done');assert.equal(imported[0].imported,true);const registry=new Registry(home,path.join(home,'monitor'),{processes:async()=>[],killTree:async()=>assert.fail(),open:async()=>{}},()=>{},()=>{},()=>{});await registry.start();const original=await readFile(registry.file,'utf8');await registry.import(home);assert.equal(await readFile(registry.file,'utf8'),original);const viewer=JSON.parse(await readFile(path.join(home,'viewer.json'),'utf8'));assert.equal(viewer.suppressWatchWindow,true);assert.equal(viewer.acceptsManaged,true);await writeFile(path.join(home,'viewer.json'),JSON.stringify({pid:99999}));await registry.close();assert.equal(JSON.parse(await readFile(path.join(home,'viewer.json'),'utf8')).pid,99999);});
test('无效日期与数值不进入渲染 DTO，持久化导入记录重新验证',async()=>{assert.equal(parseRegistry(lines(row({started:1e100}))).length,0);const parsed=parseRegistry(lines(row(),{v:1,event:'end',id:'sample',exit:0,minutes:'<img src=x>',at:'bad'}))[0];assert.equal(parsed.minutes,undefined);assert.equal(parsed.ended,undefined);assert.equal(parseEvent(JSON.stringify({v:1,seq:1,at:1e100,kind:'say',text:'bad'}),0),null);const {home,task}=await fixture();await writeFile(path.join(home,'monitor','tasks.json'),JSON.stringify({imports:[{...task,id:'import-safe',imported:true,status:'done',minutes:'<img src=x>'},{id:'invalid',imported:true,status:'done'}],hidden:[{},1]}));const registry=new Registry(home,path.join(home,'monitor'),{processes:async()=>[],killTree:async()=>assert.fail(),open:async()=>{}},()=>{},()=>{},()=>{});try{await registry.start();assert.ok(!registry.tasks.some(t=>t.id==='invalid'));assert.equal(registry.tasks.find(t=>t.id==='import-safe')?.minutes,undefined);}finally{await registry.close();}});

test('进程消失先宽限三秒并重读命令停止记录，不提前通知',async()=>{
  const {home}=await fixture();let present=true,finished=0;
  const registry=new Registry(home,path.join(home,'monitor'),{processes:async()=>present?[ps]:[],killTree:async()=>{},open:async()=>{}},()=>{},()=>finished++,e=>{throw e;});
  try {
    await registry.start();present=false;await registry.refresh();assert.equal(registry.tasks[0].status,'run');assert.equal(finished,0);
    await appendFile(registry.file,lines({v:1,event:'interrupted',id:'sample',signal:'stopped-by-command',at:Date.now()}));
    await registry.refresh();assert.equal(registry.tasks[0].signal,'stopped-by-command');assert.equal(finished,1);
  } finally {await registry.close();}
});
test('消失超过三秒仍无结束记录才判为中断',async()=>{
  const {home}=await fixture();
  const registry=new Registry(home,path.join(home,'monitor'),{processes:async()=>[],killTree:async()=>{},open:async()=>{}},()=>{},()=>{},e=>{throw e;});
  try {await registry.start();assert.equal(registry.tasks[0].status,'run');await new Promise(r=>setTimeout(r,3100));await registry.refresh();assert.equal(registry.tasks[0].status,'stop');}
  finally {await registry.close();}
});
