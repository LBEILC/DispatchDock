// 真实渲染器的长模型名布局回归，桥接层仅返回隔离合成配置。
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = mkdtempSync(path.join(os.tmpdir(), 'dispatchdock-settings-'));
process.env.CODEX_DISPATCH_HOME = profile;
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const out = path.resolve('.tmp/settings-layout'), htmlFile = path.resolve('app/dist/settings-layout.html');
const checks = [], measurements = [];
let win;
async function main() {
try {
  await app.whenReady();
  await mkdir(out, { recursive: true });
  win = new BrowserWindow({ show: false, width: 1160, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setBackgroundThrottling(false);
  const evaluate = code => win.webContents.executeJavaScript(code);
  const wait = async code => { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('等待界面超时：' + code); };
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const check = async (label, expression) => { assert.equal(await evaluate(expression), true, label); checks.push(label); };
  await writeFile(htmlFile, (await readFile('app/dist/index.html', 'utf8')).replace('<script src="renderer.js" defer></script>', ''));
  await win.loadFile(htmlFile);
  await evaluate(`
    window.sampleSettings = {
      managed:false, values:{model:null,effort:null,tier:null,sandbox:'workspace-write',watchWindow:'auto',path:null},
      exists:false,reason:null,file:'<临时配置>',current:{model:'gpt-6.1-sol',effort:'high',tier:'default'},overrides:{},
      own:{wizardDone:false,theme:'dark',notifications:false}
    };
    window.dock = {
      preferences:async(action,payload={})=>{
        if(action==='detect')return {hosts:[],availableVersion:'test',codex:{installed:false,version:null,login:'unknown',path:null}};
        if(action==='save')sampleSettings.values[payload.key]=payload.value;
        if(action==='finish'){sampleSettings.own.wizardDone=true;sampleSettings.exists=true;}
        return structuredClone(sampleSettings);
      },
      subscribe:()=>()=>{},snapshot:async()=>({tasks:[],theme:'dark',version:'test'}),
      events:async()=>({events:[],cursor:{source:'',start:0,end:0},reset:false}),detail:async()=>({report:''}),action:async()=>{},import:async()=>{}
    }; void 0;
  `);
  await evaluate(await readFile('app/dist/renderer.js', 'utf8'));
  await wait('!!document.querySelector("[data-pref=next]") && !document.querySelector("[data-pref=next]").disabled');
  await click('[data-pref=next]'); await click('[data-pref=next]');
  await wait('!!document.querySelector("[data-setting=model]")');
  await evaluate('document.fonts.ready.then(()=>undefined)');
  for (const page of ['wizard', 'settings']) {
    if (page === 'settings') { await click('[data-pref=next]'); await click('[data-page=settings]'); await wait('!!document.querySelector("[data-setting=model]")'); }
    for (const [width, height] of [[960,600],[1160,720]]) {
      win.setContentSize(width, height);
      for (const theme of ['dark','light']) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const metrics = await evaluate(`(() => {
          const button=document.querySelector('[data-setting=model]'), label=button.querySelector('span'), arrow=button.querySelector('i');
          const range=document.createRange();range.selectNodeContents(label);
          return {width:button.offsetWidth,height:button.offsetHeight,lines:range.getClientRects().length,
            textFits:label.scrollWidth<=label.clientWidth,arrowInside:arrow.getBoundingClientRect().right<=button.getBoundingClientRect().right,
            pageFits:document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.wiz-body,.doc')].every(box=>box.scrollWidth<=box.clientWidth)};
        })()`);
        measurements.push({page,viewportWidth:width,viewportHeight:height,theme,...metrics});
        await writeFile(path.join(out,`${page}-${width}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
        await writeFile(path.join(out,'measurements.json'),JSON.stringify(measurements,null,2));
        assert.equal(metrics.lines,1,`${page}/${width}/${theme} 模型名必须单行`);
        assert.equal(metrics.textFits,true,`${page}/${width}/${theme} 常用模型名完整显示`);
        assert.equal(metrics.height,32,`${page}/${width}/${theme} 控件高度保持32px`);
        assert.equal(metrics.arrowInside&&metrics.pageFits,true,`${page}/${width}/${theme} 箭头与页面不能溢出`);
        checks.push(`${page}/${width}/${theme} 单行、完整模型名、固定高度与边界`);
      }
    }
  }
  win.setContentSize(960,600);
  for (const model of ['gpt-6-astra','gpt-6.1-astra']) {
    await evaluate(`sampleSettings.current.model=${JSON.stringify(model)};document.querySelector('[data-page=tasks]').click();document.querySelector('[data-page=settings]').click();`);
    await wait(`document.querySelector('[data-setting=model]')?.textContent.includes(${JSON.stringify(model)})`);
    await check('Astra 标签在最小窗口完整单行：'+model, `(() => {const b=document.querySelector('[data-setting=model]'),s=b.querySelector('span'),r=document.createRange();r.selectNodeContents(s);return r.getClientRects().length===1 && s.scrollWidth<=s.clientWidth && b.offsetWidth<=224;})()`);
  }
  const long = 'example-model-' + 'very-long-'.repeat(20);
  await evaluate(`sampleSettings.current.model=${JSON.stringify(long)}; document.querySelector('[data-page=tasks]').click();document.querySelector('[data-page=settings]').click();`);
  await wait(`document.querySelector('[data-setting=model]')?.textContent.includes(${JSON.stringify(long)})`);
  await check('超长模型名保留完整标题并单行省略', `(() => {const b=document.querySelector('[data-setting=model]'),s=b.querySelector('span'); return b.title.includes(${JSON.stringify(long)}) && getComputedStyle(s).whiteSpace==='nowrap' && getComputedStyle(s).textOverflow==='ellipsis' && s.scrollWidth>s.clientWidth;})()`);
  await click('[data-setting=model]');
  await check('超长跟随选项保持在视口内', `(() => {const m=document.querySelector('[role=listbox]'),b=m.querySelector('button'),s=b.querySelector('span');return m.getBoundingClientRect().left>=8 && m.getBoundingClientRect().right<=innerWidth-8 && s && b.title.includes(${JSON.stringify(long)}) && getComputedStyle(s).whiteSpace==='nowrap';})()`);
  const before = await evaluate('document.querySelector("[data-setting=model]").offsetWidth');
  await click('.ctx button:nth-child(2)');
  await check('自定义输入与选择框宽度一致', `document.querySelector('.model-input').offsetWidth===${before}`);
  await writeFile(path.join(out,'checks.json'),JSON.stringify({checks,measurements},null,2));
  console.log(JSON.stringify({checks:checks.length,out},null,2));
} catch (error) { console.error(error); process.exitCode=1; }
finally { win?.destroy(); await rm(htmlFile,{force:true}); await rm(profile,{recursive:true,force:true,maxRetries:5}); app.exit(process.exitCode||0); }
}
void main().catch(error => { console.error(error); app.exit(1); });
