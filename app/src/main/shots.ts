import { captureWizard, capturePreferences } from './shots-preferences';
import type { BrowserWindow } from 'electron';
import { nativeTheme } from 'electron';
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import type { Registry } from './registry';
export async function capture(win: BrowserWindow, registry: Registry, out: string) {
    // 验收窗口在后台绘制，避免用户鼠标影响悬停与淡出截图。
    win.webContents.setBackgroundThrottling(false);
    await mkdir(out, { recursive: true });
    const checks: string[] = [];
    let screenshots = 0;
    const pause = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
    const evaluate = async (expression: string) => {
        try { return await win.webContents.executeJavaScript(expression); }
        catch (error) { throw Error(`验收表达式失败：${expression}`, { cause: error }); }
    };
    const wait = async (expression: string) => { for (let i = 0; i < 100; i++) {
        if (await evaluate(expression))
            return;
        await pause(100);
    } throw Error('Renderer readiness timeout: ' + expression); };
    const check = async (label: string, expression: string) => {
        const result = await evaluate(expression);
        if (result !== true)
            console.log(await evaluate('JSON.stringify({top:document.querySelector(".dbody > .scroll")?.scrollTop,height:document.querySelector(".dbody > .scroll")?.scrollHeight,viewTop:document.querySelector(".dbody > .scroll")?.getBoundingClientRect().top,planTop:document.querySelector(".plan-slot")?.getBoundingClientRect().top,edge:document.querySelector(".dbody")?.className,thumbs:[...document.querySelectorAll(".sc-thumb")].map(t=>({class:t.className,hidden:t.hidden,style:t.style.cssText})),count:document.querySelectorAll("[data-event]").length,text:document.querySelector(".events-host")?.textContent?.slice(0,500)})'));
        assert.equal(result, true, label);
        checks.push(label);
    };
    const click = async (selector: string) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(); };
    const save = async (name: string) => {
        await pause();
        // 仅截图时替换隔离目录前缀，实际设置数据仍保留完整路径。
        await evaluate(`(() => {
            window.__shotPaths = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.textContent.includes(${JSON.stringify(process.env.CODEX_DISPATCH_HOME)})) {
                    window.__shotPaths.push([node, node.textContent]);
                    node.textContent = node.textContent.replaceAll(${JSON.stringify(process.env.CODEX_DISPATCH_HOME)}, '<临时目录>');
                }
            }
        })()`);
        // 隔离路径也可能包含本机用户名，截图前确认正文没有泄漏该前缀。
        assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(process.env.CODEX_DISPATCH_HOME)})`),false,'截图不能显示临时目录的本机绝对路径');
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const png=await new Promise<Buffer>((resolve,reject)=>{
            const timer=setTimeout(()=>reject(Error('Screenshot paint timeout')),5000);
            win.webContents.once('paint',(_event,_rect,image)=>{clearTimeout(timer);resolve(image.toPNG());});
            win.webContents.invalidate();
        });
        await writeFile(path.join(out,name+'.png'),png); screenshots++;
        await evaluate('window.__shotPaths.forEach(([node, text]) => node.textContent = text); delete window.__shotPaths;');
    };
    const harness = {evaluate,wait,check,click,save};
    await captureWizard(harness);
    await wait('!!document.querySelector("[data-task=t1]")');
    // 当前 Electron 提供此诊断入口但未导出类型，限定在验收工具中使用。
    const contents = win.webContents as typeof win.webContents & {
        getLastWebPreferences(): Electron.WebPreferences;
    };
    const prefs = contents.getLastWebPreferences();
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegration, false);
    checks.push('窗口启用隔离与沙箱，关闭 Node 集成');
    await check('渲染器没有 Node 权限', 'typeof require === "undefined" && typeof process === "undefined"');
    assert.equal(registry.tasks.filter(t => t.status === 'run').length, 2);
    checks.push('通过 Windows 进程身份检查识别两个假派发进程');
    // 捕获真实窗口，不替换数据 API 或渲染器。
    for (const theme of ['dark', 'light'] as const) {
        nativeTheme.themeSource = theme;
        await pause();
        for (const [scene, id] of [['running', 't1'], ['completed', 't3'], ['failed', 't5'], ['interrupted', 't6']]) {
            await click(`[data-task=${id}]`);
            await wait(scene === 'completed' ? '!!document.querySelector(".md")' : '!!document.querySelector("[data-event]")');
            if (scene === 'completed')
                await check('相邻汇报高亮间隔 8px（' + theme + '）', '(()=>{const blocks=document.querySelectorAll(".md .hl.warn");return blocks.length===2 && blocks[1].getBoundingClientRect().top-blocks[0].getBoundingClientRect().bottom===8;})()');
            if(scene==='running') await check('托管任务标题标签（'+theme+'）','document.querySelector(".dh .tag")?.textContent==="托管"');
            if(scene==='interrupted') await check('中断横幅去设置（'+theme+'）','!!document.querySelector(".banner [data-managed-settings]")');
            await save(`${scene}-${theme}`);
        }
    }
    nativeTheme.themeSource = 'dark';
    win.setContentSize(960, 600);
    await click('[data-task=t1]');
    await save('running-960x600');
    await check('最小窗口使用 288px 列表', 'Math.round(document.querySelector(".split > .edge").getBoundingClientRect().width) === 288');
    await evaluate('document.querySelector(".dbody > .scroll").scrollTop=0');
    await pause();
    await check('顶部保留完整计划，隐藏单行计划条', '!!document.querySelector(".plan") && document.querySelector("[data-plan-top]").hidden && getComputedStyle(document.querySelector(".plan-slot")).position !== "sticky"');
    await evaluate('(()=>{const box=document.querySelector(".dbody > .scroll");box.scrollTop=200;box.dispatchEvent(new Event("scroll"));box.dispatchEvent(new MouseEvent("mouseenter"));})()');
    await save('running-scrolled-960x600');
    await check('计划条高 36px、贴合滚动区且没有重复分隔线', '(()=>{const bar=document.querySelector("[data-plan-top]"),box=document.querySelector(".dbody > .scroll"),r=bar.getBoundingClientRect(),v=box.getBoundingClientRect();return !bar.hidden && r.height===36 && r.top===v.top && r.left===v.left && r.right===v.right && getComputedStyle(document.querySelector(".dbody"),"::before").display==="none" && bar.querySelector("progress").getBoundingClientRect().width<=160 && bar.textContent.includes("当前：堆叠合并与上限 99");})()');
    await check('浮动滑块位于计划条下方', '[...document.querySelectorAll(".sc-thumb.show")].some(t=>!t.hidden && t.getBoundingClientRect().top>=document.querySelector("[data-plan-top]").getBoundingClientRect().bottom && t.getBoundingClientRect().right>document.querySelector(".dbody").getBoundingClientRect().left)');
    await click('[data-plan-top]');
    await wait('document.querySelector(".dbody > .scroll").scrollTop===0');
    await check('点击计划条回到顶部', 'document.querySelector("[data-plan-top]").hidden');
    win.webContents.debugger.attach('1.3');
    try {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await evaluate('document.querySelector(".dbody > .scroll").scrollTop=200');
        await wait('!document.querySelector("[data-plan-top]").hidden');
        await check('减少动态效果时点击计划条立即回顶', '(()=>{document.querySelector("[data-plan-top]").click();return matchMedia("(prefers-reduced-motion: reduce)").matches && document.querySelector(".dbody > .scroll").scrollTop===0;})()');
    }
    finally {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        win.webContents.debugger.detach();
    }
    await click('[data-task=t10]');
    await wait('!!document.querySelector("[data-event]")');
    await save('stopped-by-app');
    await check('手动停止使用专用列表说明和横幅', 'document.querySelector("[data-task=t10] .tm").textContent.includes("手动停止") && document.querySelector(".banner .rt b").textContent==="你停止了这个任务" && document.querySelector(".banner .rt span").textContent==="工作区里没提交的改动还在。要继续，在派活方的会话里重新派发。"');
    await check('没有计划时不显示计划框和计划条', '!document.querySelector(".plan") && document.querySelector("[data-plan-top]").hidden');
    win.setContentSize(1160, 720);
    await click('[data-task=t1]');
    await evaluate('(()=>{const box=document.querySelector(".dbody > .scroll");box.scrollTop=0;box.dispatchEvent(new Event("scroll"));})()');
    const command = await evaluate('[...document.querySelectorAll("[data-cmd]")].find(b=>b.textContent.includes("npm test"))?.dataset.cmd');
    await click(`[data-cmd="${command}"]`);
    await evaluate('(()=>{const box=document.querySelector(".dbody > .scroll");box.scrollTop=80;box.dispatchEvent(new Event("scroll"));box.dispatchEvent(new MouseEvent("mouseenter"));})()');
    await save('progress-scrolled');
    await check('完整计划随内容滚动，浮动滑块出现', 'document.querySelector(".plan-slot").getBoundingClientRect().top < document.querySelector(".dbody > .scroll").getBoundingClientRect().top && [...document.querySelectorAll(".sc-thumb.show")].some(t=>!t.hidden)');
    const position = await evaluate('document.querySelector(".dbody > .scroll").scrollTop');
    await evaluate('document.querySelector("[data-think]").focus()');
    await pause(1300);
    await check('后台刷新保留焦点、展开输出与滚动位置', `document.activeElement.hasAttribute('data-think') && !!document.querySelector('.out') && Math.abs(document.querySelector('.dbody > .scroll').scrollTop - ${position}) < 1`);
    await check('向上滚动暂停跟随', '!document.querySelector("[data-latest]").hidden');
    await click('[data-latest]');
    await check('跳到最新恢复跟随', 'document.querySelector("[data-latest]").hidden');
    await click('[data-think]');
    await check('思考可切换显示', '!!document.querySelector(".k-think")');
    await click('[data-think]');
    await check('思考默认隐藏', '!document.querySelector(".k-think")');
    await click('[data-stop]');
    await check('停止确认默认焦点在取消', 'document.activeElement.textContent === "取消" && document.querySelector("#app").inert');
    await click('.confirm-actions .btn');
    await check('取消停止不写入中断', '!!document.querySelector("[data-stop]") && !document.querySelector(".confirm-overlay")');
    await click('[data-more]');
    await check('进行中不能隐藏', '[...document.querySelectorAll(".ctx button")].at(-1).disabled');
    await evaluate('document.querySelector(".ctx").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await click('[data-tab=files]');
    await check('文件汇总保留最终改动', 'document.querySelectorAll(".tab-body .r").length === 4');
    await click('[data-tab=params]');
    await check('托管参数显示是','[...document.querySelectorAll(".rows .r")].some(r=>r.querySelector(".k")?.textContent==="托管" && r.querySelector(".v")?.textContent==="是")');
    await check('参数显示统一事件与原始输出的打开按钮', '!!document.querySelector("[data-open=events]") && !!document.querySelector("[data-open=raw]")');
    await click('[data-project]');
    await check('自制项目下拉', '!!document.querySelector("[role=listbox]") && !document.querySelector("select")');
    await click('.ctx button:nth-child(2)');
    await check('项目筛选生效', 'document.querySelectorAll("[data-task]").length === 5');
    await click('[data-project]');
    await click('.ctx button');
    await click('[data-filter=issues]');
    await check('失败或中断筛选生效', 'document.querySelectorAll("[data-task]").length === 3');
    await click('[data-filter=all]');
    const fontLoaded = await capturePreferences(harness);
    await click('[data-page=tasks]');
    await click('[data-task=t1]');
    const eventFile = registry.tasks.find(t => t.id === 't1')!.events!, originalEvents = await readFile(eventFile);
    try {
        await appendFile(eventFile, Array.from({ length: 650 }, (_, i) => JSON.stringify({ v: 1, seq: 1000 + i, at: Date.now() + i, kind: 'say', text: `演示进展 ${i}` })).join('\n') + '\n');
        await wait('document.querySelector(".events-host").textContent.includes("演示进展 649")');
        await check('超过 500 条事件启用虚拟列表', 'document.querySelectorAll("[data-event]").length < 300');
        await evaluate('(()=>{const box=document.querySelector(".dbody > .scroll");box.scrollTop=0;box.dispatchEvent(new Event("scroll"));})()');
        await pause();
        await check('虚拟列表可回到较早事件', 'document.querySelector(".events-host").textContent.includes("AGENTS.md")');
        await appendFile(eventFile, JSON.stringify({ v: 1, seq: 1650, at: Date.now(), kind: 'plan', items: [{ text: '全部完成', done: true }] }) + '\n');
        await wait('document.querySelector(".plan-h .mono")?.textContent==="1/1"');
        await evaluate('document.querySelector(".dbody > .scroll").scrollTop=200');
        await wait('!document.querySelector("[data-plan-top]").hidden');
        await check('计划全部完成时没有当前项', '!document.querySelector("[data-plan-top] .plan-now") && document.querySelector("[data-plan-top] .mono").textContent==="1/1"');
    }
    finally {
        await writeFile(eventFile, originalEvents);
    }
    // 空场景也由隔离清单驱动，结束演示后恢复文件供复用。
    const original = await readFile(registry.file);
    await writeFile(registry.file, '');
    await registry.refresh();
    await wait('!document.querySelector("[data-task]")');
    await check('空状态使用列表图标和均衡换行', '!!document.querySelector(".detail .ri-file-list-3-line") && [...document.querySelectorAll(".empty p")].length===2 && [...document.querySelectorAll(".empty p")].every(p=>getComputedStyle(p).textWrap==="balance" && getComputedStyle(p).maxWidth==="280px")');
    try {
        for (const theme of ['dark', 'light'] as const) {
            nativeTheme.themeSource = theme;
            await save('empty-' + theme);
        }
    }
    finally {
        await writeFile(registry.file, original);
    }
    await writeFile(path.join(out, 'checks.json'), JSON.stringify({ screenshots, fontLoaded, checks }, null, 2));
    console.log(`Generated ${screenshots} screenshots; ${checks.length} UI checks passed.`);
    await prepareManagedExit(registry, out);
}

// 使用正在截图的真实 Electron 主进程认领；外部启动器在 app.quit 后检查任务继续运行。
async function prepareManagedExit(registry: Registry, out: string) {
    const home = process.env.CODEX_DISPATCH_HOME!, node = process.env.DISPATCHDOCK_TEST_NODE!;
    assert.ok(path.isAbsolute(node) && /^node(?:\.exe)?$/i.test(path.basename(node)));
    const repo = path.join(home, 'managed-exit-repo'), agent = path.join(home, 'managed-exit-agent.cjs');
    const ready = path.join(home, 'managed-exit-agent.json');
    await mkdir(repo, { recursive: true });
    await writeFile(agent, `const fs=require('node:fs');if(process.argv.includes('--version')){console.log('codex-cli fake-exit');process.exit(0);}process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'正在验证软件退出后的托管任务'}}));setTimeout(()=>{fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'隔离任务完成');},5000);});`);
    await writeFile(path.join(home, 'config.json'), JSON.stringify({ v: 1, managed: true, watchWindow: 'never', agents: { codex: { path: agent } } }));
    const script = path.join(process.env.CLAUDE_CONFIG_DIR!, 'skills/codex-dispatch/codex-task.mjs');
    const output = await open(path.join(home, 'managed-exit-waiter.log'), 'w');
    try {
        const waiter = spawn(node, [script, '验证软件退出', '--name', 'managed-exit'], { cwd: repo, env: process.env, detached: true, stdio: ['ignore', output.fd, output.fd], shell: false, windowsHide: true });
        await new Promise<void>((resolve, reject) => { waiter.once('spawn', resolve); waiter.once('error', reject); });
        waiter.unref();
    } finally { await output.close(); }
    for (let i = 0; i < 100; i++) {
        await registry.refresh();
        const task = registry.tasks.find(t => t.name === 'managed-exit');
        const running = await readFile(ready, 'utf8').then(JSON.parse).catch(() => null);
        if (task?.managed && task.status === 'run' && running?.pid) {
            await writeFile(path.join(out, 'managed-exit-pending.json'), JSON.stringify({ id: task.id, executor: task.pid, agent: running.pid }));
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('真实软件未能认领隔离托管任务');
}
