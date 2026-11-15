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
// A titled group folds up to its title (kept per title, in this browser: not part of the drawing).
const FOLD = 'underspace-folded';
const folded = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLD) || '[]')); } catch { return new Set(); } };
export function section(title, ...children) {
  const el = h('section', 'group');
  if (!title) { el.append(...children); return el; }
  const head = h('button', 'group-head'), body = h('div', 'group-body');
  head.type = 'button'; head.textContent = title; head.title = `${title}: fold or unfold`;
  body.append(...children);
  const set = (shut) => { el.dataset.folded = shut ? '1' : ''; head.setAttribute('aria-expanded', String(!shut)); };
  set(folded().has(title));
  head.addEventListener('click', () => {
    const all = folded(), shut = !all.has(title);
    if (shut) all.add(title); else all.delete(title);
    try { localStorage.setItem(FOLD, JSON.stringify([...all])); } catch { /* it still folds for now */ }
    set(shut);
  });
  el.append(head, body);
  return el;
}

// Cmd (or Ctrl) and drag on a number: it grows to the right and shrinks to the left, a step for every few
// pixels (Shift: ten steps, Alt: a tenth). The whole drag is one step of undo; `dragStep` is set by the app.
export const dragStep = { begin() {}, end() {} };
const cmdWatch = (e) => { document.documentElement.dataset.cmd = e.metaKey || e.ctrlKey ? '1' : ''; };
if (typeof document !== 'undefined') { addEventListener('keydown', cmdWatch); addEventListener('keyup', cmdWatch); addEventListener('blur', () => { document.documentElement.dataset.cmd = ''; }); }
function dragNumber(input, step, onCommit) {
  input.addEventListener('pointerdown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return;
    e.preventDefault();
    const v0 = Number(input.value) || 0, x0 = e.clientX, unit0 = Number(step) || (Math.abs(v0) >= 10 ? 1 : 0.1);
    const places = Number(step) ? (String(step).split('.')[1] ?? '').length : 3, lo = input.min === '' ? -Infinity : Number(input.min), hi = input.max === '' ? Infinity : Number(input.max);
    let queued = 0, last = v0, done = false;
    const value = (ev) => {
      const unit = unit0 * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1), v = v0 + Math.round((ev.clientX - x0) / 3) * unit;
      return Math.max(lo, Math.min(hi, +v.toFixed(Math.max(places, ev.altKey ? places + 1 : places))));
    };
    // The gesture belongs to the window, not the field: it goes on wherever the pointer goes, and
    // when the panel is rebuilt by a commit (the field replaced), it still goes on.
    try { input.setPointerCapture(e.pointerId); } catch { /* the window still follows the pointer */ }
    dragStep.begin();
    input.dataset.dragging = '1';
    const move = (ev) => {
      last = value(ev); input.value = last;
      if (!queued) queued = requestAnimationFrame(() => { queued = 0; if (!done) onCommit(last); });
    };
    const up = () => {
      done = true; cancelAnimationFrame(queued);
      for (const w of [window]) { w.removeEventListener('pointermove', move, true); w.removeEventListener('pointerup', up, true); w.removeEventListener('pointercancel', up, true); }
      document.documentElement.style.cursor = '';
      delete input.dataset.dragging;
      if (last !== v0) onCommit(last);
      dragStep.end();
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    document.documentElement.style.cursor = 'ew-resize';
  });
}
export function numberField(value, onCommit, { step = 'any', min, max } = {}) {
  const input = h('input');
  input.type = 'number'; input.step = step; input.value = value ?? '';
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  input.addEventListener('change', () => { const v = Number(input.value); if (input.value !== '' && Number.isFinite(v)) onCommit(v); });
  dragNumber(input, step, onCommit);
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
