import { app, nativeTheme, type BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function capturePackaged(win: BrowserWindow, out: string) {
    assert.ok(app.isPackaged, '必须使用打包程序验收');
    const home = process.env.CODEX_DISPATCH_HOME!;
    for (const key of ['USERPROFILE', 'HOME', 'APPDATA', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) {
        assert.ok(process.env[key], `${key} 必须隔离`);
        const relative = path.relative(home, process.env[key]!);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    }
    const evaluate = (code: string) => win.webContents.executeJavaScript(code);
    const wait = async (code: string) => {
        for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
        throw Error(`打包验收等待超时：${code}`);
    };
    const click = async (selector: string) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
    await wait('!!document.querySelector(".wiz") && !document.querySelector("[data-pref=next]").disabled');
    await click('[data-pref=next]');
    await wait('document.querySelectorAll("[data-choice][aria-checked=true]").length === 4');
    await click('[data-pref=next]');
    await wait('!!document.querySelector("[data-setting=model]")');
    await click('[data-pref=next]');
    await wait('!!document.querySelector("[data-task=t1]")');
    assert.equal(await evaluate('document.querySelectorAll("[data-task]").length'), 10);
    await click('[data-page=connect]');
    await wait('!!document.querySelector("[data-operation=reinstall][data-host=claude-code]")');
    await click('[data-operation=reinstall][data-host=claude-code]');
    await wait('document.querySelector("[data-host-card=claude-code] .note").textContent.includes("已安装 2 个")');
    const hosts = [path.join(process.env.CLAUDE_CONFIG_DIR!, 'skills'), path.join(process.env.APPDATA!, 'devin', 'skills')];
    const installed = [];
    for (const host of hosts) for (const skill of ['codex-dispatch', 'dual-role-workflow']) {
        const record = JSON.parse(await readFile(path.join(host, skill, '.dispatchdock.json'), 'utf8'));
        assert.equal(record.version, app.getVersion());
        assert.ok((await readFile(path.join(host, skill, 'SKILL.md'), 'utf8')).length > 0);
        installed.push({ host: host === hosts[0] ? 'claude-code' : 'devin', skill, version: record.version });
    }
    assert.deepEqual(await readFile(path.join(hosts[0], 'codex-dispatch', 'codex-task.mjs')), await readFile(path.join(__dirname, 'skills', 'codex-dispatch', 'codex-task.mjs')));
    await click('[data-page=tasks]'); await click('[data-task=t1]');
    nativeTheme.themeSource = 'dark';
    await evaluate('document.fonts.ready');
    assert.equal(await evaluate('document.fonts.check(\'13px "DispatchDock MiSans"\') && [...document.fonts].some(f=>f.family.includes("DispatchDock MiSans") && f.status==="loaded")'), true);
    // 查询实际绘制所用字体，避免只检查 CSS 声明而漏掉系统字体回退。
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-task=t1] .tm b' });
    const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some((font: any) => /MiSans/i.test(font.familyName) && font.isCustomFont && font.glyphCount > 0));
    win.webContents.debugger.detach();
    assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(home)})`), false);
    await mkdir(out, { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 400));
    await writeFile(path.join(out, 'packaged.png'), (await win.webContents.capturePage()).toPNG());
    const fontHash = createHash('sha256').update(await readFile(path.join(__dirname, 'fonts/MiSansVF.ttf'))).digest('hex');
    const evidence = { packaged: app.isPackaged, version: app.getVersion(), tasks: 10, wizardInstall: true, connectionReinstall: true, installed, fonts, fontHash };
    await writeFile(path.join(out, 'packaged.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
}
