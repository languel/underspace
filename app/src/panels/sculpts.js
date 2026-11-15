// Sculpt tools as code (after Artist Model Studio's panel): pick a tool to
// read it, copy one, or write your own. The preview runs the tool as written
// along a sweep over a sample line (faint: before; dark: after), as you type.
// A tool written here is part of the drawing (sculpt.define), so it is saved,
// undone and replayed with it.

import { h, glyphButton, choice } from '../controls.js';
import { SCULPTS, sculptSource, compileSculpt, sculptMark, isBuiltinSculpt } from '../ink/sculpt.js';
import { settings, setSetting } from '../settings.js';

const W = 300, H = 110;
const sample = () => Array.from({ length: 41 }, (_, i) => { const u = i / 40; return [W * (0.06 + u * 0.88), H * (0.5 + 0.2 * Math.sin(u * Math.PI * 3)), i * 20, 0.5]; });

// The sample line after the tool has been swept across it, left to right, a little above the middle.
function sweep(def) {
  let pts = sample(), seed = 7;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mark = { orig: pts, state: {} }, start = [W * 0.2, H * 0.5];
  for (let i = 0; i <= 30; i++) {
    const x = W * (0.2 + 0.6 * (i / 30)), y = H * (0.5 - 0.22 * Math.sin((i / 30) * Math.PI));
    const out = sculptMark(def, { points: pts, closed: false }, { x, y, dx: i ? (W * 0.6) / 30 : 0, dy: i ? -H * 0.02 : 0, radius: 34, strength: 0.6, pressure: 1, first: i === 0, start }, undefined, rng, mark);
    if (out) pts = out;
  }
  return pts;
}

export function sculptsPanel(el, app) {
  const body = h('div', 'panel-body sculpts');
  const pick = h('div', 'row'), cv = h('canvas', 'sculpt-preview'), code = h('textarea', 'sculpt-code'), status = h('p', 'muted sculpt-status'), bar = h('div', 'glyph-row');
  cv.width = W * 2; cv.height = H * 2; code.spellcheck = false;
  body.append(pick, cv, code, status, bar);
  el.append(body);
  let current = SCULPTS[settings.sculpt] ? settings.sculpt : 'push', sig = null;

  function draw(def) {
    const g = cv.getContext('2d'), ink = getComputedStyle(cv).color;
    g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H); g.lineJoin = g.lineCap = 'round'; g.strokeStyle = ink;
    const line = (pts, alpha, dots) => {
      g.globalAlpha = alpha; g.lineWidth = 1.4; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      if (dots) { g.fillStyle = ink; for (const p of pts) { g.beginPath(); g.arc(p[0], p[1], 1.3, 0, 7); g.fill(); } }
    };
    line(sample(), 0.25, false);
    if (def) { try { line(sweep(def), 1, true); } catch (err) { status.textContent = err.message; } }
    g.globalAlpha = 1;
  }
  // What is written, as a tool: shown in the preview, and said when it is wrong.
  function read() {
    try { const def = compileSculpt(code.value); status.textContent = def.doc; draw(def); return def; } catch (err) { status.textContent = err.message; draw(null); return null; }
  }
  function show(id) {
    current = id;
    code.value = app.state.sculpts[id] ?? sculptSource(id);
    code.readOnly = isBuiltinSculpt(id);
    build(); read();
  }
  // A name no tool has yet, from the one copied.
  const freeId = (id) => { let n = 2; while (SCULPTS[id + n] || app.state.sculpts[id + n]) n++; return id + n; };
  function build() {
    const ids = [...new Set([...Object.keys(SCULPTS), ...Object.keys(app.state.sculpts)])];
    pick.replaceChildren(choice(ids.map((id) => [id, (SCULPTS[id]?.label ?? id) + (isBuiltinSculpt(id) ? '' : ' ·')]), current, show));
    const mine = !isBuiltinSculpt(current);
    bar.replaceChildren(
      glyphButton('copy', 'Copy this tool to change it', () => {
        const id = freeId(current.replace(/\d+$/, '')), label = (SCULPTS[current]?.label ?? current) + ' 2';
        const src = (app.state.sculpts[current] ?? sculptSource(current)).replace(/id:\s*(['"])[^'"]*\1/, `id: '${id}'`).replace(/label:\s*(['"])[^'"]*\1/, `label: '${label}'`);
        if (app.call('sculpt.define', { id, code: src })) show(id);
      }),
      ...(mine ? [
        glyphButton('save', 'Keep what is written (it becomes the tool)', () => { const def = read(); if (!def) return; if (def.id !== current) { status.textContent = `its id is ${current}: copy it to make another`; return; } app.call('sculpt.define', { id: current, code: code.value }); }),
        glyphButton('remove', 'Remove this tool', () => { app.call('sculpt.remove', { id: current }); show('push'); }),
      ] : []),
      glyphButton('sculpt', 'Sculpt with this tool', () => { if (SCULPTS[current]) { setSetting('sculpt', current); app.call('tool.set', { name: 'sculpt' }); } }));
  }
  code.addEventListener('input', read);
  code.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); read(); } });
  show(current);

  return {
    update() {
      const next = JSON.stringify(app.state.sculpts);
      if (next === sig) return;
      sig = next;
      if (!SCULPTS[current] && !(current in app.state.sculpts)) show('push');
      else if (document.activeElement !== code) show(current);
      else build();
      const err = app.sculptErrors()[current];
      if (err) status.textContent = err;
    },
  };
}
