// The command palette: type to find an action, or say what you want and the
// assistant builds it. One field; the last row always offers the assistant.

import { h } from './controls.js';
import { icon } from './icons.js';

// Letters of the query in order; earlier and tighter matches score higher.
function score(query, text) {
  let i = 0, s = 0, last = -1;
  for (const ch of query) {
    const at = text.indexOf(ch, i);
    if (at < 0) return -1;
    s += at === last + 1 ? 3 : 1; if (at === 0 || text[at - 1] === ' ') s += 2;
    last = at; i = at + 1;
  }
  return s - text.length * 0.01;
}

// getActions() -> [{ title, keys, icon, run }], ask(text) -> Promise<string> (what the assistant says)
export function createPalette(el, { getActions, ask }) {
  const input = h('input'), list = h('div', 'palette-list'), note = h('p', 'palette-note');
  input.type = 'text'; input.spellcheck = false; input.setAttribute('aria-label', 'Command or request');
  el.append(input, list, note);
  let rows = [], at = 0, prompt = null, busy = false;

  function render() {
    const q = input.value.trim().toLowerCase();
    if (prompt) rows = [];
    else {
      rows = getActions().map((a) => ({ a, s: q ? score(q, a.title.toLowerCase()) : 0 })).filter((r) => r.s >= 0);
      if (q) rows.sort((x, y) => y.s - x.s);
      rows = rows.slice(0, 9).map((r) => r.a);
      if (q) rows.push({ title: input.value.trim(), icon: 'ask', keys: rows.length ? '⌘↵' : '↵', ask: true });
    }
    at = Math.min(at, Math.max(0, rows.length - 1));
    list.replaceChildren(...rows.map((a, i) => {
      const row = h('button', 'menu-item' + (i === at ? ' on' : '') + (a.ask ? ' ask' : ''));
      const glyph = h('span', 'glyph'); glyph.innerHTML = a.icon ? icon(a.icon) : '';
      row.append(glyph, h('span', 'label', a.title), h('kbd', '', a.keys ?? ''));
      row.addEventListener('click', () => run(a));
      return row;
    }));
  }

  async function run(a) {
    if (!a || busy) return;
    if (!a.ask) { close(); a.run(); return; }
    busy = true; el.classList.add('busy'); note.textContent = '';
    try { note.textContent = await ask(a.title); input.value = ''; }
    catch (e) { note.textContent = e.message; }
    busy = false; el.classList.remove('busy');
    render(); input.focus();
  }

  input.addEventListener('input', () => { at = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % Math.max(1, rows.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + rows.length) % Math.max(1, rows.length); render(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (prompt) { const done = prompt; prompt = null; const v = input.value.trim(); close(); done(v); }
      else run(e.metaKey || e.ctrlKey ? rows.find((r) => r.ask) : rows[at]);
    }
  });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  addEventListener('pointerdown', (e) => { if (!el.hidden && !el.contains(e.target)) close(); });

  function open(text = '') { el.hidden = false; prompt = null; input.placeholder = ''; input.value = text; note.textContent = ''; at = 0; render(); input.focus(); }
  function close() { el.hidden = true; prompt = null; input.blur(); }
  return {
    open, close,
    toggle() { el.hidden ? open() : close(); },
    // Ask for one value (an address, a name) in the same field.
    prompt(placeholder, value, done) { open(value ?? ''); prompt = done; input.placeholder = placeholder; input.select(); render(); },
  };
}
