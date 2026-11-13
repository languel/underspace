// Wiring: layout of what is visible at this zoom, tools, toolbar, keys.

import { state, call, undo, take, onChange, listCommands, loadTake } from './space.js';
import { blanketOf, rectOf, ptsOf, portPos, innerXf, setDrag } from './object.js';
import { wirePoints } from './bind.js';
import { createRunner } from './run.js';
import { createView } from './view.js';
import { createFaces } from './faces.js';
import { createSide } from './side.js';
import { PRESETS } from './presets.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), pad = $('pad'), marquee = $('marquee');
const STORE = 'underspace-spike-b-take';

const onParam = (id, name, value) => call('object.set', { id, name, value });
const onCode = (id, code) => call('object.code', { id, code });
const faces = createFaces($('faces'), { onParam, onCode });
const side = createSide($('side'), { onParam, onCode, presets: PRESETS });
const step = createRunner();
const view = await createView({ canvas: $('gl'), stage, onFrame: frame });

// ---- layout: which objects are visible, at which face, and where -----------

const ROOT = { k: 1, ox: 0, oy: 0 };
const at = (xf, p) => [xf.ox + p[0] * xf.k, xf.oy + p[1] * xf.k];
const back = (xf, p) => [(p[0] - xf.ox) / xf.k, (p[1] - xf.oy) / xf.k];
const FAR = 48; // below this many pixels an object shows its far face

let vis = new Map();  // id -> { o, face, px, xf, blanket }
let spaces = [];      // open spaces, outermost first: { id, kind, xf, px }
let lines = [];       // ink in canvas coordinates: { id, pts, color, width }
let sceneList = [];
let lastSig = '', dragSig = '', run = null;

function walk(space, xf) {
  const upp = view.unitsPerPx();
  for (const o of state.objects.values()) {
    if (o.space !== space) continue;
    const sel = state.selection.has(o.id);
    if (o.kind === 'mark') {
      const pts = (o.bind ? wirePoints(state.objects, o) : ptsOf(o)).map((p) => at(xf, p));
      lines.push({ id: o.id, pts, color: sel ? 'accent' : o.bind ? 'hot' : 'ink', width: o.bind ? 1.6 : 2.2 });
      if (o.code == null) { vis.set(o.id, { o, face: 'line', xf }); continue; }
    }
    const r = rectOf(o), [l, t] = view.toScreen(at(xf, [r.cx - r.w / 2, r.cy + r.h / 2]));
    const px = { l, t, w: r.w * xf.k / upp, h: r.h * xf.k / upp };
    const face = Math.max(px.w, px.h) < FAR ? 'far' : (px.w > view.size.w * 0.42 || px.h > view.size.h * 0.5) ? 'near' : 'mid';
    vis.set(o.id, { o, face, px, xf, blanket: blanketOf(o) });
    if (o.kind === 'group' && face === 'near') {
      const i = innerXf(o), inner = { k: xf.k * i.k, ox: xf.ox + i.ox * xf.k, oy: xf.oy + i.oy * xf.k };
      spaces.push({ id: o.id, kind: 'group', xf: inner, px });
      // A thin line from each port on the blanket to the port it stands for.
      for (const s of ['ins', 'outs']) for (const p of o.ports[s]) {
        const target = state.objects.get(p.inner.id), a = target && portPos(target, s, p.inner.port), b = portPos(o, s, p.name);
        if (a && b) lines.push({ pts: [at(inner, a), at(xf, b)], color: 'muted', width: 1 });
      }
      walk(o.id, inner);
    }
    if (o.kind === 'scene' && face !== 'far') {
      spaces.push({ id: o.id, kind: 'scene', px });
      const marks = [...state.objects.values()].filter((m) => m.space === o.id && m.points).map(ptsOf);
      sceneList.push({ id: o.id, px, marks, spin: run.input(o.id, 'spin'), tilt: run.input(o.id, 'tilt') });
    }
  }
}

function frame() {
  run = step(state.objects, performance.now() / 1000);
  vis = new Map(); spaces = [{ id: null, kind: 'canvas', xf: ROOT }]; lines = []; sceneList = [];
  walk(null, ROOT);
  const sig = `${state.version}|${dragSig}|${spaces.map((s) => s.id).join()}`;
  const dirty = sig !== lastSig;
  lastSig = sig;
  if (dirty) view.setLines(lines);
  view.setScenes(sceneList, dirty);
  faces.update(vis, { run, selection: state.selection, w: view.size.w, h: view.size.h });
  const one = state.selection.size === 1 ? state.objects.get([...state.selection][0]) : null;
  const shown = one?.code != null ? one : null;
  side.update(shown, shown && blanketOf(shown), shown && run.errors.get(shown.id));
}

