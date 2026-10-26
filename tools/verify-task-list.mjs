// 在真实 Chromium 中验证列表 DOM；桥接层只提供合成快照，不读取用户任务。
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
const out = path.resolve('app/dist');
const profile = mkdtempSync(path.join(os.tmpdir(), 'dispatchdock-list-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
async function main() {
await app.whenReady();
const win = new BrowserWindow({ show: false, width: 1160, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
win.webContents.setBackgroundThrottling(false);
const evaluate = code => win.webContents.executeJavaScript(`(() => { ${code}\n })()`);
const checks = [];
const check = async (label, code) => { assert.equal(await evaluate(`return (${code});`), true, label); checks.push(label); };
const htmlFile = path.join(out, 'task-list-check.html');
try {
    const html = (await readFile(path.join(out, 'index.html'), 'utf8')).replace('<script src="renderer.js" defer></script>', '');
    await writeFile(htmlFile, html);
    await win.loadFile(htmlFile);
    await evaluate(`
        window.sampleTasks = (count) => Array.from({length: count}, (_, i) => ({
            id: 'sample-' + i, title: i === 0 ? '修复登录 <img src=x>' : '历史任务 ' + i,
            name: 'AUTH-' + i, repo: i % 2 ? '/demo/other' : '/demo/中文项目',
            status: i === 0 ? 'run' : i % 3 ? 'done' : 'fail',
            started: Date.now() - 86400000 * 3 - i * 1000, last: '合成进展',
            progress: '/demo/progress', report: '/demo/report', pid: 0,
            model: null, effort: null, tier: null, role: null, spec: null
        }));
        window.fixture = {tasks: sampleTasks(8), theme: 'dark', version: 'test'};
        window.push = tasks => { fixture = {...fixture, tasks}; window.acceptSnapshot(structuredClone(fixture)); };
        window.dock = {
            preferences: async action => action === 'settings' ? {own:{wizardDone:true},managed:false} : {hosts:[],codex:{}},
            subscribe: callback => { window.acceptSnapshot = callback; return () => {}; },
            snapshot: async () => structuredClone(fixture),
            events: async () => ({events:[],cursor:{source:'',start:0,end:0},reset:false}),
            detail: async () => ({report:''}), action: async () => {}, import: async () => {}
        };
    `);
    await evaluate(await readFile(baseline || path.join(out, 'renderer.js'), 'utf8'));
    await check('渲染全部合成任务且不把标题当 HTML', `document.querySelectorAll('.trow').length === 8 && !document.querySelector('.trow img')`);
    if (!baseline) {
        await evaluate(`window.search = value => { const input=document.querySelector('[data-task-search]'); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); }; search('登录');`);
        await check('中文标题搜索', `document.querySelectorAll('.trow').length===1 && document.querySelector('.trow').dataset.task==='sample-0'`);
        await evaluate(`document.querySelector('.trow').click(); const input=document.querySelector('[data-task-search]'); input.focus(); input.setSelectionRange(1,2); window.searchInput=input; window.selectedRow=document.querySelector('.trow'); push(fixture.tasks.map((t,i)=>i===0?{...t,last:'新的进展'}:t));`);
        await check('后台刷新保留搜索输入、光标、选中按钮和详情', `document.activeElement===searchInput && searchInput.value==='登录' && searchInput.selectionStart===1 && searchInput.selectionEnd===2 && selectedRow===document.querySelector('.trow.on') && document.querySelector('.dh h2').textContent.includes('修复登录')`);
        await evaluate(`search('auth-3'); document.querySelector('[data-filter=issues]').click();`);
        await check('记录名搜索与状态筛选组合', `document.querySelectorAll('.trow').length===1 && document.querySelector('.trow').dataset.task==='sample-3' && document.querySelector('[data-filter=all] .n').textContent==='1'`);
        await evaluate(`search('/DEMO/中文项目');`);
        await check('项目路径搜索与状态计数', `document.querySelectorAll('.trow').length===1 && document.querySelector('.trow').dataset.task==='sample-6' && document.querySelector('[data-filter=all] .n').textContent==='4'`);
        await evaluate(`document.querySelector('[data-filter=all]').click(); document.querySelector('[data-project]').click(); [...document.querySelectorAll('.ctx button')].find(b=>b.textContent==='other').click(); search('auth-3');`);
        await check('搜索与项目筛选组合', `document.querySelectorAll('.trow').length===1 && document.querySelector('.trow').dataset.task==='sample-3'`);
        await evaluate(`search('auth-0');`);
        await check('无结果提示与详情清空', `document.querySelector('.tlist .empty b').textContent==='没有匹配的任务' && !document.querySelector('.dh')`);
        await evaluate(`document.querySelector('[data-project]').click(); document.querySelector('.ctx button').click(); search(''); const input=document.querySelector('[data-task-search]'); input.value='暂未完成'; input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));`);
        await check('中文输入法组合阶段不筛掉任务', `document.querySelectorAll('.trow').length===8`);
        await evaluate(`const input=document.querySelector('[data-task-search]'); input.value='登录'; input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`);
        await check('输入法提交后筛选', `document.querySelectorAll('.trow').length===1`);
        await evaluate(`document.querySelector('[data-task-search]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
        await check('Escape 清空搜索', `document.querySelectorAll('.trow').length===8 && !document.querySelector('[data-task-search]').value`);
        await evaluate(`search('不存在'); acceptSnapshot({...structuredClone(fixture), select:'sample-4'});`);
        await check('通知选中任务时清除搜索与筛选', `document.querySelector('.trow.on').dataset.task==='sample-4' && document.querySelector('[data-task-search]').value===''`);
        await evaluate(`document.querySelector('[data-task="sample-0"]').focus(); window.runningRow=document.activeElement; push(fixture.tasks.map((t,i)=>i===0?{...t,status:'done'}:t));`);
        await check('任务结束移动分组时复用按钮并保留焦点', `runningRow.isConnected && runningRow===document.querySelector('[data-task="sample-0"]') && document.activeElement===runningRow && !runningRow.classList.contains('is-running')`);
    }
    const benchmarks = [];
    for (const count of [1000, 5000]) {
        const result = await evaluate(`return (() => {
            const start=performance.now(); push(sampleTasks(${count})); document.querySelector('.tlist').offsetHeight;
            const initialMs=performance.now()-start, box=document.querySelector('.tlist');
            box.scrollTop=500; const scroll=box.scrollTop;
            const row=box.querySelector('[data-task="sample-500"]'); row.focus({preventScroll:true});
            const samples=[];
            for(let i=0;i<12;i++) {
                const tasks=fixture.tasks.map((t,j)=>j===0?{...t,last:'进展 '+i}:t);
                const at=performance.now(); push(tasks); box.offsetHeight;
                if(i>=2) samples.push(performance.now()-at);
            }
            samples.sort((a,b)=>a-b);
            return {count:${count},initialMs,updateMedianMs:samples[5],updateMaxMs:samples.at(-1),
                retainedNode:row===box.querySelector('[data-task="sample-500"]'),
                retainedFocus:document.activeElement===row,retainedScroll:box.scrollTop===scroll};
        })()`);
        benchmarks.push(result);
        if (!baseline) for (const key of ['retainedNode', 'retainedFocus', 'retainedScroll']) assert.equal(result[key], true, `${count}: ${key}`);
    }
    if (!baseline) {
        await evaluate(`push(sampleTasks(8).map((t,i)=>i===0?{...t,title:'修复登录状态',started:Date.now()-60000}:t)); search('登录');`);
        for (const width of [960, 1160]) {
            win.setSize(width, 720);
            for (const theme of ['light', 'dark']) {
                await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};`);
                await check(`搜索框适配 ${width} / ${theme}`, `(() => { const input=document.querySelector('[data-task-search]').getBoundingClientRect(), box=document.querySelector('.split > .edge').getBoundingClientRect();return input.width>0 && input.left>=box.left && input.right<=box.right && document.documentElement.scrollWidth<=innerWidth; })()`);
                await evaluate('return document.fonts.ready.then(() => undefined);');
                await evaluate('return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));');
                await new Promise(resolve => setTimeout(resolve, 250));
                await writeFile(path.join(out, `task-list-${width}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
    }
    const result = { baseline: !!baseline, checks, benchmarks, electron: process.versions.electron };
    await writeFile(path.join(out, baseline ? 'task-list-baseline.json' : 'task-list-checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    win.destroy();
    await rm(htmlFile, { force: true });
    app.exit(process.exitCode || 0);
}

}
void main().catch(error => { console.error(error); app.exit(1); });
