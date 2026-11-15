// A tool as code, in a panel: pick one to read it, copy one, or write your
// own; a preview runs what is written as you type, and says what is wrong.
// Shared by the sculpt tools and the ink brushes (after Artist Model Studio's
// panels for both). What is written is part of the drawing, through `define`.
//
// cfg: { word ('tool' | 'brush'), ids(), label(id), builtin(id), source(id), compile(source) -> def,
//        preview(g, def | null, W, H, ink), define(id, code), remove(id), use(id), useIcon, useTitle,
//        error(id), sig(), first (the one shown when the current goes), current() }

import { h, glyphButton, choice } from '../controls.js';

const W = 300, H = 110;

export function toolCodePanel(el, cfg) {
  const body = h('div', 'panel-body toolcode');
  const pick = h('div', 'row'), cv = h('canvas', 'toolcode-preview'), code = h('textarea', 'toolcode-code'), status = h('p', 'muted toolcode-status'), bar = h('div', 'glyph-row');
  cv.width = W * 2; cv.height = H * 2; code.spellcheck = false;
  body.append(pick, cv, code, status, bar);
  el.append(body);
  let current = cfg.ids().includes(cfg.current()) ? cfg.current() : cfg.first, sig = null;

  function draw(def) {
    const g = cv.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H); g.globalAlpha = 1;
    try { cfg.preview(g, def, W, H, getComputedStyle(cv).color); } catch (err) { status.textContent = err.message; }
    g.globalAlpha = 1;
  }
  // What is written, as a tool: shown in the preview, and said when it is wrong.
  function read() {
    try { const def = cfg.compile(code.value); status.textContent = def.doc; draw(def); return def; } catch (err) { status.textContent = err.message; draw(null); return null; }
  }
  function show(id) {
    current = id;
    code.value = cfg.source(id);
    code.readOnly = cfg.builtin(id);
    build(); read();
  }
  // A name nothing has yet, from the one copied.
  const freeId = (id) => { let n = 2; while (cfg.ids().includes(id + n)) n++; return id + n; };
  function build() {
    pick.replaceChildren(choice(cfg.ids().map((id) => [id, cfg.label(id) + (cfg.builtin(id) ? '' : ' ·')]), current, show));
    const mine = !cfg.builtin(current);
    bar.replaceChildren(
      glyphButton('copy', `Copy this ${cfg.word} to change it`, () => {
        const id = freeId(current.replace(/\d+$/, '')), label = cfg.label(current) + ' 2';
        const src = cfg.source(current).replace(/id:\s*(['"])[^'"]*\1/, `id: '${id}'`).replace(/label:\s*(['"])[^'"]*\1/, `label: '${label}'`);
        if (cfg.define(id, src)) show(id);
      }),
      ...(mine ? [
        glyphButton('save', `Keep what is written (it becomes the ${cfg.word})`, () => { const def = read(); if (!def) return; if (def.id !== current) { status.textContent = `its id is ${current}: copy it to make another`; return; } cfg.define(current, code.value); }),
        glyphButton('remove', `Remove this ${cfg.word}`, () => { cfg.remove(current); show(cfg.first); }),
      ] : []),
      glyphButton(cfg.useIcon, cfg.useTitle, () => cfg.use(current)));
  }
  code.addEventListener('input', read);
  code.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); read(); } });
  show(current);

  return {
    update() {
      const next = cfg.sig();
      if (next === sig) return;
      sig = next;
      if (!cfg.ids().includes(current)) show(cfg.first);
      else if (document.activeElement !== code) show(current);
      else build();
      const err = cfg.error(current);
      if (err) status.textContent = err;
    },
  };
}
