// The command palette: type to find anything the system can do, or say what you want and the
// assistant builds it. One field. Actions come first; then commands, settings, objects and
// examples (catalog.js). A first character narrows it: > commands, : settings, @ objects,
// and ! runs a command from the line ("!line.add points=[[0,0],[2,1]]"); choosing a command
// that takes arguments writes that line for you and shows what it takes. The last row always
// offers the assistant.

import { h } from './controls.js';
import { icon } from './icons.js';

import { score } from './catalog.js';

// getActions() -> [{ title, keys, icon, run }], ask(text) -> Promise<string> (what the assistant says),
// more: { rows(q, kinds), line(text) -> Promise<string>, hint(text) } from catalog.js
const NARROW = { '>': ['command'], ':': ['setting'], '@': ['object'] };
export function createPalette(el, { getActions, ask, more }) {
  const input = h('input'), list = h('div', 'palette-list'), note = h('p', 'palette-note');
  input.type = 'text'; input.spellcheck = false; input.setAttribute('aria-label', 'Command or request');
  el.append(input, list, note);
  let rows = [], at = 0, prompt = null, busy = false;

  function render() {
    const raw = input.value.trim(), bang = raw.startsWith('!'), kinds = NARROW[raw[0]];
    const q = (bang || kinds ? raw.slice(1) : raw).trim().toLowerCase();
    if (prompt) rows = [];
    else if (bang) { // a command being typed: its name completes, then the line shows what it takes
      const named = /\s/.test(input.value.replace(/^\s*!\s*/, ''));
      rows = named ? [] : more.rows(q, ['command']).sort((x, y) => y.s - x.s).slice(0, 12);
      if (named) note.textContent = more.hint(raw);
    } else {
      const acts = kinds ? [] : getActions().map((a) => ({ ...a, s: q ? score(q, a.title.toLowerCase()) + 4 : 0 })).filter((r) => r.s >= 0);
      const rest = q || kinds ? more.rows(q, kinds) : [];
      rows = [...acts, ...rest];
      if (q) rows.sort((x, y) => y.s - x.s);
      rows = rows.slice(0, kinds ? 40 : 12);
      if (q && !kinds) rows.push({ title: raw, icon: 'ask', keys: rows.length ? '⌘↵' : '↵', ask: true });
    }
    at = Math.min(at, Math.max(0, rows.length - 1));
    list.replaceChildren(...rows.map((a, i) => {
      const row = h('button', 'menu-item' + (i === at ? ' on' : '') + (a.ask ? ' ask' : ''));
      const glyph = h('span', 'glyph'); glyph.innerHTML = a.icon ? icon(a.icon) : '';
      const label = h('span', 'label', a.title); if (a.sub) label.append(h('small', '', a.sub));
      row.append(glyph, label, h('kbd', '', a.keys ?? ''));
      row.addEventListener('click', () => run(a));
      return row;
    }));
  }

  async function run(a) {
    if (!a || busy) return;
    if (a.fill) { input.value = a.fill; note.textContent = more.hint(a.fill); at = 0; render(); input.focus(); return; }
    if (a.line) return runLine(a.line);
    if (!a.ask) { if (a.stay) { a.run(); render(); } else { close(); a.run(); } return; }
    busy = true; el.classList.add('busy'); note.textContent = '';
    try { note.textContent = await ask(a.title); input.value = ''; }
    catch (e) { note.textContent = e.message; }
    busy = false; el.classList.remove('busy');
    render(); input.focus();
  }

  // a command from the line: what it returns shows under the field, and the field stays for the next
  async function runLine(text) {
    busy = true; el.classList.add('busy');
    try { note.textContent = await more.line(text); input.value = ''; }
    catch (e) { note.textContent = e.message; }
    busy = false; el.classList.remove('busy');
    render(); input.focus();
  }

  input.addEventListener('input', () => { at = 0; note.textContent = ''; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % Math.max(1, rows.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + rows.length) % Math.max(1, rows.length); render(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (prompt) { const done = prompt; prompt = null; const v = input.value.trim(); close(); done(v); }
      else if (input.value.trim().startsWith('!') && !rows.length) runLine(input.value);
      else run(e.metaKey || e.ctrlKey ? rows.find((r) => r.ask) : rows[at]);
    }
    else if (e.key === 'Tab' && rows[at]?.fill) { e.preventDefault(); run(rows[at]);
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
