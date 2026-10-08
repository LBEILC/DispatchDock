// 只解析宿主合成需要的顶层 YAML 键，保留各键的原始多行内容。
function frontmatter(text, required = false) {
  const match = text.match(/^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m);
  if (!match || match.index !== 0) {
    if (required) throw new Error('技能缺少 frontmatter');
    return { fields: new Map(), body: text, prefix: '' };
  }
  const fields = new Map();
  let key;
  for (const line of match[1].match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const top = line.match(/^([A-Za-z][\w-]*):/);
    if (top) {
      key = top[1];
      if (fields.has(key)) throw new Error(`重复的 frontmatter 键：${key}`);
      fields.set(key, line);
    } else if (key && (/^\s/.test(line) || /^#/.test(line))) fields.set(key, fields.get(key) + line);
    else throw new Error('无法解析 frontmatter 顶层键');
  }
  return { fields, body: text.slice(match[0].length), prefix: match[0] };
}

function sections(text) {
  const parts = [], named = new Map();
  let active = null, plain = '';
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const mark = line.match(/^\s*<!-- (\/?)host:([a-z0-9-]+) -->\s*$/);
    if (mark) {
      if (!mark[1]) {
        if (active || named.has(mark[2])) throw new Error('宿主标记嵌套或重复');
        parts.push({ text: plain }); plain = '';
        active = { name: mark[2], text: '' }; named.set(active.name, active);
      } else {
        if (!active || active.name !== mark[2]) throw new Error('宿主标记不成对');
        parts.push(active); active = null;
      }
    } else {
      if (/<!--\s*\/?host:/.test(line)) throw new Error('宿主标记必须独占一行且名称合法');
      if (active) active.text += line; else plain += line;
    }
  }
  if (active) throw new Error('宿主标记不成对');
  parts.push({ text: plain });
  return { parts, named };
}

export function composeSkill(source, overlay = '') {
  const base = frontmatter(source, true), extra = frontmatter(overlay);
  const body = sections(base.body), replacements = sections(extra.body);
  for (const key of replacements.named.keys()) if (!body.named.has(key)) throw new Error(`正文没有宿主段：${key}`);
  const name = fields => fields.get('name')?.replace(/^name:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  const fields = new Map([...base.fields, ...extra.fields]);
  if (!name(base.fields) || name(fields) !== name(base.fields)) throw new Error('合成不能改变 name');
  const prefix = extra.fields.size ? `---\n${[...fields.values()].join('')}---\n` : base.prefix;
  const result = prefix + body.parts.map(part => replacements.named.get(part.name)?.text ?? part.text).join('');
  if (/<!--\s*\/?host:/.test(result)) throw new Error('合成结果残留宿主标记');
  return result;
}