// ---- pointer geometry ------------------------------------------------------

const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const inside = (px, x, y) => x >= px.l && x <= px.l + px.w && y >= px.t && y <= px.t + px.h;
// The innermost open space under a point. Boxes cannot go inside a scene.
function spaceAt(x, y, flatOnly = false) {
  for (let i = spaces.length - 1; i >= 0; i--) {
    const s = spaces[i];
    if (flatOnly && s.kind === 'scene') continue;
    if (!s.px || inside(s.px, x, y)) return s;
  }
  return spaces[0];
}
const toSpace = (s, x, y) => (s.kind === 'scene' ? view.sceneToLocal(s.id, x, y) : back(s.xf, view.toWorld(x, y)));
const unitsPerPx = (s) => view.unitsPerPx() / (s.xf?.k ?? 1);

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
  return Math.hypot(x - (a[0] + k * dx), y - (a[1] + k * dy));
}
const isOpen = (v) => (v.o.kind === 'group' && v.face === 'near') || (v.o.kind === 'scene' && v.face !== 'far');

function pick(x, y) {
  for (let i = lines.length - 1; i >= 0; i--) { // ink first: it is thin
    const l = lines[i];
    if (!l.id) continue;
    const path = l.pts.map(view.toScreen);
    if (path.length === 1 && Math.hypot(path[0][0] - x, path[0][1] - y) < 8) return l.id;
    for (let j = 0; j < path.length - 1; j++) if (segDist(x, y, path[j], path[j + 1]) < 7) return l.id;
  }
  for (const v of [...vis.values()].reverse()) {
    if (v.face === 'line' || !inside(v.px, x, y)) continue;
    // An open group or scene is picked by its top strip or its edge.
    const p = v.px;
    if (isOpen(v) && !(y - p.t < 20 || x - p.l < 8 || p.l + p.w - x < 8 || p.t + p.h - y < 8)) continue;
    return v.o.id;
  }
  return null;
}

// ---- tools -----------------------------------------------------------------

let tool = 'select';
let gesture = null; // what the pointer is doing between down and up
let spaceKey = false;
const round = (v) => Math.round(v * 1e4) / 1e4;

function setTool(name) {
  tool = name;
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === name));
  pad.dataset.tool = name;
}

function showMarquee(a, b) {
  marquee.hidden = false;
  marquee.style.cssText = `left:${Math.min(a[0], b[0])}px;top:${Math.min(a[1], b[1])}px;width:${Math.abs(a[0] - b[0])}px;height:${Math.abs(a[1] - b[1])}px`;
}

pad.addEventListener('pointerdown', (e) => {
  document.activeElement?.blur?.();
  const p = local(e);
  pad.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && spaceKey)) { gesture = { kind: 'pan', last: p }; return; }
  if (e.button !== 0) return;
  if (tool === 'draw') {
    const s = spaceAt(p[0], p[1]), q = toSpace(s, p[0], p[1]);
    if (q) gesture = { kind: 'draw', s, pts: [q], last: p };
  } else if (tool === 'box' || tool === 'scene') {
    gesture = { kind: 'rect', make: tool, s: spaceAt(p[0], p[1], true), start: p, end: p };
  } else {
    const id = pick(p[0], p[1]);
    if (id) {
      if (e.shiftKey) {
        const ids = new Set(state.selection); ids.has(id) ? ids.delete(id) : ids.add(id);
        call('select.set', { ids: [...ids] });
      } else if (!state.selection.has(id)) call('select.set', { ids: [id] });
      const v = vis.get(id);
      // Only what shares the picked object's space moves with it.
      const ids = [...state.selection].filter((i) => state.objects.get(i)?.space === v.o.space);
      gesture = { kind: 'move', k: v.xf.k, ids, start: p, dx: 0, dy: 0, moved: false };
    } else gesture = { kind: 'marquee', s: spaceAt(p[0], p[1], true), start: p, end: p };
  }
});

pad.addEventListener('pointermove', (e) => {
  if (!gesture) return;
  const p = local(e), g = gesture;
  if (g.kind === 'pan') {
    const u = view.unitsPerPx();
    view.cam.cx -= (p[0] - g.last[0]) * u; view.cam.cy += (p[1] - g.last[1]) * u; g.last = p;
  } else if (g.kind === 'draw') {
    if (Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) < 1.5) return;
    const q = toSpace(g.s, p[0], p[1]);
    if (!q) return;
    g.pts.push(q); g.last = p;
    if (g.s.kind === 'scene') view.setPreview(g.pts, g.s.id);
    else view.setPreview(g.pts.map((pt) => at(g.s.xf, pt)));
  } else if (g.kind === 'move') {
    const u = view.unitsPerPx() / g.k;
    g.dx = (p[0] - g.start[0]) * u; g.dy = -(p[1] - g.start[1]) * u;
    if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < 3) return;
    g.moved = true;
    setDrag({ ids: new Set(g.ids), dx: g.dx, dy: g.dy });
    dragSig = g.dx + ',' + g.dy;
  } else { g.end = p; showMarquee(g.start, g.end); }
});

