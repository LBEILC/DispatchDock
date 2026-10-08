import { c } from '../shared/copy';
import type { Task, Snapshot, Event as TaskEvent } from '../shared/types';
import { esc, markdown } from '../shared/markdown';
import { icon, menu, confirmStop, tooltips, notice } from './ui';
import { installScrollMaterial } from './floatingThumb';
import { Timeline } from './timeline';
import { PreferencesView } from './preferences';
import brandSVG from '../../design/icons/mark.svg';
const root = document.querySelector<HTMLElement>('#app')!;
const brand = brandSVG.replace('<svg ', '<svg aria-hidden="true" ');
const marks = { run: ['run', 'loader-4-line'], done: ['ok', 'checkbox-circle-line'], fail: ['fail', 'close-circle-line'], stop: ['warn', 'stop-circle-line'] };
const mark = (s: Task['status']) => `<span class="mk ${marks[s][0]}">${icon(marks[s][1])}</span>`;
const project = (t: Task) => t.repo.split(/[\\/]/).filter(Boolean).at(-1)!;
const host = (t: Task) => t.dispatcher?.host === 'claude-code' ? 'Claude Code' : t.dispatcher?.host === 'devin' ? 'Devin' : c.unknownHost;
const clock = (n: number) => new Date(n).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const elapsed = (t: Task) => { const seconds = Math.max(0, Math.floor((Date.now() - t.started) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
let state: Snapshot = { tasks: [], theme: 'dark', version: '0.1.0' }, page = 'tasks', filter = 'all', repo = '', selected = '', tab = 'flow', think = false, timeline: Timeline | undefined, report = '', generation = 0, loading = false, queued = false, detailSignature = '';
const preferences = new PreferencesView(() => { nav(); pageView(); }, () => { nav(); if(page==='tasks'&&!preferences.wizard) header(); });
const current = () => state.tasks.find(t => t.id === selected);
const headerKey = (t: Task) => JSON.stringify([t.id, t.title, t.status, t.role, t.started, t.ended, t.minutes, t.exit, t.signal, t.commit, t.dispatcher?.host,t.managed,preferences.settings?.managed]);
const action = (name: string, value?: string) => window.dock.action(selected, name, value).catch(notice);
function shell() { root.innerHTML = `<div class="tb-l">${brand}${c.app}</div><div class="tb-r"></div><nav class="nav"></nav><section class="content"></section>`; nav(); pageView(); }
function nav() { const running = state.tasks.filter(t => t.status === 'run').length; root.querySelector('.nav')!.innerHTML = [['tasks', 'stack-line', c.tasks], ['connect', 'plug-line', c.connect], ['sp', '', ''], ['settings', 'settings-3-line', c.settings], ['about', 'information-line', c.about]].map(([key, i, label]) => key === 'sp' ? '<span class="sp"></span>' : `<button ${preferences.wizard ? 'disabled' : ''} data-page="${key}" ${page === key ? 'aria-current="page"' : ''}>${icon(i)}${label}${key === 'tasks' && running ? `<span class="count">${running}</span>` : ''}</button>`).join('') + `<div class="nav-foot"><div><span class="dot ${running ? 'run' : 'ok'}"></span>${c.running(running)}</div><button data-managed-settings ${preferences.wizard?'disabled':''}>${icon('shield-check-line')}${preferences.settings?.managed?c.managedOn:c.managedOff}</button></div>`; }
function pageView() {
    const content = root.querySelector<HTMLElement>('.content')!;
    generation++;
    timeline = undefined;
    loading = false;
    content.onclick = null;
    preferences.unmount();
    if (preferences.wizard || page !== 'tasks') {
        preferences.mount(content as HTMLElement, page, state.version);
        return;
    }
    content.innerHTML = '<div class="page-h"></div><div class="split"><div class="edge"><div class="tlist scroll"></div></div><div class="detail"></div></div>';
    list();
    detail();
}
function list() {
    if (page !== 'tasks' || preferences.wizard)
        return;
    const count = (key: string) => state.tasks.filter(t => (!repo || t.repo === repo) && (key === 'all' || key === 'run' && t.status === 'run' || key === 'issues' && ['fail', 'stop'].includes(t.status))).length;
    root.querySelector('.page-h')!.innerHTML = `<h1>${c.tasks}</h1><div class="segm">${[['all', c.all], ['run', c.status.run], ['issues', c.issues]].map(([key, label]) => `<button data-filter="${key}" class="${filter === key ? 'on' : ''}">${label} <span class="n">${count(key)}</span></button>`).join('')}</div><button class="sel" data-project aria-haspopup="listbox" aria-expanded="false"><span class="ph">${esc(repo ? repo.split(/[\\/]/).at(-1) : c.projects)}</span>${icon('arrow-down-s-line')}</button><span class="sp"></span><button class="btn icon quiet" data-import data-tip="${c.import}" aria-label="${c.import}">${icon('folder-add-line')}</button>`;
    const tasks = state.tasks.filter(t => (!repo || repo === t.repo) && (filter === 'all' || filter === 'run' && t.status === 'run' || filter === 'issues' && ['fail', 'stop'].includes(t.status)));
    if (selected && !tasks.some(t => t.id === selected)) {
        selected = '';
        detailSignature = '';
        detail();
    }
    const groups = new Map<string, Task[]>();
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    for (const t of [...tasks].sort((a, b) => Number(b.status === 'run') - Number(a.status === 'run') || b.started - a.started)) {
        const day = t.status === 'run' ? c.status.run : t.started >= today ? c.today : t.started >= yesterday ? c.yesterday : new Date(t.started).toLocaleDateString('zh-CN');
        groups.set(day, [...(groups.get(day) ?? []), t]);
    }
    const box = root.querySelector<HTMLElement>('.tlist')!, scroll = box.scrollTop;
    box.innerHTML = tasks.length ? [...groups].map(([day, rows]) => `<div class="tgroup">${day}<span class="mono">${day === c.status.run ? rows.length : new Date(rows[0].started).toLocaleDateString('en-CA', { month: '2-digit', day: '2-digit' })}</span></div>${rows.map(t => { const tail = t.imported ? c.imported : t.status === 'run' ? t.last : t.status === 'fail' ? `exit=${t.exit}` : t.status === 'stop' ? (t.signal === 'stopped-by-app' ? c.stoppedShort : c.closed) : t.commit ?? (t.sandbox === 'read-only' ? c.readonly : ''); return `<button class="trow is-${t.status === 'run' ? 'running' : t.status} ${selected === t.id ? 'on' : ''}" data-task="${esc(t.id)}">${mark(t.status)}<span class="tm"><b>${esc(t.title)}</b><span class="${t.status === 'run' ? 'live' : ''}">${esc(project(t))}${tail ? ' · ' + esc(tail) : ''}</span></span><span class="ts"><span class="mono" ${t.status === 'run' ? `data-elapsed="${esc(t.id)}"` : ''}>${t.status === 'run' ? elapsed(t) : clock(t.started)}</span></span></button>`; }).join('')}`).join('') : `<div class="empty">${icon('stack-line')}<b>${c.empty}</b><p>${c.emptyHelp}</p></div>`;
    box.scrollTop = scroll;
}
function detail() {
    const box = root.querySelector<HTMLElement>('.detail');
    if (!box)
        return;
    generation++;
    timeline = undefined;
    loading = false;
    report = '';
    const t = current();
    if (!t) {
        box.innerHTML = `<div class="empty">${icon('file-list-3-line')}<b>${state.tasks.length ? c.select : c.emptyDetail}</b><p>${c.detailHelp}</p></div>`;
        return;
    }
    box.innerHTML = '<div class="dh"></div><div class="dtabs"></div><div class="banner-holder"></div><div class="dbody edge"><div class="scroll" tabindex="0"><div class="tab-body"></div></div><button class="plan-compact plan-h" data-plan-top hidden></button><button class="btn sm follow" data-latest hidden></button></div>';
    header();
    const viewport = box.querySelector<HTMLElement>('.dbody > .scroll')!;
    viewport.addEventListener('scroll', () => { if (!timeline || tab !== 'flow')
        return; const near = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 32; if (!near)
        timeline.follow = false;
    else if (timeline.events.length)
        timeline.follow = true; timeline.render(); followButton(); }, { passive: true });
    renderTab();
    void refreshDetail();
}
function header() {
    const t = current();
    if (!t)
        return;
    detailSignature = headerKey(t);
    root.querySelector('.dh')!.innerHTML = `<div class="dh-1"><h2>${esc(t.title)}</h2>${t.managed?`<span class="tag">${c.managed}</span>`:''}<span class="acts">${t.status === 'run' ? `<button class="btn sm danger" data-stop>${icon('stop-circle-line')}${c.stop}</button>` : ''}<button class="btn icon quiet" data-more data-tip="${c.more}" aria-label="${c.more}" aria-haspopup="menu">${icon('more-2-fill')}</button></span></div><div class="dh-2"><span class="dh-state ${marks[t.status][0]}">${mark(t.status)}${c.status[t.status]}${t.status === 'run' ? ` · <span data-elapsed="${esc(t.id)}">${elapsed(t)}</span>` : t.status === 'done' ? ` · ${c.elapsed} ${t.minutes ?? '—'} ${c.minutes}` : t.status === 'fail' ? ` · exit=${t.exit}` : ''}</span><span>${icon('folder-3-line')}${esc(project(t))}</span><span>${icon('user-3-line')}${esc(host(t))}${t.role ? ' · ' + esc(t.role) : ''}</span><span>${icon('time-line')}${clock(t.started)} ${c.started}</span>${t.commit ? `<span>${icon('git-commit-line')}<span class="mono">${t.commit}</span></span>` : ''}</div>`;
    root.querySelector('.banner-holder')!.innerHTML = ['fail', 'stop'].includes(t.status) ? `<div class="banner ${t.status === 'fail' ? 'fail' : 'warn'}">${mark(t.status)}<div class="rt"><b>${esc(t.status === 'fail' ? c.failedTitle(t.exit) : t.signal === 'stopped-by-app' ? c.stopped : c.interruptedTitle)}</b><span>${t.status === 'fail' ? c.failedHelp : t.signal === 'stopped-by-app' ? c.stoppedHelp : c.interruptedHelp}</span></div>${t.status==='stop'&&t.signal!=='stopped-by-app'&&!preferences.settings?.managed?`<button class="btn sm" data-managed-settings>${c.goSettings}</button>`:''}</div>` : '';
    tabs();
}
function tabs() {
    const files = changedFiles().size, bar = root.querySelector<HTMLElement>('.dtabs')!;
    if (!bar.children.length)
        bar.innerHTML = `<div class="segm sm">${[['flow', c.flow], ['report', c.report], ['files', c.files], ['params', c.params]].map(([key, label]) => `<button data-tab="${key}">${label}</button>`).join('')}</div><span class="sp"></span><span class="hint">${c.think}<button class="toggle" data-think role="switch" aria-label="${c.think}"></button></span>`;
    for (const button of bar.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
        button.classList.toggle('on', button.dataset.tab === tab);
        button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    }
    const fileButton = bar.querySelector<HTMLElement>('[data-tab=files]')!, label = c.files + (files ? ` <span class="n">${files}</span>` : '');
    if (fileButton.innerHTML !== label)
        fileButton.innerHTML = label;
    bar.querySelector<HTMLElement>('.hint')!.hidden = tab !== 'flow';
    const toggle = bar.querySelector<HTMLElement>('[data-think]')!;
    toggle.classList.toggle('on', think);
    toggle.setAttribute('aria-checked', String(think));
}
function changedFiles() { const files = new Map<string, NonNullable<TaskEvent['files']>[number]>(); for (const e of timeline?.events ?? [])
    for (const f of e.files ?? [])
        files.set(f.path, f); return files; }
function renderTab() {
    const t = current(), body = root.querySelector<HTMLElement>('.tab-body');
    if (!t || !body)
        return;
    const viewport = body.parentElement!;
    if (tab === 'flow') {
        const events = timeline?.events ?? [], cursor = timeline?.cursor, follow = timeline?.follow ?? t.status === 'run';
        body.innerHTML = '<div class="plan-slot"></div><button class="btn sm quiet" data-earlier hidden></button><div class="events-host"></div><div class="live-foot"></div>';
        timeline = new Timeline(body.querySelector('.events-host')!, viewport);
        timeline.events = events;
        timeline.cursor = cursor;
        timeline.follow = follow;
        timeline.think = think;
        renderFlow();
    }
    else if (tab === 'report')
        body.innerHTML = report ? `<div class="sum">${t.commit ? `<span>${icon('git-commit-line')}<em>${c.commit}</em><span class="mono">${t.commit}</span></span>` : ''}<span>${icon('time-line')}<em>${c.elapsed}</em>${t.minutes ?? '—'} ${c.minutes}</span><span class="sp"></span><button class="btn icon quiet" data-open="report" data-tip="${c.openReport}" aria-label="${c.openReport}">${icon('external-link-line')}</button></div><div class="md selectable">${markdown(report)}</div>` : `<div class="empty">${icon('file-text-line')}<b>${t.status === 'run' ? c.reportLater : c.noReport}</b>${t.status === 'run' ? '' : `<p>${c.noReportHelp}</p>`}</div>`;
    else if (tab === 'files') {
        const files = [...changedFiles().values()];
        body.innerHTML = files.length ? `<div class="sec-t">${c.filesHelp}${t.status === 'run' ? c.filesLive : ''}</div><div class="rows">${files.map(f => `<div class="r ${f.kind}">${icon(f.kind === 'add' ? 'add-line' : f.kind === 'delete' ? 'delete-bin-line' : 'edit-line')}<span class="muted">${c.kinds[f.kind]}</span><span class="v mono">${esc(f.path)}</span><button class="btn sm quiet" data-file="${esc(f.path)}">${c.open}</button></div>`).join('')}</div>` : `<div class="empty">${icon('file-copy-line')}<b>${c.noFiles}</b></div>`;
    }
    else {
        const row = (key: string, value: unknown, open?: string) => `<div class="r"><span class="k">${key}</span><span class="v mono">${esc(value)}</span>${open ? `<button class="btn sm quiet" data-open="${open}">${c.open}</button>` : ''}</div>`;
        body.innerHTML = `<div class="rows">${[[c.record, t.name], [c.spec, t.spec ?? c.direct, t.spec ? 'spec' : undefined], [c.role, t.role ?? c.noRole], [c.dispatcher, host(t)], [c.agent, t.agentVersion ?? 'Codex CLI'], [c.model, t.model ?? c.followCodex], [c.effort, t.effort ?? c.followCodex], [c.tier, t.tier ?? c.followCodex], [c.managed, t.managed?c.yes:c.no], [c.sandbox, t.sandbox ?? '—'], [c.repo, t.repo, 'repo']].map(([k, v, o]) => row(k!, v, o)).join('')}</div><div class="sec-t">${c.records}</div><div class="rows">${[[c.progress, 'progress'], [c.events, 'events'], [c.raw, 'raw']].map(([label, key]) => row(label, t[key as 'progress'] ?? '—', t[key as 'progress'] ? key : undefined)).join('')}</div>`;
    }
    if (tab !== 'flow') {
        const compact = root.querySelector<HTMLButtonElement>('[data-plan-top]')!;
        compact.hidden = true;
        compact.innerHTML = '';
    }
    tabs();
    followButton();
}
function renderFlow() {
    if (!timeline || tab !== 'flow')
        return;
    const plan = [...timeline.events].reverse().find(e => e.kind === 'plan'), slot = root.querySelector('.plan-slot')!;
    const items = plan?.items ?? [];
    const html = items.length ? `<div class="plan"><div class="plan-h"><b>${c.plan}</b><span class="mono">${items.filter(p => p.done).length}/${items.length}</span><progress max="${items.length}" value="${items.filter(p => p.done).length}"></progress></div><ul>${items.map((p, i) => `<li class="${p.done ? 'done' : i === items.findIndex(x => !x.done) ? 'now' : ''}">${icon(p.done ? 'checkbox-circle-fill' : i === items.findIndex(x => !x.done) ? 'arrow-right-circle-line' : 'checkbox-blank-circle-line')}<span>${esc(p.text)}</span></li>`).join('')}</ul></div>` : '';
    if (slot.innerHTML !== html)
        slot.innerHTML = html;
    const compact = root.querySelector<HTMLButtonElement>('[data-plan-top]')!;
    const now = items.find(p => !p.done);
    const summary = items.length ? `<b>${c.plan}</b><span class="mono">${items.filter(p => p.done).length}/${items.length}</span><progress max="${items.length}" value="${items.filter(p => p.done).length}"></progress>${now ? `<span class="plan-now">${c.planNow}：${esc(now.text)}</span>` : ''}` : '';
    if (compact.innerHTML !== summary)
        compact.innerHTML = summary;
    if (!items.length)
        compact.hidden = true;
    timeline.think = think;
    timeline.render();
    const earlier = root.querySelector<HTMLButtonElement>('[data-earlier]')!;
    earlier.hidden = !timeline.cursor?.start;
    earlier.textContent = c.earlier;
    root.querySelector('.live-foot')!.innerHTML = current()?.status === 'run' && timeline.follow ? `<span class="dot run"></span>${c.follow}` : '';
    followButton();
}
function followButton() { const b = root.querySelector<HTMLButtonElement>('[data-latest]'); if (b) {
    b.hidden = tab !== 'flow' || !timeline || timeline.follow || current()?.status !== 'run';
    b.textContent = c.latest;
} }
async function refreshDetail(before = false) {
    if (preferences.wizard || page !== 'tasks' || !current())
        return;
    if (loading) {
        queued = true;
        return;
    }
    loading = true;
    const gen = generation, id = selected, oldReport = report;
    try {
        const [data, eventPage] = await Promise.all([window.dock.detail(id), window.dock.events(id, timeline?.cursor, before)]);
        if (gen !== generation || id !== selected)
            return;
        report = data.report;
        // 未打开进展标签时同样保留事件模型，改动页因此得到完整汇总。
        if (!timeline) {
            const detached = document.createElement('div');
            timeline = new Timeline(detached, detached);
            timeline.follow = current()?.status === 'run';
        }
        let changed = eventPage.reset || eventPage.events.length > 0;
        timeline.merge(eventPage, before);
        // 每轮补一页历史，保证较早的计划和文件改动也会汇总；仍优先读取新增进展。
        if (!before && timeline.cursor!.start > 0) {
            const older = await window.dock.events(id, timeline.cursor, true);
            if (gen !== generation || id !== selected)
                return;
            timeline.merge(older, true);
            changed ||= older.reset || older.events.length > 0;
        }
        if (tab === 'flow' && changed)
            renderFlow();
        else if (tab !== 'flow' && (oldReport !== report || changed)) {
            const viewport = root.querySelector<HTMLElement>('.dbody > .scroll')!, top = viewport.scrollTop;
            renderTab();
            viewport.scrollTop = top;
        }
        if (changed)
            tabs();
    }
    catch (e) {
        notice(e);
    }
    finally {
        if (gen === generation) {
            loading = false;
            if (queued) {
                queued = false;
                void refreshDetail();
            }
        }
    }
}
root.addEventListener('click', async (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button,a');
    if (!b)
        return;
    const d = b.dataset;
    if (b.tagName === 'A') {
        e.preventDefault();
        void action('link', b.getAttribute('href')!);
        return;
    }
    if (b.hasAttribute('data-managed-settings') && !preferences.wizard) { page='settings'; nav(); pageView(); preferences.focusManaged(); }
    else if (d.page && !preferences.wizard) {
        page = d.page;
        nav();
        pageView();
    }
    else if (d.filter) {
        filter = d.filter;
        list();
    }
    else if (b.hasAttribute('data-project'))
        menu(b, [{ label: c.projects, run: () => { repo = ''; list(); } }, ...[...new Set(state.tasks.map(t => t.repo))].map(value => ({ label: value.split(/[\\/]/).at(-1)!, run: () => { repo = value; list(); } }))], true);
    else if (b.hasAttribute('data-import'))
        void window.dock.import().catch(notice);
    else if (d.task) {
        selected = d.task;
        tab = current()?.status === 'done' ? 'report' : 'flow';
        list();
        detail();
    }
    else if (d.tab) {
        tab = d.tab;
        renderTab();
        root.querySelector<HTMLElement>('.dbody > .scroll')!.scrollTop = 0;
        void refreshDetail();
    }
    else if (b.hasAttribute('data-think')) {
        think = !think;
        timeline?.invalidate();
        renderFlow();
        tabs();
    }
    else if (b.hasAttribute('data-plan-top')) {
        if (timeline)
            timeline.follow = false;
        root.querySelector<HTMLElement>('.dbody > .scroll')!.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    else if (b.hasAttribute('data-latest')) {
        if (timeline) {
            timeline.follow = true;
            timeline.invalidate();
            renderFlow();
        }
    }
    else if (b.hasAttribute('data-earlier')) {
        if (timeline)
            timeline.follow = false;
        void refreshDetail(true);
    }
    else if (b.hasAttribute('data-stop')) {
        const t = current();
        if (t && await confirmStop(t.title, b))
            void window.dock.action(t.id, 'stop').catch(notice);
    }
    else if (b.hasAttribute('data-more')) {
        const t = current()!;
        menu(b, [{ label: c.openRepo, run: () => void action('repo') }, ...(t.spec ? [{ label: c.openSpec, run: () => void action('spec') }] : []), { label: c.openReport, run: () => void action('report') }, { label: c.openProgress, run: () => void action('progress') }, { label: c.copyName, run: () => void action('copy') }, { label: c.hide, separator: true, disabled: t.status === 'run', run: () => void action('hide') }]);
    }
    else if (d.open)
        void action(d.open);
    else if (d.file)
        void action('file', d.file);
});
function accept(s: Snapshot) { const old = JSON.stringify(state.tasks); state = s; document.documentElement.dataset.theme = s.theme; if (!root.children.length) {
    shell();
    return;
} if (s.select) {
    selected = s.select;
    filter = 'all';
    repo = '';
    page = 'tasks';
    tab = current()?.status === 'done' ? 'report' : 'flow';
    nav();
    pageView();
    return;
} if (old !== JSON.stringify(s.tasks)) {
    nav();
    list();
    if (page === 'tasks' && !preferences.wizard) {
        if (!current()) {
            detail();
        }
        else if (detailSignature !== headerKey(current()!))
            header();
    }
} void refreshDetail(); }
installScrollMaterial(document.body);
tooltips();
void preferences.init().then(() => { window.dock.subscribe(accept); return window.dock.snapshot(); }).then(accept).catch(notice);
setInterval(() => { for (const el of root.querySelectorAll<HTMLElement>('[data-elapsed]')) {
    const t = state.tasks.find(t => t.id === el.dataset.elapsed);
    if (t)
        el.textContent = elapsed(t);
} void refreshDetail(); }, 1000);
