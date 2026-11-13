// The parameter rows and the code area, used by the faces on the canvas and
// by the sidebar. Both edit the same object through the same commands.

import { icon } from './icons.js';

export function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// Keeps `box` showing one number field per parameter of object `o`.
export function syncParams(box, o, blanket, onParam) {
  const sig = o.id + ':' + blanket.params.map((p) => p.name).join(' ');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren(...blanket.params.map((p) => {
      const row = h('label', 'param'), input = h('input');
      input.type = 'number'; input.step = 'any'; input.dataset.name = p.name; input.title = p.name;
      input.addEventListener('input', () => { const v = Number(input.value); if (input.value !== '' && Number.isFinite(v)) onParam(o.id, p.name, v); });
      row.append(h('span', '', p.name), input);
      return row;
    }));
  }
  for (const input of box.querySelectorAll('input')) {
    if (input === document.activeElement) continue;
    const p = blanket.params.find((q) => q.name === input.dataset.name);
    const v = String(o.params?.[p.name] ?? p.value);
    if (input.value !== v) input.value = v;
  }
}

// A plain code area. Edits are committed shortly after typing stops.
export function codeArea(onCode) {
  const area = h('textarea', 'code');
  area.spellcheck = false;
  let timer = 0;
  const commit = () => { clearTimeout(timer); timer = 0; if (area.dataset.id && area.value !== area.dataset.code) { area.dataset.code = area.value; onCode(area.dataset.id, area.value); } };
  area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(commit, 300); });
  area.addEventListener('blur', commit);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end'); area.dispatchEvent(new Event('input')); }
    if (e.key === 'Escape') area.blur();
  });
  return area;
}

export function syncCode(area, o) {
  if (area.dataset.id !== o.id) { area.dataset.id = o.id; area.dataset.code = ''; area.value = ''; }
  if (area === document.activeElement || area.dataset.code === o.code) return;
  area.dataset.code = o.code; area.value = o.code;
}

// ---- small pieces the panels share ----------------------------------------


export function glyphButton(name, title, onClick, pressed) {
  const b = h('button', 'glyph-button');
  b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = icon(name);
  if (pressed != null) b.setAttribute('aria-pressed', String(!!pressed));
  b.addEventListener('click', onClick);
  return b;
}
export function row(label, ...controls) {
  const el = h('label', 'row');
  el.append(h('span', '', label), ...controls);
  return el;
}
export function section(title, ...children) {
  const el = h('section', 'group');
  if (title) el.append(h('h3', '', title));
  el.append(...children);
  return el;
}
export function numberField(value, onCommit, { step = 'any', min, max } = {}) {
  const input = h('input');
  input.type = 'number'; input.step = step; input.value = value ?? '';
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  input.addEventListener('change', () => { const v = Number(input.value); if (input.value !== '' && Number.isFinite(v)) onCommit(v); });
  return input;
}
export function textField(value, onCommit, placeholder = '') {
  const input = h('input');
  input.type = 'text'; input.value = value ?? ''; input.placeholder = placeholder; input.spellcheck = false;
  input.addEventListener('change', () => onCommit(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}
export function choice(options, value, onCommit) {
  const select = h('select');
  select.append(...options.map((o) => new Option(o[1] ?? o, o[0] ?? o)));
  select.value = value;
  select.addEventListener('change', () => onCommit(select.value));
  return select;
}

export const PALETTE = ['#1d1c1a', '#e9e6df', '#77736b', '#c2410c', '#b45309', '#ca8a04', '#4d7c0f', '#0f766e', '#0369a1', '#4338ca', '#9333ea', '#be185d'];
// A colour: palette swatches, any colour, or none (null: the default ink, or no fill).
export function colorField(value, onCommit) {
  const el = h('span', 'color-field'), any = h('input'), none = h('button', 'swatch none');
  any.type = 'color'; any.value = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#888888'; any.title = 'Any colour';
  any.addEventListener('change', () => onCommit(any.value));
  none.type = 'button'; none.title = 'Default'; none.setAttribute('aria-pressed', String(value == null));
  none.addEventListener('click', () => onCommit(null));
  el.append(none, ...PALETTE.map((c) => {
    const b = h('button', 'swatch');
    b.type = 'button'; b.title = c; b.style.background = c; b.setAttribute('aria-pressed', String(c === value));
    b.addEventListener('click', () => onCommit(c));
    return b;
  }), any);
  return el;
}