function endGesture() {
  const g = gesture;
  gesture = null;
  marquee.hidden = true;
  if (!g) return;
  if (g.kind === 'draw') {
    view.setPreview(null);
    const tol = g.s.kind === 'scene' ? 0 : 14 * unitsPerPx(g.s);
    call('mark.add', { space: g.s.id, points: g.pts.map((q) => q.map(round)), tol });
  } else if (g.kind === 'move') {
    setDrag(null); dragSig = '';
    if (g.moved) call('object.move', { ids: g.ids, dx: round(g.dx), dy: round(g.dy) });
  } else if (g.kind === 'rect') {
    const a = toSpace(g.s, g.start[0], g.start[1]), b = toSpace(g.s, g.end[0], g.end[1]), u = unitsPerPx(g.s);
    const tiny = Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) < 8;
    const size = g.make === 'scene' ? [360, 260] : [170, 110]; // a click makes one of this size, in pixels
    const rect = tiny
      ? { cx: a[0], cy: a[1], w: size[0] * u, h: size[1] * u }
      : { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
    for (const k in rect) rect[k] = round(rect[k]);
    const id = g.make === 'scene' ? call('scene.add', { space: g.s.id, rect }) : call('box.add', { space: g.s.id, rect, code: PRESETS.osc });
    call('select.set', { ids: [id] });
    setTool('select');
  } else if (g.kind === 'marquee') {
    const [x0, x1] = [Math.min(g.start[0], g.end[0]), Math.max(g.start[0], g.end[0])];
    const [y0, y1] = [Math.min(g.start[1], g.end[1]), Math.max(g.start[1], g.end[1])];
    const ids = [];
    if (x1 - x0 > 3 || y1 - y0 > 3) {
      const ink = new Map(lines.filter((l) => l.id).map((l) => [l.id, l.pts]));
      for (const [id, v] of vis) {
        if (v.o.space !== g.s.id) continue;
        const hitInk = ink.get(id)?.some((pt) => { const q = view.toScreen(pt); return q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1; });
        const hitBox = v.px && v.px.l < x1 && v.px.l + v.px.w > x0 && v.px.t < y1 && v.px.t + v.px.h > y0;
        if (hitInk || hitBox) ids.push(id);
      }
    }
    if (ids.length || state.selection.size) call('select.set', { ids });
  }
}
pad.addEventListener('pointerup', endGesture);
pad.addEventListener('pointercancel', endGesture);

// Double-click an object to go to it; double-click the canvas to see everything.
pad.addEventListener('dblclick', (e) => {
  const p = local(e), v = vis.get(pick(p[0], p[1]));
  if (!v || v.face === 'line') return fit();
  const r = rectOf(v.o), c = at(v.xf, [r.cx, r.cy]);
  view.frame({ cx: c[0], cy: c[1], w: r.w * v.xf.k, h: r.h * v.xf.k }, 0.82);
});

function fit() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of state.objects.values()) {
    if (o.space !== null || o.bind) continue;
    const r = rectOf(o);
    x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2); y0 = Math.min(y0, r.cy - r.h / 2); y1 = Math.max(y1, r.cy + r.h / 2);
  }
  if (x0 === Infinity) { view.cam.cx = 0; view.cam.cy = 0; view.cam.zoom = 1; return; }
  view.frame({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }, 0.8);
}

// Wheel pans; pinch or ctrl+wheel zooms about the pointer.
pad.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = local(e);
  if (e.ctrlKey || e.metaKey) view.zoomAt(p[0], p[1], Math.exp(-e.deltaY * 0.01));
  else { const u = view.unitsPerPx(); view.cam.cx += e.deltaX * u; view.cam.cy -= e.deltaY * u; }
}, { passive: false });
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

// ---- actions and toolbar ---------------------------------------------------

const selected = () => [...state.selection];
const actions = {
  code() { // attach code to plain marks: the drawing becomes an object
    for (const id of selected()) { const o = state.objects.get(id); if (o?.kind === 'mark' && !o.bind && o.code == null) call('object.code', { id, code: PRESETS.path }); }
  },
  collapse() { if (state.selection.size) call('group.collapse', { ids: selected() }); },
  expand() { for (const id of selected()) if (state.objects.get(id)?.kind === 'group') call('group.expand', { id }); },
  remove() { if (state.selection.size) call('object.remove', { ids: selected() }); },
  undo,
  fit,
  save() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(take)], { type: 'application/json' }));
    a.download = 'underspace-take.json'; a.click(); URL.revokeObjectURL(a.href);
  },
  open() { $('file').click(); },
  clear() { call('space.clear'); },
  side() { document.body.classList.toggle('noside'); },
  clean() { document.body.classList.toggle('clean'); },
};
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) try { loadTake(JSON.parse(await f.text())); fit(); } catch (err) { console.warn(err.message); }
});

