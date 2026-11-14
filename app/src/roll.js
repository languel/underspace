// The piano roll: the notes of one recorded clip, edited under the timeline on
// its ruler (time across, pitch up; the rows of the timeline's scale are lit,
// loudness is how solid a note is). Every gesture is one command (clip.set
// with notes), so one undo step.
//
//   click a note           pick it (Shift adds or takes away)
//   drag notes             move them: across by sixteenths (Alt: freely), up and down by semitones
//   drag a note's right end   make the picked notes longer or shorter
//   drag on nothing        pick the notes in a box
//   double-click nothing   a new note there
//   Delete                 remove the picked notes
//   ↑ ↓                    the picked notes a degree of the scale up or down (Shift: an octave)
//   ← →                    a sixteenth earlier or later
//   Q                      the picked notes (or all) onto sixteenths
//   ⌘A, Esc                pick all; close the roll

import { h } from './controls.js';
import { scaleNotes, step, noteName } from './music.js';

const ROW = 7, EDGE = 5, Q = 0.25;

// ---- pure: what the keys do to notes (for tests too) ---------------------------

const r4 = (v) => Math.round(v * 1e4) / 1e4;
// The picked notes (indices in `sel`, or all) k degrees of the scale up; octave: 12 semitones a step.
export function transpose(notes, sel, k, music, octave = false) {
  return notes.map((n, i) => (sel && !sel.has(i) ? n : { ...n, midi: Math.max(0, Math.min(127, octave ? n.midi + 12 * k : step(n.midi, k, music.scale, music.root))) }));
}
export function quantize(notes, sel, q = Q) {
  return notes.map((n, i) => (sel && sel.size && !sel.has(i) ? n : { ...n, beat: r4(Math.round(n.beat / q) * q), len: r4(Math.max(q, Math.round(n.len / q) * q)) }));
}
export function shift(notes, sel, db, dm = 0) {
  return notes.map((n, i) => (!sel.has(i) ? n : { ...n, beat: r4(Math.max(0, n.beat + db)), midi: Math.max(0, Math.min(127, n.midi + dm)) }));
}

// ---- the editor -----------------------------------------------------------------

