import { c, p } from '../shared/copy';
import { esc } from '../shared/markdown';
import type { Connections, Settings } from '../shared/types';
import { icon, menu, confirmAction } from './ui';
import brand from '../../design/icons/mark.svg';

const hostName = (host: string) => host === 'claude-code' ? 'Claude Code' : 'Devin';
const mark = (state: string) => `<span class="mk ${state}">${icon(({ok:'checkbox-circle-line',warn:'error-warning-line',fail:'close-circle-line',info:'information-line',skip:'indeterminate-circle-line',run:'loader-4-line'} as Record<string,string>)[state])}</span>`;
const hint = (text: string) => `<div class="hint">${mark('info')}<span>${esc(text)}</span></div>`;
const banner = (text: string) => text ? `<div class="banner fail" role="alert">${mark('fail')}<span>${esc(text)}</span></div>` : '';
const kv = (label: string, value: string, state = 'ok', tag = '') => `<div class="kv">${mark(state)}<span class="lb">${esc(label)}</span><span class="val mono" title="${esc(value)}">${esc(value)}</span>${tag}</div>`;
const row = (label: string, description: string, control: string) => `<div class="set-r"><div class="l">${esc(label)}<span>${description}</span></div><div class="ctl">${control}</div></div>`;
const section = (title: string, description: string, body: string) => `<div class="sect"><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}${body}</div>`;