// [name, tip, key shown in the tip]; '' is a gap.
const BAR = [
  ['tool:select', 'Select', 'V'], ['tool:draw', 'Draw', 'D'], ['tool:box', 'Box', 'B'], ['tool:scene', 'Scene', 'S'], '',
  ['code', 'Attach code to a mark', 'C'], ['collapse', 'Collapse', 'G'], ['expand', 'Expand', 'E'], ['remove', 'Delete', '⌫'], '',
  ['undo', 'Undo', '⌘Z'], ['fit', 'Fit', 'F'], ['save', 'Save take'], ['open', 'Open take'], ['clear', 'Clear'], '',
  ['side', 'Sidebar', '\\'], ['clean', 'Hide panels', 'Tab'],
];
for (const item of BAR) {
  if (!item) { $('tools').append(document.createElement('hr')); continue; }
  const [name, tip, key] = item, b = document.createElement('button');
  b.title = key ? `${tip} (${key})` : tip; b.setAttribute('aria-label', tip);
  if (name.startsWith('tool:')) { b.dataset.tool = name.slice(5); b.innerHTML = icon(b.dataset.tool); b.onclick = () => setTool(b.dataset.tool); }
  else { b.innerHTML = icon(name); b.onclick = actions[name]; }
  $('tools').append(b);
}
$('peek').innerHTML = icon('clean');
$('peek').onclick = actions.clean;

const KEYS = { v: () => setTool('select'), d: () => setTool('draw'), b: () => setTool('box'), s: () => setTool('scene'),
  c: actions.code, g: actions.collapse, e: actions.expand, f: fit, backspace: actions.remove, delete: actions.remove,
  '\\': actions.side, tab: actions.clean, escape: () => { if (state.selection.size) call('select.set', { ids: [] }); } };
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.key === ' ') { spaceKey = true; pad.dataset.pan = '1'; e.preventDefault(); return; }
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'z') { e.preventDefault(); undo(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (KEYS[key]) { e.preventDefault(); KEYS[key](); }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceKey = false; delete pad.dataset.pan; } });

// ---- keep the take between visits; ?demo builds a small example ------------

let saveTimer = 0;
onChange(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(take)); } catch {} }, 400); });

function demo() {
  const by = 'demo', c = (name, args) => call(name, args, by);
  c('space.clear');
  const osc = c('box.add', { rect: { cx: -6, cy: 2, w: 2.4, h: 1.6 }, code: PRESETS.osc });
  const scale = c('box.add', { rect: { cx: -2.2, cy: 2, w: 2.4, h: 1.6 }, code: PRESETS.scale });
  const scene = c('scene.add', { rect: { cx: 4, cy: 0.5, w: 6, h: 4.6 } });
  const curl = c('mark.add', { points: Array.from({ length: 40 }, (_, i) => [round(-7 + i * 0.12), round(-2 + Math.sin(i * 0.4) * 0.8)]), tol: 0 });
  c('object.code', { id: curl, code: PRESETS.path });
  const link = (a, out, b, inn) => {
    const p = portPos(state.objects.get(a), 'outs', out), q = portPos(state.objects.get(b), 'ins', inn);
    const pts = Array.from({ length: 12 }, (_, i) => { const u = i / 11; return [round(p[0] + (q[0] - p[0]) * u), round(p[1] + (q[1] - p[1]) * u + Math.sin(u * Math.PI) * 0.35)]; });
    c('mark.add', { points: pts, tol: 0.05 });
  };
  link(osc, 'y', scale, 'x'); link(scale, 'y', scene, 'spin'); link(curl, 'y', scene, 'tilt');
  for (let k = 0; k < 3; k++) c('mark.add', { space: scene, points: Array.from({ length: 30 }, (_, i) => [round(Math.cos(i * 0.3 + k * 2) * (1 + i * 0.08)), round(Math.sin(i * 0.3 + k * 2) * (1 + i * 0.08))]), tol: 0 });
  c('select.set', { ids: [] });
}

const query = new URLSearchParams(location.search);
if (query.has('demo')) demo();
else if (!query.has('new')) {
  try { const saved = JSON.parse(localStorage.getItem(STORE)); if (saved) loadTake(saved); } catch { localStorage.removeItem(STORE); }
}
setTool('select');
fit();

window.underspace = { call, commands: listCommands, state, take, undo, view, backend: view.backend };