// host: { clip() -> the clip or null, music(), xOf(beat), beatAt(x), gutter, commit(notes), close(), colors() }
export function createRoll(el, host) {
  const canvas = h('canvas', 'tl-roll'), ctx = canvas.getContext('2d');
  el.append(canvas);
  let sel = new Set(), drag = null, view = null, lastSig = '', lastClip = null;

  // the rows shown: the clip's notes, with room around them
  function rows(notes) {
    const ms = notes.map((n) => n.midi), lo = Math.floor(Math.min(...ms, 60) - 5), hi = Math.ceil(Math.max(...ms, 60) + 5);
    return { lo, hi, n: hi - lo + 1 };
  }
  const notesNow = () => view ?? host.clip()?.notes ?? [];
  const yOf = (m, R) => (R.hi - m) * ROW;
  const midiAt = (y, R) => Math.round(R.hi - y / ROW);
  const at = () => host.clip()?.at ?? 0;
  const boxOf = (n, R) => ({ x: host.xOf(at() + n.beat), y: yOf(n.midi, R) - ROW / 2 + 0.5, w: Math.max(3, host.xOf(at() + n.beat + n.len) - host.xOf(at() + n.beat)), h: ROW - 1 });

  function draw() {
    const c = host.clip();
    canvas.hidden = !c;
    if (!c) return;
    const notes = notesNow(), R = rows(c.notes), w = el.clientWidth, hgt = R.n * ROW, dpr = devicePixelRatio || 1, col = host.colors(), m = host.music();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); canvas.style.height = hgt + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const inScale = new Set(scaleNotes(m.scale, m.root).map((x) => Math.round(x)));
    ctx.font = '9px ui-monospace, monospace'; ctx.textBaseline = 'middle';
    for (let k = R.lo; k <= R.hi; k++) {
      const y = yOf(k, R) - ROW / 2;
      if (inScale.has(k)) { ctx.fillStyle = col.ink; ctx.globalAlpha = 0.06; ctx.fillRect(host.gutter, y, w - host.gutter, ROW); ctx.globalAlpha = 1; }
      if (k % 12 === 0 || k === R.lo) { ctx.fillStyle = col.muted; ctx.fillText(noteName(k), host.gutter - 30, y + ROW / 2); ctx.strokeStyle = col.line; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(host.gutter, y + ROW + 0.5); ctx.lineTo(w, y + ROW + 0.5); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    // the clip's span
    ctx.strokeStyle = col.accent; ctx.globalAlpha = 0.5;
    ctx.strokeRect(host.xOf(c.at) + 0.5, 0.5, Math.max(4, host.xOf(c.at + Math.max(1, ...c.notes.map((n) => n.beat + n.len))) - host.xOf(c.at)), hgt - 1);
    ctx.globalAlpha = 1;
    notes.forEach((n, i) => {
      const b = boxOf(n, R);
      if (b.x + b.w < host.gutter) return;
      ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, (n.vel ?? 100) / 127));
      ctx.fillStyle = sel.has(i) ? col.accent : col.ink;
      ctx.fillRect(Math.max(host.gutter, b.x), b.y, b.w - Math.max(0, host.gutter - b.x), b.h);
    });
    ctx.globalAlpha = 1;
    if (drag?.kind === 'box') { ctx.strokeStyle = col.accent; ctx.strokeRect(Math.min(drag.x0, drag.x1) + 0.5, Math.min(drag.y0, drag.y1) + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)); }
  }

  function update() {
    const c = host.clip();
    if (c?.id !== lastClip) { sel = new Set(); view = null; lastClip = c?.id; }
    const sig = `${c?.id}|${c && JSON.stringify(c.notes).length}|${c?.at}|${host.xOf(0)}|${host.xOf(1)}|${[...sel].join()}|${el.clientWidth}|${JSON.stringify(view)?.length}|${JSON.stringify(drag)}`;
    if (sig !== lastSig) { lastSig = sig; draw(); }
  }

  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (x, y) => {
    const c = host.clip(), R = rows(c.notes);
    for (let i = c.notes.length - 1; i >= 0; i--) { const b = boxOf(c.notes[i], R); if (x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1) return { i, end: x > b.x + b.w - EDGE }; }
    return null;
  };
  canvas.addEventListener('pointerdown', (e) => {
    const c = host.clip();
    if (!c || e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a scripted pointer */ }
    const [x, y] = local(e), t = hit(x, y);
    if (!t) { if (!e.shiftKey) sel = new Set(); drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y }; lastSig = ''; return; }
    if (e.shiftKey) { sel.has(t.i) ? sel.delete(t.i) : sel.add(t.i); lastSig = ''; return; }
    if (!sel.has(t.i)) sel = new Set([t.i]);
    drag = { kind: t.end ? 'len' : 'move', x0: x, y0: y, from: c.notes };
    lastSig = '';
  });
  canvas.addEventListener('pointermove', (e) => {
    const c = host.clip();
    const [x, y] = local(e);
    if (!drag) { const t = c && hit(x, y); canvas.style.cursor = t?.end ? 'ew-resize' : t ? 'grab' : 'default'; return; }
    if (drag.kind === 'box') { drag.x1 = x; drag.y1 = y; lastSig = ''; return; }
    const db0 = host.beatAt(x) - host.beatAt(drag.x0), db = e.altKey ? db0 : Math.round(db0 / Q) * Q;
    if (drag.kind === 'move') view = shift(drag.from, sel, db, -Math.round((y - drag.y0) / ROW));
    else view = drag.from.map((n, i) => (sel.has(i) ? { ...n, len: r4(Math.max(1 / 32, n.len + db)) } : n));
    lastSig = '';
  });
  const up = () => {
    if (drag?.kind === 'box') {
      const c = host.clip(), R = rows(c.notes), [x0, x1] = [Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1)], [y0, y1] = [Math.min(drag.y0, drag.y1), Math.max(drag.y0, drag.y1)];
      c.notes.forEach((n, i) => { const b = boxOf(n, R); if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) sel.add(i); });
    } else if (view && JSON.stringify(view) !== JSON.stringify(drag.from)) host.commit(view);
    drag = null; view = null; lastSig = '';
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', (e) => {
    const c = host.clip();
    if (!c) return;
    const [x, y] = local(e);
    if (hit(x, y)) return;
    const R = rows(c.notes), beat = Math.max(0, Math.round((host.beatAt(x) - c.at) / Q) * Q), last = c.notes[c.notes.length - 1];
    host.commit([...c.notes, { beat: r4(beat), midi: midiAt(y, R), vel: last?.vel ?? 100, len: last?.len ?? Q }]);
    sel = new Set([c.notes.length]);
  });

  // keys, while the roll is open and the pointer is over the timeline (not in a field)
  let over = false;
  el.addEventListener('pointerenter', () => { over = true; });
  el.addEventListener('pointerleave', () => { over = false; });
  addEventListener('keydown', (e) => {
    const c = host.clip();
    if (!c || !over || e.target.closest?.('input, textarea, select')) return;
    const k = e.key, m = host.music(), any = sel.size > 0;
    let next = null;
    if (k === 'Escape') { host.close(); }
    else if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'a') { sel = new Set(c.notes.map((_, i) => i)); }
    else if ((k === 'Delete' || k === 'Backspace') && any) next = c.notes.filter((_, i) => !sel.has(i));
    else if ((k === 'ArrowUp' || k === 'ArrowDown') && any) next = transpose(c.notes, sel, k === 'ArrowUp' ? 1 : -1, m, e.shiftKey);
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && any) next = shift(c.notes, sel, k === 'ArrowRight' ? Q : -Q);
    else if (k.toLowerCase() === 'q' && !e.metaKey && !e.ctrlKey) next = quantize(c.notes, any ? sel : null);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (next) { if (next.length < c.notes.length) sel = new Set(); host.commit(next); }
    lastSig = '';
  }, true);

  return { update };
}