export class PreferencesView {
    settings!: Settings;
    connections?: Connections;
    wizard = false;
    step = 1;
    private selected = new Set<string>();
    private active = '';
    private version = '';
    private container?: HTMLElement;
    private detecting = false;
    private busy = false;
    private installProgress = { done: 0, total: 0 };
    private error = '';
    private hostErrors = new Map<string,string>();
    private messages = new Map<string,string>();
    private messageTimers = new Map<string,ReturnType<typeof setTimeout>>();
    constructor(private redrawShell: () => void, private redrawStatus: () => void) {}
    focusManaged() { this.container?.querySelector('#managed-section')?.scrollIntoView({block:'start'}); }
    unmount() { this.container=undefined; this.active=''; }
    async init() { this.settings = await window.dock.preferences('settings'); this.wizard = !this.settings.own.wizardDone; void this.detect(); }
    mount(container: HTMLElement, page: string, version: string) {
        this.container = container; this.active = page; this.version = version;
        this.error='';
        container.replaceChildren();
        this.render();
        container.onclick = e => { void this.click(e).catch(error => { this.error = String(error.message || error); this.render(); }); };
        if (page === 'connect') void this.detect();
        if (page === 'settings') void this.refreshSettings();
    }
    async refreshSettings() { try { this.settings = await window.dock.preferences('settings'); this.render(); this.redrawStatus(); } catch(e) { this.error=String(e); this.render(); } }
    async detect() {
        if (this.detecting) return;
        const redraw = () => { if(this.wizard || this.active==='connect') this.render(); };
        this.detecting = true; redraw();
        try { this.connections = await window.dock.preferences('detect'); }
        catch(e) { this.error = String(e); }
        finally { this.detecting = false; redraw(); }
    }
    private button(label: string, action: string, cls = '', attrs = '') { return `<button class="btn ${cls}" data-pref="${action}" ${this.busy ? 'disabled' : ''} ${attrs}>${esc(label)}</button>`; }
    private render() {
        if (!this.container?.isConnected || (!this.wizard && this.active === 'tasks')) return;
        const top = this.container.querySelector('.scroll')?.scrollTop || 0;
        this.container.innerHTML = this.wizard ? this.wizardPage() : `<div class="doc scroll"><div class="page-h sticky"><h1>${({connect:c.connect,settings:c.settings,about:c.about} as Record<string,string>)[this.active]}</h1>${this.active === 'connect' ? `<span class="lead">${p.subtitle}</span><span class="sp"></span>${this.button(p.detect,'detect','',this.detecting?'disabled':'')}` : ''}</div><div class="doc-in">${banner(this.error)}${this.active === 'connect' ? this.connectPage() : this.active === 'settings' ? this.settingsPage() : this.aboutPage()}</div></div>`;
        const scroll = this.container.querySelector('.scroll'); if(scroll) scroll.scrollTop = top;
    }
    private connectPage() {
        const data = this.connections;
        if (!data) return hint(p.detecting);
        const hosts = data.hosts.map(h => {
            const custom = h.skills.some(s=>s.state==='custom');
            const skills = h.skills.map(s => kv(s.skill, s.state === 'custom' ? p.custom : s.version || p.missing, s.state === 'custom' ? 'warn' : s.state==='missing' ? 'skip' : s.state==='update' ? 'info':s.state==='newer'?'skip':'ok', s.state==='missing' ? '' : `<span class="tag ${s.state==='custom'?'warn':s.state==='update'?'info':s.state==='newer'?'':'ok'}">${esc(s.state==='custom'?p.protected:s.state==='update'?p.update(data.availableVersion):s.state==='newer'?p.newer:p.latest)}</span>`)).join('');
            const order=['rollback','install','reinstall','replace','update'];
            const buttons = [...h.actions].sort((a,b)=>order.indexOf(a)-order.indexOf(b)).flatMap(action => action==='replace' ? h.skills.filter(s=>s.state==='custom').map(s=>this.button(p.actions[action],'host','sm',`data-host="${h.host}" data-operation="replace" data-skill="${s.skill}"`)) : [this.button(p.actions[action],'host',`sm ${action==='update'?'primary':action==='rollback'?'quiet':''}`,`data-host="${h.host}" data-operation="${action}"`)]).join('');
            const date=new Date(h.installedAt),pad=(n:number)=>String(n).padStart(2,'0');
            const installed=h.installedAt?p.lastInstall(`${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`):'';
            return `<div class="card ${!h.detected?'is-off':custom?'is-warn':''}" data-host-card="${h.host}"><div class="card-h">${icon(h.host==='devin'?'robot-2-line':'terminal-line')}<b>${hostName(h.host)}</b><span class="aside">${h.detected?mark('ok')+p.detected:p.missingHost}</span></div><div class="card-b">${h.detected?`<div class="path mono">${esc(h.root)}</div>${skills}${h.skills.some(s=>s.skill==='codex-dispatch'&&s.state==='custom')?hint(p.customHelp):''}`:hint(p.hostMissing(hostName(h.host)))}${banner(this.hostErrors.get(h.host)||'')}</div>${h.detected?`<div class="card-f"><span class="note" role="status">${esc(this.messages.get(h.host)||(custom?p.customIdle:installed))}</span>${buttons}</div>`:''}</div>`;
        }).join('');
        const a = data.codex;
        const agent = `<div class="card ${a.installed?'':'is-fail'}"><div class="card-h">${icon('terminal-box-line')}<b>Codex CLI</b><span class="aside">${mark(a.installed?'ok':'fail')}${a.installed?p.runnable:p.notFound}</span></div><div class="card-b">${a.installed?kv(p.version,a.version!)+kv(p.location,a.path||p.auto)+kv(p.login,p.loginStates[a.login],a.login==='in'?'ok':a.login==='out'?'warn':'skip'):kv(p.version,p.codexMissing,'fail')+hint(p.codexHelp)}${a.change?hint(p.versionChange(a.change.old,a.change.next))+this.button(p.ack,'ack','sm quiet'):''}</div><div class="card-f">${a.path?this.button(p.reset,'reset','sm quiet'):''}${this.button(p.choose,'choose','sm')}${!a.installed?this.button(p.detect,'detect','sm primary'):''}</div></div>`;
        return section(p.dispatchers,p.dispatchHelp,`<div class="cards2">${hosts}</div>`)+section(p.workers,p.workerHelp,agent);
    }
    private description(key: string, fallback = '') { const o=this.settings.overrides[key]; return o?`<span class="override">${esc(p.override(o.name,o.value))}</span>`:esc(fallback); }
    private defaults(sandbox = true) {
        const rows = ['model','effort','tier'].map(key=>row(key==='model'?c.model:key==='effort'?c.effort:p.tier,this.description(key,key==='model'&&!this.settings.values.model?p.currentHelp:''),`<button class="sel" data-setting="${key}" aria-haspopup="listbox" aria-expanded="false" ${this.settings.reason||this.busy?'disabled':''}><span class="${this.settings.values[key]?'mono':'ph'}">${esc(this.settings.values[key]||p.follow(this.settings.current[key]))}</span>${icon('arrow-down-s-line')}</button>`));
        if(sandbox) rows.push(row(c.sandbox,this.description('sandbox',p.sandboxHelp),this.segment('sandbox',['workspace-write','read-only'],[p.writable,p.readonly],this.settings.values.sandbox!)));
        return `<div class="set">${rows.join('')}</div>`;
    }
    private segment(key: string, values: string[], labels: string[], selected: string, icons?: string[]) {
        return `<div class="segm ${icons?'icons':''}">${values.map((v,i)=>`<button data-segment="${key}" data-value="${v}" class="${selected===v?'on':''}" aria-pressed="${selected===v}" title="${labels[i]}" aria-label="${labels[i]}" ${this.busy||this.settings.reason&&key!=='theme'?'disabled':''}>${icons?icon(icons[i]):labels[i]}</button>`).join('')}</div>`;
    }
    private managedToggle(wizard = false) {
        return `<div class="set">${row(wizard?p.wizardManaged:p.managedToggle,esc(wizard?p.wizardManagedHelp:p.managedToggleHelp),`<button class="toggle ${this.settings.managed?'on':''}" data-pref="managed" role="switch" aria-label="${wizard?p.wizardManaged:p.managedToggle}" aria-checked="${this.settings.managed}" ${this.busy||this.settings.reason?'disabled':''}></button>`)}</div>`;
    }
    private settingsPage() {
        return section(p.defaults,p.defaultsHelp,this.defaults())+
        `<div id="managed-section">${section(p.managed,p.managedHelp,this.managedToggle())}</div>`+
        section(p.watch,'',`<div class="set">${row(p.watchTitle,this.description('watchWindow',p.watchHelp),this.segment('watchWindow',['auto','always','never'],p.watchOptions,this.settings.values.watchWindow!))}</div>`)+
        section(p.notifications,'',`<div class="set">${row(p.notify,esc(p.notifyHelp),`<button class="toggle ${this.settings.own.notifications?'on':''}" data-pref="notifications" role="switch" aria-label="${p.notify}" aria-checked="${this.settings.own.notifications}" ${this.busy?'disabled':''}></button>`)}</div>`)+
        section(p.appearance,'',`<div class="set">${row(p.theme,'',this.segment('theme',['system','light','dark'],p.themes,this.settings.own.theme,['computer-line','sun-line','moon-line']))}</div>`)+
        section(p.config,'',banner(this.settings.reason?p.configError(this.settings.reason):'')+`<div class="set">${row(p.location,`<span class="mono">${esc(this.settings.file)}</span>`,this.button(p.openFolder,'folder','sm quiet'))}</div>`);
    }
    private aboutPage() { return `<div class="sect about"><div class="about-mark">${brand}</div><h2>${c.app}</h2><p class="mono">${esc(this.version)}</p><p>${c.protocol}</p><p>${p.about}</p>${this.button(p.rerun,'wizard')}</div>`; }
    private wizardPage() {
        const steps=p.steps.map((label,i)=>`<span class="${this.step===i+1?'on':this.step>i+1?'done':''}"><b>${this.step>i+1?icon('check-line'):i+1}</b>${label}</span>`).join('<span class="ln"></span>');
        let body='';
        if(this.step===1) body=`<h1>${p.welcome}</h1><p>${p.welcomeHelp}</p><div class="card"><div class="card-b">${['claude-code','devin'].map(host=>{const h=this.connections?.hosts.find(h=>h.host===host);return kv(hostName(host),this.detecting?p.detecting:h?.detected?h.root:p.missingHost,this.detecting?'run':h?.detected?'ok':'skip');}).join('')}${kv('Codex CLI',this.detecting?p.detecting:this.connections?.codex.version||p.codexMissing,this.detecting?'run':this.connections?.codex.installed?'ok':'fail')}</div></div>`;
        if(this.step===2) body=`<h1>${p.installSkills}</h1><p>${p.installHelp}</p>${this.connections?.hosts.filter(h=>h.detected).flatMap(h=>h.skills.map(s=>{const key=h.host+'/'+s.skill,on=this.selected.has(key);return `<button class="choice" role="checkbox" aria-checked="${on}" data-choice="${key}" ${this.busy||s.state==='newer'?'disabled':''}><span class="cb ${on?'on':''}">${on?icon('check-line'):''}</span><span class="ct">${hostName(h.host)} · ${s.skill}<span>${s.state==='custom'?p.customChoice:p.skillHelp[s.skill]}</span></span>${s.state==='latest'||s.state==='custom'||s.state==='newer'?`<span class="tag ${s.state==='custom'?'warn':''}">${esc(s.state==='latest'?p.wizardLatest:s.state==='custom'?p.wizardCustom:p.newer)}</span>`:''}</button>`;})).join('')||''}${this.busy?`<div class="hint" role="status">${mark('run')}<span>${p.installing} <span class="mono">${this.installProgress.done}/${this.installProgress.total}</span></span></div>`:''}`;
        if(this.step===3) body=`<h1>${p.defaults}</h1><p>${p.wizardDefaults}</p>${this.settings.reason?banner(p.configError(this.settings.reason)):''}${this.defaults(false)}${this.managedToggle(true)}`;
        return `<div class="wiz"><div class="wiz-steps">${steps}</div><div class="wiz-body scroll">${banner(this.error)}${body}</div><div class="wiz-f">${this.step>1?this.button(p.previous,'previous','quiet'):''}<span class="sp"></span>${this.button(p.skip,'skip','quiet')}${this.button(this.step===3?p.finish:this.step===2?p.installNext:p.next,'next','primary',this.detecting||this.step===3&&this.settings.reason?'disabled':'')}</div></div>`;
    }
    private async save(key: string, value: string|boolean|null, own = false) {
        this.busy=true; this.error=''; this.render();
        try { this.settings=await window.dock.preferences(own?'own':'save',{key,value}); }
        catch(e) { this.error=String((e as Error).message||e); }
        finally { this.busy=false; this.render(); this.redrawStatus(); }
    }
    private async click(e: MouseEvent) {
        const b=(e.target as Element).closest<HTMLButtonElement>('button'); if(!b||b.disabled||this.busy) return;
        const d=b.dataset;
        if(d.setting) {
            const key=d.setting;
            menu(b,[{label:p.follow(this.settings.current[key]),run:()=>{void this.save(key,null);}},...(key==='model'?[{label:p.customModel,run:()=>this.modelInput(b)}]:(key==='effort'?['minimal','low','medium','high','xhigh']:['default','priority','flex']).map(value=>({label:value,run:()=>{void this.save(key,value);}})))],true); return;
        }
        if(d.segment) { await this.save(d.segment,d.value!,d.segment==='theme'); return; }
        if(d.choice) { this.selected.has(d.choice)?this.selected.delete(d.choice):this.selected.add(d.choice); this.render(); return; }
        if(d.pref==='managed') { await this.save('managed',!this.settings.managed); return; }
        if(d.pref==='detect') return this.detect();
        if(d.pref==='folder') return window.dock.preferences('openConfig');
        if(d.pref==='notifications') { this.settings=await window.dock.preferences('own',{key:'notifications',value:!this.settings.own.notifications}); this.render(); }
        if(d.pref==='choose') { const result=await window.dock.preferences('choosePath'); if(result) { this.settings=result; await this.detect(); } }
        if(d.pref==='reset') { await this.save('path',null); await this.detect(); }
        if(d.pref==='ack') { this.connections=await window.dock.preferences('ack'); this.render(); }
        if(d.pref==='wizard') { this.wizard=true; this.step=1; this.error=''; this.redrawShell(); await this.detect(); }
        if(d.pref==='skip') await this.finish(false);
        if(d.pref==='previous') { this.step--; this.error=''; this.render(); }
        if(d.pref==='next') {
            if(this.step===3) return this.finish(true);
            if(this.step===1) { this.selected=new Set(this.connections?.hosts.filter(h=>h.detected).flatMap(h=>h.skills.filter(s=>s.checked).map(s=>h.host+'/'+s.skill))); this.step=2; this.error=''; this.render(); return; }
            this.busy=true; this.installProgress={done:0,total:this.selected.size}; this.error=''; this.render();
            try {
                for(const h of this.connections!.hosts.filter(h=>h.detected)) {
                    const skills=h.skills.filter(s=>this.selected.has(h.host+'/'+s.skill)).map(s=>s.skill);
                    if(skills.length) {
                        const result=await window.dock.preferences('install',{host:h.host,operation:'selected',skills});
                        this.installProgress.done+=result.changed.length;
                        for(const skill of skills)this.selected.delete(h.host+'/'+skill);
                        this.render();
                    }
                }
                this.step=3;
            } catch(e) { this.error=String((e as Error).message||e); }
            finally { this.busy=false; await this.refreshSettings(); }
        }
        if(d.pref==='host') {
            if(d.operation==='rollback'&&!await confirmAction(p.rollbackTitle(hostName(d.host!)),p.rollbackBody,p.actions.rollback,b)) return;
            if(d.operation==='replace'&&!await confirmAction(p.replaceTitle(d.skill!),p.replaceBody,p.replace,b,true)) return;
            this.busy=true; this.hostErrors.delete(d.host!); this.render();
            try {
                const result=await window.dock.preferences('install',{host:d.host,operation:d.operation,...(d.skill?{skills:[d.skill]}:{})});
                this.messages.set(d.host!,d.operation==='rollback'?p.rolledBack:p.installed(result.changed.length));
                clearTimeout(this.messageTimers.get(d.host!));
                this.messageTimers.set(d.host!,setTimeout(()=>{this.messages.delete(d.host!);this.messageTimers.delete(d.host!);if(!this.wizard&&this.active==='connect')this.render();},3000));
            } catch(e) { this.hostErrors.set(d.host!,String((e as Error).message||e)); }
            finally { this.busy=false; await this.detect(); }
        }
    }
    private modelInput(button: HTMLElement) {
        const input=document.createElement('input'); input.className='model-input mono'; input.value=this.settings.values.model||''; input.setAttribute('aria-label',c.model); button.replaceWith(input);
        let saved=false;
        const commit=()=>{if(saved)return;saved=true;void this.save('model',input.value.trim()||null);};
        input.onblur=commit; input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){saved=true;this.render();}};
        input.focus(); input.select();
    }
    private async finish(configure: boolean) {
        this.settings=await window.dock.preferences('finish',{configure}); this.wizard=false; this.error=''; this.redrawShell();
    }
}
