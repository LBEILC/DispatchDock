import { c } from '../shared/copy';
import { esc } from '../shared/markdown';
export const icon = (name: string) => `<i class="ri ri-${name}" aria-hidden="true"></i>`;
export function menu(anchor: HTMLElement, items: {
    label: string;
    disabled?: boolean;
    separator?: boolean;
    run: () => void;
}[], select = false) {
    document.querySelector('.ctx')?.remove();
    const panel = document.createElement('div');
    panel.className = 'ctx scroll';
    panel.setAttribute('role', select ? 'listbox' : 'menu');
    panel.innerHTML = items.map((i, n) => `${i.separator ? '<hr>' : ''}<button role="${select ? 'option' : 'menuitem'}" data-option="${n}" ${i.disabled ? 'disabled' : ''}>${esc(i.label)}</button>`).join('');
    document.body.append(panel);
    const r = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.left))}px`;
    panel.style.top = `${Math.min(innerHeight - panel.offsetHeight - 8, r.bottom + 4)}px`;
    anchor.setAttribute('aria-expanded', 'true');
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const close = () => { panel.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); anchor.focus({ preventScroll: true }); };
    const outside = (e: PointerEvent) => { if (!panel.contains(e.target as Node) && e.target !== anchor)
        close(); };
    document.addEventListener('pointerdown', outside, true);
    panel.onclick = e => { const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (b && !b.disabled) {
        close();
        items[+b.dataset.option!].run();
    } };
    panel.onkeydown = e => { if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        close();
    } if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement), n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[n]?.focus();
    } };
    requestAnimationFrame(() => panel.classList.add('motion-open'));
    buttons[0]?.focus();
}
export function confirmStop(name: string, trigger: HTMLElement): Promise<boolean> {
    return confirmAction(c.stopTitle(name), c.stopBody, c.stop, trigger, true);
}
export function confirmAction(title: string, body: string, label: string, trigger: HTMLElement, danger = false): Promise<boolean> {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `<section class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body"><h2 id="confirm-title">${esc(title)}</h2><p id="confirm-body">${esc(body)}</p><div class="confirm-actions"><button class="btn">${c.cancel}</button><button class="btn ${danger ? 'danger' : 'primary'}">${esc(label)}</button></div></section>`;
        const background = [...document.body.children].filter((e): e is HTMLElement => e instanceof HTMLElement).map(e => ({ e, inert: e.inert }));
        background.forEach(({ e }) => e.inert = true);
        document.body.append(overlay);
        const buttons = [...overlay.querySelectorAll<HTMLButtonElement>('button')];
        const close = (ok: boolean) => { background.forEach(({ e, inert }) => e.inert = inert); overlay.remove(); trigger.focus({ preventScroll: true }); resolve(ok); };
        buttons[0].onclick = () => close(false);
        buttons[1].onclick = () => close(true);
        overlay.onkeydown = e => { if (e.key === 'Escape') {
            e.preventDefault();
            close(false);
        } if (e.key === 'Tab') {
            e.preventDefault();
            buttons[document.activeElement === buttons[0] ? 1 : 0].focus();
        } };
        requestAnimationFrame(() => overlay.classList.add('motion-open'));
        buttons[0].focus();
    });
}
export function tooltips() {
    let timer: ReturnType<typeof setTimeout> | undefined, tip: HTMLElement | undefined;
    const hide = () => { clearTimeout(timer); tip?.remove(); tip = undefined; };
    const over = (e: Event) => { const target = (e.target as Element).closest<HTMLElement>('[data-tip]'); if (!target)
        return; hide(); timer = setTimeout(() => { if (!target.isConnected)
        return; tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = target.dataset.tip!; document.body.append(tip); const r = target.getBoundingClientRect(); tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left))}px`; tip.style.top = `${Math.min(innerHeight - tip.offsetHeight - 8, r.bottom + 6)}px`; }, 500); };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', over);
    for (const event of ['mouseout', 'focusout', 'pointerdown', 'scroll'])
        document.addEventListener(event, hide, true);
}
export function notice(error: unknown) { document.querySelector('.notice')?.remove(); const box = document.createElement('div'); box.className = 'notice'; box.setAttribute('role', 'alert'); box.textContent = error instanceof Error && error.message.includes(c.changed) ? c.changed : c.error; document.body.append(box); setTimeout(() => box.remove(), 5000); }
