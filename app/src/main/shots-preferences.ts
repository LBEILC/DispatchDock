import { readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { nativeTheme } from 'electron';

interface Harness {
    evaluate: (expression: string) => Promise<any>;
    wait: (expression: string) => Promise<void>;
    check: (label: string, expression: string) => Promise<void>;
    click: (selector: string) => Promise<void>;
    save: (name: string) => Promise<void>;
}
export async function captureWizard({evaluate,wait,check,click,save}: Harness) {
    await wait('!!document.querySelector(".wiz") && !document.querySelector("[data-pref=next]").disabled');
    await evaluate('document.fonts.ready');
    nativeTheme.themeSource='dark';
    await check('首次引导期间侧栏不可点击','[...document.querySelectorAll("[data-page]")].every(b=>b.disabled)');
    await save('wizard-1-dark');
    await click('[data-pref=next]');
    await check('引导只默认勾选未安装或可更新的技能',`document.querySelectorAll('[data-choice][aria-checked=true]').length===1 && document.querySelector('[data-choice="devin/dual-role-workflow"]').getAttribute('aria-checked')==='true'`);
    await save('wizard-2-dark');
    await click('[data-pref=next]');
    await wait('!!document.querySelector("[data-setting=model]")');
    await save('wizard-3-dark');
    await check('引导第三步托管默认关闭','document.querySelector("[data-pref=managed]").getAttribute("aria-checked")==="false"');
    await click('[data-pref=managed]');
    await check('引导开关写入共享配置并保持引导界面','!!document.querySelector(".wiz") && document.querySelector("[data-pref=managed]").getAttribute("aria-checked")==="true" && !document.querySelector(".banner.fail") && window.dock.preferences("settings").then(s=>s.managed===true)');
    await click('[data-pref=managed]');
    await click('[data-pref=next]');
    await wait('!!document.querySelector("[data-task]")');
    const s=await evaluate('window.dock.preferences("settings")');
    assert.equal(s.exists,true); assert.equal(s.own.wizardDone,true); assert.equal(s.values.model,null);
}

export async function capturePreferences(h: Harness) {
    const {evaluate,wait,check,click,save}=h;
    const home=process.env.CODEX_DISPATCH_HOME!, user=process.env.USERPROFILE!, claude=process.env.CLAUDE_CONFIG_DIR!, appdata=process.env.APPDATA!;
    // 截图工具只允许使用启动器创建的隔离树。
    for(const dir of [user,claude,appdata]) { const rel=path.relative(home,dir); assert.ok(!rel.startsWith('..')&&!path.isAbsolute(rel)); }
    const devin=process.platform==='win32'?path.join(appdata,'devin'):path.join(user,'.config','devin');
    const marker=path.join(claude,'skills','codex-dispatch','.dispatchdock.json');
    const originalMarker=await readFile(marker,'utf8');
    const agent=path.join(home,'fake-codex.json');
    const config=path.join(home,'config.json');
    assert.equal((await evaluate('window.dock.preferences("settings")')).file,config,'临时公共目录显示完整配置路径');
    const refresh=async()=>{await click('[data-pref=detect]');await wait('!document.querySelector("[data-pref=detect]").disabled');};
    const settings=async()=>{await click('[data-page=tasks]');await click('[data-page=settings]');await wait('!!document.querySelector("[data-setting=model]")');};
    nativeTheme.themeSource='dark';
    await click('[data-page=connect]');await wait('!!document.querySelector("[data-host-card]") && !document.querySelector("[data-pref=detect]").disabled');
    await save('connect-normal-dark');nativeTheme.themeSource='light';await save('connect-normal-light');nativeTheme.themeSource='dark';
    await check('连接页通过假 Codex 检测版本和登录状态','document.querySelector(".doc-in").textContent.includes("codex-cli 0.156.1") && document.querySelector(".doc-in").textContent.includes("已登录")');
    await writeFile(marker,JSON.stringify({...JSON.parse(originalMarker),version:'0.0.1'}));
    await writeFile(agent,JSON.stringify({version:'codex-cli 0.157.0',loggedIn:true}));
    await refresh();await save('connect-update-dark');
    await check('更新状态与版本变更提示','!!document.querySelector("[data-operation=update]") && !!document.querySelector("[data-pref=ack]")');
    await click('[data-pref=ack]');await refresh();
    await check('知道了以后重新检测不重复提示','!document.querySelector("[data-pref=ack]")');
    await click('[data-operation=update][data-host=claude-code]');await wait('!!document.querySelector("[data-operation=reinstall][data-host=claude-code]")');
    await check('更新操作完成后显示数量','document.querySelector("[data-host-card=claude-code] .note").textContent.includes("已安装 1 个")');
    await wait('!document.querySelector("[data-host-card=claude-code] .note").textContent.includes("已安装")');
    await check('安装结果三秒后恢复上次安装时间','document.querySelector("[data-host-card=claude-code] .note").textContent.startsWith("上次安装 ")');
    await writeFile(marker,JSON.stringify({...JSON.parse(originalMarker),version:'9.0.0'}));await refresh();
    await check('较新版本用中性标签且禁止更新和重装','document.querySelector("[data-host-card=claude-code]").textContent.includes("比软件自带的新") && !document.querySelector("[data-host=claude-code][data-operation=update]") && !document.querySelector("[data-host=claude-code][data-operation=reinstall]") && [...document.querySelectorAll("[data-host-card=claude-code] .tag")].some(t=>t.textContent==="比软件自带的新" && t.className.trim()==="tag")');
    await save('connect-newer-dark');
    await rm(marker);await refresh();await save('connect-custom-dark');
    await check('自改版本静态说明','document.querySelector("[data-host-card=claude-code] .note").textContent==="替换前会备份"');
    await click('[data-operation=replace]');
    await check('替换技能默认焦点在取消且使用危险按钮','document.activeElement.textContent==="取消" && !!document.querySelector(".confirm-actions .danger")');
    await click('.confirm-actions .btn');
    await click('[data-page=about]');await click('[data-pref=wizard]');await wait('!document.querySelector("[data-pref=next]").disabled');await click('[data-pref=next]');
    await check('自己改过的版本默认不勾选',`document.querySelector('[data-choice="claude-code/codex-dispatch"]').getAttribute('aria-checked')==='false'`);
    await check('引导第二步显示最新、自改状态与备份说明',`document.querySelector('[data-choice="claude-code/codex-dispatch"]').textContent.includes("已有自己改过的版本，勾选后会先备份再替换") && document.querySelector('[data-choice="claude-code/codex-dispatch"] .tag').textContent==="自己改过的版本" && [...document.querySelectorAll("[data-choice] .tag")].some(t=>t.textContent==="已是最新")`);
    await save('wizard-2-custom-dark');
    await click('[data-pref=skip]');await click('[data-page=connect]');await wait('!!document.querySelector("[data-operation=replace]")');
    await click('[data-operation=replace]');await click('.confirm-actions .danger');await wait('!!document.querySelector("[data-operation=reinstall][data-host=claude-code]")');
    await click('[data-operation=rollback][data-host=claude-code]');await click('.confirm-actions .primary');await wait('!!document.querySelector("[data-operation=replace]")');
    await check('回退还原自用版，操作只影响选中宿主','!!document.querySelector("[data-operation=reinstall][data-host=devin]")');
    await writeFile(marker,originalMarker);
    await rename(devin,devin+'-hidden');
    try {
        await writeFile(agent,JSON.stringify({missing:true}));await refresh();await save('connect-nocodex-dark');
        await check('缺少 Codex 和未检测到宿主的样式','!!document.querySelector(".card.is-fail") && !!document.querySelector("[data-host-card=devin].is-off")');
    } finally {await rename(devin+'-hidden',devin);await writeFile(agent,JSON.stringify({version:'codex-cli 0.157.0',loggedIn:true}));}
    await rm(config,{force:true});await settings();await save('settings-unconfigured-dark');
    // 用真实控件写入，不替换 preload 或渲染器 API。
    await click('[data-setting=model]');await click('.ctx button:nth-child(2)');
    await wait('!!document.querySelector(".model-input")');
    await evaluate('(()=>{const input=document.querySelector(".model-input");input.value="gpt-x-large";input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));})()');
    await wait('document.querySelector("[data-setting=model]")?.textContent.includes("gpt-x-large")');
    assert.equal(JSON.parse(await readFile(config,'utf8')).agents.codex.model,'gpt-x-large');
    await check('自定义模型隐藏跟随配置说明','!document.querySelector("[data-setting=model]").closest(".set-r").textContent.includes("括号里")');
    await click('[data-setting=effort]');await click('.ctx button:nth-child(5)');
    await click('[data-setting=tier]');await click('.ctx button:nth-child(2)');
    await check('环境变量覆盖在对应行说明','document.querySelector("[data-setting=tier]").closest(".set-r").textContent.includes("环境变量 CODEX_TIER 正在覆盖这一项（priority）")');
    await save('settings-configured-dark');nativeTheme.themeSource='light';await save('settings-configured-light');nativeTheme.themeSource='dark';
    await click('[data-managed-settings]');
    await check('侧栏入口滚动到托管设置','document.querySelector("#managed-section").getBoundingClientRect().top>=document.querySelector(".page-h").getBoundingClientRect().bottom-1');
    await save('settings-managed-off-dark');
    await click('[data-pref=managed]');
    assert.equal(JSON.parse(await readFile(config,'utf8')).managed,true);
    await check('托管开关立即更新侧栏','document.querySelector("[data-pref=managed]").getAttribute("aria-checked")==="true" && document.querySelector(".nav-foot").textContent.includes("托管已开启")');
    await save('settings-managed-on-dark');
    await click('[data-page=tasks]');await click('[data-task=t6]');
    await check('托管开启后中断横幅不再显示设置按钮','!document.querySelector(".banner [data-managed-settings]")');
    await click('[data-managed-settings]');await click('[data-pref=managed]');
    assert.equal(JSON.parse(await readFile(config,'utf8')).managed,false);
    await click('[data-page=tasks]');await click('[data-task=t6]');
    await check('非手动中断提供去设置按钮','document.querySelector(".banner [data-managed-settings]")?.textContent==="去设置"');
    await click('.banner [data-managed-settings]');
    await check('中断横幅入口定位托管设置','!!document.querySelector("#managed-section") && document.querySelector("#managed-section").getBoundingClientRect().top>=document.querySelector(".page-h").getBoundingClientRect().bottom-1');
    await evaluate('document.querySelector(".doc.scroll").scrollTop=10000');
    await save('settings-configured-bottom-dark');
    await check('设置页底部包含主题、通知与配置路径','!!document.querySelector("[data-segment=theme]") && !!document.querySelector("[data-pref=notifications]") && !!document.querySelector("[data-pref=folder]") && !!document.querySelector("[data-pref=managed]")');
    await evaluate('document.querySelector(".doc.scroll").scrollTop=0');
    // 打开控件之后文件被外部破坏：写入必须失败并恢复界面原值。
    await writeFile(config,'invalid');await click('[data-setting=tier]');await click('.ctx button:nth-child(3)');
    await check('写入失败恢复原值并显示原因','document.querySelector("[data-setting=tier]").textContent.trim()==="default" && !!document.querySelector(".banner.fail")');
    assert.equal(await readFile(config,'utf8'),'invalid');
    await settings();await save('settings-invalid-top-dark');
    await evaluate('document.querySelector(".doc.scroll").scrollTop=10000');
    await save('settings-invalid-dark');
    await check('无效配置禁用派发参数与进度窗口控件','[...document.querySelectorAll("[data-setting], [data-segment=watchWindow], [data-segment=sandbox]")].every(b=>b.disabled) && document.querySelector(".doc-in").textContent.includes("修好或删掉")');
    await rm(config);await settings();
    await click('[data-pref=notifications]');
    await check('通知偏好单独保存','window.dock.preferences("settings").then(s=>s.own.notifications===false && s.exists===false)');
    await click('[data-segment=theme][data-value=light]');
    await check('外观设置立即同步主题','document.documentElement.dataset.theme==="light"');
    await click('[data-segment=theme][data-value=dark]');
    await click('[data-page=about]');await save('about-dark');
    await check('关于页品牌尺寸与协议版本','document.querySelector(".about-mark").getBoundingClientRect().width===48 && document.querySelector(".about").textContent.includes("文件协议 v1")');
    const fontExists=await stat(path.join(__dirname,'fonts/MiSansVF.ttf')).then(()=>true,()=>false);
    if(fontExists) await check('截图已加载随包 MiSans','document.fonts.check(\'13px "DispatchDock MiSans"\') && [...document.fonts].some(f=>f.family.includes("DispatchDock MiSans") && f.status==="loaded")');
    return fontExists;
}
