export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]!));
export const commitFrom = (text: string) => text.match(/`([a-f\d]{7,12})`/i)?.[1];
export function inline(text: string): string {
    // 先按原文识别有限语法，再转义各槽位；任何 HTML 都只作为文字显示。
    return text.split(/(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))/g).map(s => {
        if (s.startsWith('`') && s.endsWith('`'))
            return `<code>${esc(s.slice(1, -1))}</code>`;
        const link = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link && /^https?:\/\//i.test(link[2]))
            return `<a href="${esc(link[2])}">${esc(link[1])}</a>`;
        return esc(s);
    }).join('');
}
export function markdown(text: string): string {
    let html = '', code: string[] | null = null, list = '', highlight = 0;
    const closeList = () => { if (list) {
        html += `</${list}>`;
        list = '';
    } };
    for (const line of text.split(/\r?\n/)) {
        if (/^```/.test(line)) {
            closeList();
            if (code) {
                html += `<pre class="out scroll">${esc(code.join('\n'))}</pre>`;
                code = null;
            }
            else
                code = [];
            continue;
        }
        if (code) {
            code.push(line);
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            closeList();
            if (highlight && heading[1].length <= highlight) {
                html += '</section>';
                highlight = 0;
            }
            if (!highlight && /^(?:\d+[.、)\s]+)?(?:TODO\(design\)|推断清单)/.test(heading[2])) {
                highlight = heading[1].length;
                html += '<section class="hl warn">';
            }
            html += `<h3>${inline(heading[2])}</h3>`;
            continue;
        }
        const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
        if (item) {
            const type = item[1] ? 'ul' : 'ol';
            if (list !== type) {
                closeList();
                list = type;
                html += `<${list}>`;
            }
            html += `<li>${inline(item[2])}</li>`;
            continue;
        }
        closeList();
        if (line.trim())
            html += `<p>${inline(line)}</p>`;
    }
    closeList();
    if (code)
        html += `<pre class="out scroll">${esc(code.join('\n'))}</pre>`;
    if (highlight)
        html += '</section>';
    return html;
}
