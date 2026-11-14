// Wiring: layout by zoom, gestures, and the action table that the toolbar,
// keys, context menus and palette all read.

import { state, call, batch, define, undo, redo, take, onChange, loadTake, tools, history, travel, stats, argTypes as T } from './space.js';
import './patch.js';
import { stepsOnScreen, TARGET_PRESETS, pressureRuns } from './object.js';
import { blanketOf, rectOf, ptsOf, portPos, innerXf, outline, smooth, simplifyIndex, along, setDrag, setLive, setMoved, penOf, isLine, isTarget, hasCode, isWire } from './object.js';
import { selectionProps, toolProps } from './panels/properties.js';
import { wirePoints } from './bind.js';
import { createRunner } from './run.js';
import { createView } from './view.js';
import { createFaces } from './faces.js';
import { createPanels } from './panel.js';
import { codePanel } from './panels/code.js';
import { propertiesPanel } from './panels/properties.js';
import { outlinerPanel } from './panels/outliner.js';
import { examplesPanel } from './panels/examples.js';
import { docsPanel } from './panels/docs.js';
import { helpPanel } from './panels/help.js';
import { settingsPanel } from './panels/settings.js';
import { settings, setSetting, onSettings } from './settings.js';
import { colorField } from './controls.js';
import { createPalette } from './palette.js';
import { showMenu, showPopover, closeMenu } from './menu.js';
import { scripted, endpoint, listModels } from './assistant.js';
import { sketchKind } from './sketch.js';
import { PRESETS } from './presets.js';
import { BRUSHES } from './brushes.js';
import { read as readScore } from './score.js';
import * as sound from './sound.js';
import { createPlay, nearestU, EVENTS, renderNotes } from './play.js';
import { icon } from './icons.js';
import { createPoints, without } from './points.js';
import { createModal, apply, applyRect } from './transform.js';
import { snapPoints, snapBox, toSVG, toP5 } from './selection.js';
import { showPie, recognize } from './pie.js';
import { createTransport } from './transport.js';
import { createDebug } from './debug.js';
import { magnet, MAGNETS, MAGNET_TITLE } from './magnet.js';
import { edgesOf, weld, extrude } from './mesh.js';
import { EXAMPLES } from './examples.js';
import { GRID, GRID_PRESETS, gridAt, pathBeats, snapPoint, fitScale, isGrid } from './grid.js';
import { POINT_KINDS, MIDINOUS_KINDS, GLYPH_TITLE, glyphLines } from './glyphs.js';
import { createTimeline } from './timeline.js';
import { pitch as pitchOf, step as stepOf, snap as snapOf, secPerBeat, degrees } from './music.js';
import { midiFile, readNotes, createMidiOut } from './midi.js';
import { iannixPlan, applyPlan } from './iannix.js';
import { nousPlan, applyNous, nodeCodeFor } from './nous.js';
import { INSTRUMENTS, DEFAULT_CHANNELS } from './instruments.js';
import { solve, crossings, measure, atU, atS, tangentS, curveOf, isCurve, JUNCTIONS } from './joints.js';
import { createInk, element, UNIT } from './ink/layer.js';
import { BRUSHES as INK, brushesFor } from './ink/brushes.js';
import { SCULPTS, sculptMark, effectiveSculpt } from './ink/sculpt.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), pad = $('pad'), marquee = $('marquee'), dotLayer = $('dots');
const STORE = 'underspace-take';
const round = (v) => Math.round(v * 1e4) / 1e4;
const get = (id) => state.objects.get(id);
const gridCell = () => state.grid.cell; // the global grid's cell, in canvas units

const onParam = (id, name, value) => call('object.set', { id, name, value });
const onCode = (id, code) => { step.restart(id); call('object.code', { id, code }); };
const faces = createFaces($('faces'), { onParam, onCode });
const step = createRunner();
const ink = createInk($('ink'));
const playEngine = createPlay();
// One clock for everything that plays (transport.js); notes played while recording become a clip.
const transport = createTransport(), midiOut = createMidiOut();
let movedNow = new Map(); // where travelers are now (play.js), [x, y] or [x, y, z]
let litNow = new Set(); // the nodes and events lit now (their lights: play.js)
let recNotes = [], lastBeat = 0, lastWrap = 0, clipDrag = null, timeline = null;
// Performance and errors (debug.js): created before the first frame, so it can catch that frame's errors.
const dbg = createDebug($('debug'), () => ({ objects: state.objects.size, riders: playEngine.riders(), steps: take.clips.length, settle: stats.settleMs.toFixed(1) + 'ms' }));
const view = await createView({ canvas: $('gl'), stage, onFrame: frame });
addEventListener('message', (e) => { if (e.data?.underspace) step.report(e.data.underspace, e.data); });

// ---- layout: which objects are visible, at which face, and where -----------

const ROOT = { k: 1, ox: 0, oy: 0 };
const FOV = 40 * Math.PI / 180; // a target's camera's field of view (view.js uses the same)
const at = (xf, p) => [xf.ox + p[0] * xf.k, xf.oy + p[1] * xf.k];
const back = (xf, p) => [(p[0] - xf.ox) / xf.k, (p[1] - xf.oy) / xf.k];
const FAR = 48; // below this many pixels an object shows its far face

let vis = new Map();  // id -> { o, face, px, xf, blanket }
let spaces = [];      // open spaces, outermost first: { id, kind, xf, px, plane }
let lines = [];       // ink in canvas coordinates: { id, pts, color, width }
let ink3d = [];       // lines inside targets: { id, scene, pts }
let sceneList = [], dots = []; // dots: [x, y] a path's cursor, [x, y, h] a score's playhead
let inkItems = [];    // brushed marks, for the 2D ink layer
let pointSrc = [];    // lines whose control points the points tool shows: { o, pts, pen, xf } or { o, pts, pen, scene }
let inkColor = '#1d1c1a', lastCam = '';
let lastSig = '', dragSig = '', run = null, orbit = null;

// A target's resting camera: what is stored, or what a navigation in progress has made of it.
const camOf = (o) => (orbit?.id === o.id ? orbit : { az: o.az ?? 0.5, el: o.el ?? 0.3, dist: o.dist ?? 13, center: o.center ?? [0, 0, 0] });

// Where a brushed object goes on the ink layer: brush units to stage pixels.
function inkItem(o, e, xf, st) {
  const origin = view.toScreen(at(xf, [0, 0]));
  return { e, brush: o.brush.id, params: o.brush.params, seed: Number(o.id.slice(1)) || 1, straight: st.path === 'straight', opacity: st.opacity, ox: origin[0], oy: origin[1], scale: xf.k / (UNIT * view.unitsPerPx()) };
}

function walk(space, xf) {
  const upp = view.unitsPerPx();
  for (const o of state.objects.values()) {
    if (o.space !== space || o.hidden) continue;
    const sel = state.selection.has(o.id), blanket = blanketOf(o), st = o.style ?? {};
    if (o.kind === 'joint') {
      // where lines meet: a small ring, or its glyph (a Midinous node); lit by a traveler or selected, it fills; a pin is hot
      const c = at(xf, jointAt(o)), lit = litNow.has(o.id) || performance.now() - (playEngine.hitAt.get(o.id) ?? -1e9) < 160, q = view.toScreen(c);
      if (o.glyph) for (const g of glyphLines(o.glyph, c, (sel || lit ? 6.5 : 5.5) * upp)) lines.push({ id: o.id, pts: g.pts, color: sel ? 'accent' : lit ? 'hot' : st.stroke ?? 'ink', width: 1.4, fill: g.fill ? (sel ? 'accent' : lit ? 'hot' : st.fill ?? st.stroke ?? 'ink') : null });
      else { const r = (sel || lit ? 5 : 3.2) * upp; lines.push({ id: o.id, pts: outline({ cx: c[0], cy: c[1], w: r * 2, h: r * 2 }, 'ellipse'), color: sel ? 'accent' : o.fix || lit ? 'hot' : 'ink', width: 1.3, fill: sel ? 'accent' : lit ? 'hot' : o.fix ? null : st.fill ?? 'line' }); }
      vis.set(o.id, { o, face: 'joint', px: { l: q[0] - 7, t: q[1] - 7, w: 14, h: 14 }, xf, blanket });
      continue;
    }
    if (o.kind === 'point') {
      // a point: its glyph at its size (it scales with the view, as ink does)
      const r = rectOf(o), c = at(xf, [r.cx, r.cy]), lit = litNow.has(o.id) || (o.role === 'event' && performance.now() - (playEngine.hitAt.get(o.id) ?? -1e9) < 160), q = view.toScreen(c), half = Math.max(r.w * xf.k / 2, 2.5 * upp);
      for (const g of glyphLines(o.glyph ?? 'dot', c, half)) lines.push({ id: o.id, pts: g.pts, color: sel ? 'accent' : lit ? 'hot' : st.stroke ?? 'ink', width: st.width ?? 1.6, fill: g.fill ? (sel ? 'accent' : lit ? 'hot' : st.fill ?? st.stroke ?? 'ink') : null, opacity: st.opacity });
      const pxr = Math.max(7, half / upp);
      vis.set(o.id, { o, face: 'joint', px: { l: q[0] - pxr, t: q[1] - pxr, w: pxr * 2, h: pxr * 2 }, xf, blanket });
      continue;
    }
    if (isLine(o)) {
      const made = run.shown.get(o.id);
      const raw = isWire(o) ? wirePoints(state.objects, o) : made ?? ptsOf(o);
      // smooth through its points, in as many pieces as it is long on screen (it stays smooth when seen near)
      const pts = (st.path === 'straight' || o.closed ? raw : smooth(raw, stepsOnScreen(xf.k / upp))).map((p) => at(xf, p));
      const brushed = o.brush && !isWire(o);
      // A brushed line is painted on the ink layer; here it is only something to pick, and an outline while selected.
      if (brushed) inkItems.push(inkItem(o, element(raw, penOf(o), { closed: !!o.closed, color: st.stroke ?? inkColor }), xf, st));
      // pen pressure as width, as grease pencil does (Settings › pressure: everywhere)
      const runs = settings.pressureWidth === 'everywhere' && !brushed && !isWire(o) && !made && !o.closed && st.path !== 'straight' ? pressureRuns(raw, penOf(o), st.width ?? 2.2, stepsOnScreen(xf.k / upp)) : null;
      if (runs) for (const r of runs) lines.push({ id: o.id, pts: r.pts.map((p) => at(xf, p)), color: sel ? 'accent' : st.stroke ?? 'ink', width: r.width, opacity: st.opacity });
      else lines.push({ id: o.id, pts, color: sel ? 'accent' : st.stroke ?? (isWire(o) ? 'hot' : 'ink'), width: brushed ? (sel ? 1 : 0) : st.width ?? (isWire(o) ? 1.6 : 2.2), opacity: brushed ? 1 : st.opacity, fill: o.closed && !brushed ? st.fill : null });
      // an event keeps its look; a traveler reaching it flashes it
      if (o.role === 'event' && performance.now() - (playEngine.hitAt.get(o.id) ?? -1e9) < 160) lines.push({ pts, color: 'hot', width: (st.width ?? 2.2) + 3, opacity: 0.6 });
      if (tool === 'points' && !isWire(o) && !made) pointSrc.push({ o, pts: ptsOf(o), pen: penOf(o), xf });
      const cursor = run.cursors.get(o.id);
      if (cursor) dots.push(view.toScreen(at(xf, cursor)));
      if (!blanket) { vis.set(o.id, { o, face: 'line', xf }); continue; }
    }
    const r = rectOf(o), [l, t] = view.toScreen(at(xf, [r.cx - r.w / 2, r.cy + r.h / 2]));
    const px = { l, t, w: r.w * xf.k / upp, h: r.h * xf.k / upp };
    if (o.role === 'traveler' && o.kind === 'shape' && !o.keeps) lines.push({ id: o.id, pts: outline(r, 'ellipse').map((p) => at(xf, p)), color: sel ? 'accent' : st.stroke ?? 'hot', width: 1.6, fill: st.fill ?? st.stroke ?? 'hot', opacity: st.opacity ?? 0.85 });
    if (o.role === 'event' && o.kind === 'shape' && !o.keeps) { const lit = performance.now() - (playEngine.hitAt.get(o.id) ?? -1e9) < 160; lines.push({ id: o.id, pts: outline(r, o.shape).map((p) => at(xf, p)), color: sel ? 'accent' : st.stroke ?? 'hot', width: lit ? 3 : 1.4, fill: lit ? st.stroke ?? 'hot' : st.fill, opacity: lit ? 0.5 : st.opacity }); }
    if (o.kind === 'shape' && (o.role === 'visual' || o.keeps)) {
      if (o.keeps && performance.now() - (playEngine.hitAt.get(o.id) ?? -1e9) < 160) lines.push({ pts: outline(r, o.shape).map((p) => at(xf, p)), color: 'hot', width: (st.width ?? 2.2) + 3, opacity: 0.6 });
      const edge = outline(r, o.shape);
      if (o.brush) inkItems.push(inkItem(o, element(edge.slice(0, -1), null, { closed: true, role: 'plane', color: st.fill ?? st.stroke ?? inkColor }), xf, { ...st, path: o.shape === 'rect' ? 'straight' : null }));
      lines.push({ id: o.id, pts: edge.map((p) => at(xf, p)), color: sel ? 'accent' : st.stroke ?? 'ink', width: o.brush ? (sel ? 1 : 0) : st.width ?? 2.2, opacity: o.brush ? 1 : st.opacity, fill: o.brush ? null : st.fill });
    }
    const face = Math.max(px.w, px.h) < FAR ? 'far' : (px.w > view.size.w * 0.42 || px.h > view.size.h * 0.5) ? 'near' : 'mid';
    vis.set(o.id, { o, face, px, xf, blanket });
    if (o.role === 'grid') {
      // a grid frame: its outline, and its cells (sub-points as dots would be too many)
      const g = paramsOf(o), cell = Math.max(0.01, g.cell ?? 1), x0 = r.cx - r.w / 2, y0 = r.cy - r.h / 2, nx = Math.floor(r.w / cell + 1e-6), ny = Math.floor(r.h / cell + 1e-6);
      lines.push({ id: o.id, pts: outline(r, 'rect').map((p) => at(xf, p)), color: sel ? 'accent' : st.stroke ?? 'muted', width: 1.2 });
      if (nx <= 200 && ny <= 200 && cell * xf.k / upp > 5) {
        for (let i = 1; i < nx + (r.w / cell - nx > 1e-6 ? 1 : 0); i++) lines.push({ pts: [at(xf, [x0 + i * cell, y0]), at(xf, [x0 + i * cell, y0 + r.h])], color: 'muted', width: 0.6, opacity: 0.45 });
        for (let j = 1; j < ny + (r.h / cell - ny > 1e-6 ? 1 : 0); j++) lines.push({ pts: [at(xf, [x0, y0 + j * cell]), at(xf, [x0 + r.w, y0 + j * cell])], color: 'muted', width: 0.6, opacity: 0.45 });
      }
    }
    if (o.role === 'score') { const pos = scorePos(o); if (pos >= 0 && face !== 'far') dots.push([px.l + px.w * pos, px.t, px.h]); }
    if (o.kind === 'group' && face === 'near') {
      const i = innerXf(o), inner = { k: xf.k * i.k, ox: xf.ox + i.ox * xf.k, oy: xf.oy + i.oy * xf.k };
      spaces.push({ id: o.id, kind: 'group', xf: inner, px });
      // A thin line from each port on the blanket to the port it stands for.
      for (const s of ['ins', 'outs']) for (const p of o.ports[s]) {
        const target = get(p.inner.id), a = target && portPos(target, s, p.inner.port), b = portPos(o, s, p.name);
        if (a && b) lines.push({ pts: [at(inner, a), at(xf, b)], color: 'muted', width: 1 });
      }
      walk(o.id, inner);
    }
    if (isTarget(o) && face !== 'far') {
      spaces.push({ id: o.id, kind: 'scene', px, plane: o.plane ?? 'view', origin: (o.anchor ?? 'origin') === 'origin' ? [0, 0, 0] : o.cursor ?? [0, 0, 0], focused: face === 'near' || sel });
      const marks = [], cam0 = camOf(o), ppu = px.h / (2 * cam0.dist * Math.tan(FOV / 2)); // about how many pixels a unit is, at the centre
      for (const m of state.objects.values()) {
        if (m.space !== o.id || !m.points || m.hidden) continue;
        const raw = ptsOf(m), mst = m.style ?? {}, pts = m.closed || mst.path === 'straight' ? raw : smooth(raw, stepsOnScreen(ppu));
        if (m.closed) pts.push(pts[0]);
        const color = state.selection.has(m.id) ? 'accent' : mst.stroke ?? 'ink', width = mst.width ?? 2.2;
        // its pen pressure as its width (grease pencil), its fill when it is closed
        const runs = settings.pressureWidth !== 'off' && !m.closed && mst.path !== 'straight' ? pressureRuns(raw, penOf(m), width, stepsOnScreen(ppu)) : null;
        if (m.closed && mst.fill) marks.push({ pts, color, width: 0, fill: mst.fill, opacity: mst.opacity });
        if (runs) for (const r of runs) marks.push({ pts: r.pts, color, width: r.width, opacity: mst.opacity });
        else marks.push({ pts, color, width, opacity: mst.opacity });
        ink3d.push({ id: m.id, scene: o.id, pts });
        if (tool === 'points') pointSrc.push({ o: m, pts: ptsOf(m), pen: penOf(m), scene: o.id });
        vis.set(m.id, { o: m, face: 'line', scene: o.id });
      }
      for (const j of state.objects.values()) {
        if (j.kind !== 'joint' || j.space !== o.id) continue;
        const c = jointAt(j), d = 0.12, sel = state.selection.has(j.id), color = sel ? 'accent' : j.fix ? 'hot' : 'ink';
        for (let k = 0; k < 3; k++) { const a = [c[0], c[1], c[2] ?? 0], b = a.slice(); a[k] -= d; b[k] += d; marks.push({ pts: [a, b], color }); ink3d.push({ id: j.id, scene: o.id, pts: [a, b] }); }
        vis.set(j.id, { o: j, face: 'joint', scene: o.id });
      }
      // meshes (Poly Build): faces filled, edges drawn; corners shown while building or selected
      for (const me of state.objects.values()) {
        if (me.kind !== 'mesh' || me.space !== o.id || me.hidden) continue;
        const vs = ptsOf(me), mst = me.style ?? {}, msel = state.selection.has(me.id), used = new Set(me.faces.flat());
        for (const f of me.faces) marks.push({ pts: [...f.map((i) => vs[i]), vs[f[0]]], color: 'ink', width: 0, fill: mst.fill ?? '#8f8a80', opacity: mst.opacity ?? 0.55 });
        for (const e of edgesOf(me.faces)) { const pts = [vs[e.a], vs[e.b]]; marks.push({ pts, color: msel ? 'accent' : mst.stroke ?? 'ink', width: e.faces === 1 ? 1.8 : 1.1 }); ink3d.push({ id: me.id, scene: o.id, pts }); }
        vs.forEach((v, i) => {
          if (!(tool === 'poly' || msel || !used.has(i))) return;
          const d = 0.07, color = msel ? 'accent' : 'hot';
          for (let k = 0; k < 3; k++) { const a = v.slice(), b = v.slice(); a[k] -= d; b[k] += d; marks.push({ pts: [a, b], color, width: 2 }); if (!used.has(i)) ink3d.push({ id: me.id, scene: o.id, pts: [a, b] }); }
        });
        vis.set(me.id, { o: me, face: 'line', scene: o.id });
      }
      // travelers on its lines: a small star where each is
      for (const tr of state.objects.values()) {
        if (tr.role !== 'traveler' || tr.space !== o.id || tr.kind !== 'shape') continue;
        const c = movedNow.get(tr.id) ?? (() => { const l = get(tr.on); return l ? atU(measure(curveOf(l, ptsOf(l))), paramsOf(tr).start ?? 0) : null; })();
        if (!c) continue;
        const d = 0.22, sel = state.selection.has(tr.id), color = sel ? 'accent' : tr.style?.stroke ?? 'hot';
        for (const [a, b] of [[[d, 0, 0], [-d, 0, 0]], [[0, d, 0], [0, -d, 0]], [[0, 0, d], [0, 0, -d]], [[d * 0.6, d * 0.6, 0], [-d * 0.6, -d * 0.6, 0]], [[d * 0.6, -d * 0.6, 0], [-d * 0.6, d * 0.6, 0]]]) {
          const pts = [[c[0] + a[0], c[1] + a[1], (c[2] ?? 0) + a[2]], [c[0] + b[0], c[1] + b[1], (c[2] ?? 0) + b[2]]];
          marks.push({ pts, color }); ink3d.push({ id: tr.id, scene: o.id, pts });
        }
        vis.set(tr.id, { o: tr, face: 'joint', scene: o.id });
      }
      if (guide?.scene === o.id) marks.push({ pts: [-1, 1].map((k) => guide.pivot.map((v, i) => v + guide.axis[i] * 60 * k)), color: 'hot' });
      // its 3D cursor, when the drawing plane hangs from it
      if ((o.anchor ?? 'origin') === 'cursor') { const c = o.cursor ?? [0, 0, 0], d = 0.35; for (let k = 0; k < 3; k++) { const a = c.slice(), b = c.slice(); a[k] -= d; b[k] += d; marks.push({ pts: [a, b], color: 'hot' }); } }
      const cam = camOf(o);
      // what its code returns this frame: { spin, tilt, zoom, center } (a target without code: its spin and tilt inputs)
      const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d), ctl = (k) => (o.code != null ? run.output(o.id, k) : run.input(o.id, k));
      const zoom = Math.max(0.05, num(ctl('zoom'), 1)), off = ctl('center');
      sceneList.push({
        id: o.id, px, marks, dist: cam.dist / zoom,
        center: Array.isArray(off) ? cam.center.map((c, i) => c + num(off[i])) : cam.center,
        az: cam.az + num(ctl('spin')) * Math.PI,
        el: cam.el + num(ctl('tilt')),
      });
    }
  }
}

// Where lines on the canvas cross without a joint: a small mark at each (a view setting). Worked out
// again only when the drawing changes, and given up past a bound so a dense drawing does not stall.
let crossCache = { v: -1, pts: [] };
function crossingMarks() {
  if (crossCache.v !== state.version) {
    const ls = [...state.objects.values()].filter((o) => isCurve(o) && o.space === null && !o.hidden && o.role !== 'event'), paths = ls.map(shownPath), out = [];
    let work = 0;
    for (let i = 0; i < ls.length && work < 4e6; i++) for (let j = i + 1; j < ls.length && work < 4e6; j++) {
      work += paths[i].length * paths[j].length;
      for (const x of crossings(paths[i], paths[j])) if (!(jointHolding(ls[i].id, x.ua) && jointHolding(ls[j].id, x.ub))) out.push(x.at);
    }
    crossCache = { v: state.version, pts: out };
  }
  const upp = view.unitsPerPx();
  for (const p of crossCache.pts) for (const g of glyphLines('plus', p, 5 * upp)) lines.push({ pts: g.pts, color: 'hot', width: 1.2 });
}

// ---- sliding along a line, quantized ---------------------------------------------
// A node (a joint on one line) or a traveler slides along its line. Quantized (settings.quant
// beats, while Q is on), it lands on the divisions of the time it takes to get there along the
// line: its lap from a traveler on it, else from its grid, else a grid cell a beat.
let sliding = null; // { id, u, line } while a slide is under way
const slideLineOf = (o) => (o?.kind === 'joint' && o.at?.length === 1 ? get(o.at[0].id) : o?.role === 'traveler' && isCurve(get(o.on)) ? get(o.on) : null);
function lapBeatsOf(line) {
  const path = shownPath(line), len = measure(path).total;
  for (const t of travelers()) {
    if (t.on !== line.id) continue;
    const p = paramsOf(t);
    if (p.speed > 0) return len / (p.speed * gridCell());
    if (p.dur > 0) return p.dur;
  }
  const b = pathBeats(path, gridHere(line.space, path[path.length >> 1]));
  return b > 0 ? b : Math.max(0.25, len / gridCell());
}
function quantU(line, u) {
  const lap = lapBeatsOf(line), q = settings.quant;
  return q > 0 && lap > 0 ? Math.max(0, Math.min(1, (Math.round((u * lap) / q) * q) / lap)) : u;
}
// The divisions as ticks across the line: taller on beats, taller still on bars.
function quantTicks(line) {
  const lap = lapBeatsOf(line), q = settings.quant, v = vis.get(line.id);
  if (!(q > 0) || !v?.xf || lap / q > 512) return;
  const path = shownPath(line), m = measure(path), upp = view.unitsPerPx() / v.xf.k, per = state.music.meter[0];
  for (let k = 0; k * q <= lap + 1e-9; k++) {
    const b = k * q, s = Math.min(m.total, (b / lap) * m.total), p = atS(m, s), t = tangentS(m, s), bar = Math.abs(b / per - Math.round(b / per)) < 1e-6, beat = Math.abs(b - Math.round(b)) < 1e-6;
    const h = (bar ? 9 : beat ? 6 : 3.5) * upp, nx = -t[1] * h, ny = t[0] * h;
    lines.push({ pts: [at(v.xf, [p[0] - nx, p[1] - ny]), at(v.xf, [p[0] + nx, p[1] + ny])], color: 'hot', width: bar ? 1.6 : 1, opacity: bar ? 0.95 : beat ? 0.75 : 0.5 });
  }
}
function quantPreview() {
  // while sliding; or, with Q on, for a selected node or traveler
  const ids = sliding ? [sliding.line] : settings.quantOn ? [...state.selection].map((id) => slideLineOf(get(id))?.id).filter(Boolean) : [];
  for (const id of new Set(ids)) { const l = get(id); if (l) quantTicks(l); }
}

// The riders a traveler has split into: copies of it, drawn where each one is.
function ghostsOf(list) {
  for (const g of list) {
    const o = get(g.of), v = vis.get(g.of);
    if (!o || !v?.xf) continue;
    const st = o.style ?? {};
    if (o.kind === 'line') {
      const pts = ptsOf(o), c = rectOf(o), dx = g.pos[0] - c.cx, dy = g.pos[1] - c.cy;
      lines.push({ pts: curveOf(o, pts.map((p) => [p[0] + dx, p[1] + dy])).map((p) => at(v.xf, p)), color: st.stroke ?? 'ink', width: st.width ?? 2.2, opacity: 0.7 });
    } else {
      const r = { cx: g.pos[0], cy: g.pos[1], w: o.rect.w, h: o.rect.h };
      lines.push({ pts: outline(r, o.keeps ? o.shape : 'ellipse').map((p) => at(v.xf, p)), color: st.stroke ?? (o.keeps ? 'ink' : 'hot'), width: 1.4, fill: o.keeps ? st.fill : st.fill ?? st.stroke ?? 'hot', opacity: 0.6 });
    }
  }
}

// ---- scores ----------------------------------------------------------------

// A score's reading: its parameters, with what it leaves to the timeline (bpm 0, low or high 0, scale -1) filled in.
function scoreParams(o) {
  const b = blanketOf(o), p = {}, m = state.music;
  for (const q of b.params) p[q.name] = o.params?.[q.name] ?? q.value;
  if (!(p.bpm > 0)) p.bpm = m.bpm;
  if (!(p.low > 0)) p.low = m.low;
  if (!(p.high > 0)) p.high = m.high;
  if ((p.scale ?? -1) < 0) { p.steps = degrees(m.scale); p.root = m.root; }
  p.beats = Math.max(0.25, p.beats ?? 8);
  return p;
}
// What a score will play on its next pass: the lines in its frame, read now.
function scoreOf(id) {
  const o = get(id);
  if (!o || o.role !== 'score') return null;
  const lines = [...state.objects.values()].filter((l) => isLine(l) && !l.bind && l.space === o.space).map((l) => ({ id: l.id, points: run?.shown.get(l.id) ?? ptsOf(l) }));
  return { ...readScore(lines, rectOf(o), scoreParams(o)), source: o.code };
}
const scores = () => [...state.objects.values()].filter((o) => o.role === 'score');

// Scores play on the transport: pass k of a score begins at k times its length on the timeline,
// so pause, seek and the loop cut it and pick it up partway. Passes are scheduled a little ahead.
const scorePlan = new Map(); // id -> { k: the next pass to schedule, L: its length (s) }
let scoreSet = null;         // the scores that play: ids, or null for all
const passLen = (o) => { const p = scoreParams(o); return Math.max(0.25, (p.beats * 60) / p.bpm); };
const scorePlaying = (o) => !o.hidden && (!scoreSet || scoreSet.has(o.id));
let nextClick = null; // the next beat the metronome clicks on
function scoreTick() {
  if (!transport.playing) return;
  const now = transport.t, aNow = sound.audioNow();
  // the metronome: each beat a little ahead, on the audio clock; the bar's first beat higher
  if (settings.metronome) {
    const spb = transport.spb;
    if (nextClick == null || nextClick * spb < now - 0.05) nextClick = Math.ceil(now / spb - 1e-6);
    while (nextClick * spb - now < 0.25) { sound.click(aNow + (nextClick * spb - now), nextClick % state.music.meter[0] === 0); nextClick++; }
  } else nextClick = null;
  for (const [id] of scorePlan) if (get(id)?.role !== 'score' || !scorePlaying(get(id))) { sound.silence(id); scorePlan.delete(id); }
  for (const o of scores()) {
    if (!scorePlaying(o)) continue;
    const L = passLen(o), report = (error) => step.report(o.id, { error: error ?? '' });
    let plan = scorePlan.get(o.id);
    if (plan && Math.abs(plan.L - L) > 1e-6) { sound.silence(o.id); plan = null; } // its tempo or length changed
    if (!plan) {
      const k = Math.floor(now / L), into = now - k * L, sc = scoreOf(o.id);
      if (sc) sound.schedulePass(o.id, sc, aNow - into, into, report);
      plan = { k: k + 1, L };
    }
    if (plan.k * L < now - L) plan.k = Math.floor(now / L) + 1; // back from a hidden tab: the passes it missed are gone
    while (plan.k * L - now < 0.25) { const sc = scoreOf(o.id); if (sc) sound.schedulePass(o.id, sc, aNow + (plan.k * L - now), 0, report); plan.k++; }
    scorePlan.set(o.id, plan);
  }
}
setInterval(scoreTick, 40);
function resetScores() { sound.silenceAll(); scorePlan.clear(); nextClick = null; }
// How far through its pass a score is, 0..1, or -1 when it is not playing.
const scorePos = (o) => (transport.playing && scorePlaying(o) && scorePlan.has(o.id) ? (transport.t % passLen(o)) / passLen(o) : -1);
// Space: pause what is playing; otherwise play from where the transport is: the selected scores
// (or all of them), the travelers and the recorded clips.
const travelers = () => [...state.objects.values()].filter((o) => o.role === 'traveler');
const canPlay = () => scores().length || travelers().length || state.clips.size;
function togglePlay(c = context()) {
  if (transport.playing) { transport.pause(); resetScores(); playEngine.quiet(); endRecording(); return; }
  const chosen = c.sel.filter((o) => o.role === 'score');
  scoreSet = chosen.length ? new Set(chosen.map((o) => o.id)) : null;
  lastBeat = transport.beat;
  transport.play();
  scoreTick();
}
// Back to the start (or the loop's start), everything at rest.
function rewind() { resetScores(); endRecording(); transport.stop(); playEngine.reset(); catchUp(); }
// Move the playhead: travelers are run there from the start, silently, so they are where they would be.
function seek(sec) { transport.seek(sec); catchUp(); }
function catchUp() {
  resetScores();
  playEngine.reset();
  const t = transport.t, h = { ...musicHooks(), note() {} }, dt = Math.max(1 / 30, t / 3000);
  if (t > 0) for (let x = 0; x <= t + 1e-9; x += dt) playEngine.step(state.objects, Math.min(x, t), true, h);
  lastBeat = transport.beat;
}
// What travelers, events and junctions play with: the music context, and notes that are heard, sent and recorded.
function musicHooks() {
  const m = state.music;
  return { pointsOf: shownPath, paramsOf, note: playNote, hold: holdNote, cc: (n, v, ch = 1) => midiOut.send([0xb0 | ((ch - 1) & 15), n & 127, Math.max(0, Math.min(127, Math.round(v)))]), spb: secPerBeat(m), grid: gridCell(), gridAt: (space, p) => gridHere(space, p), pitch: (v) => pitchOf(v, m), step: (n, k) => stepOf(n, k, m.scale, m.root), snap: (n) => snapOf(n, m.scale, m.root) };
}
// The instrument a channel plays (the timeline's choice, else the default).
const instrumentOf = (ch = 1) => state.music.channels?.[ch] ?? DEFAULT_CHANNELS[ch] ?? 'triangle';
function playNote(midi, vel = 100, seconds = 0.3, ch = 1) {
  if (!Number.isFinite(midi)) return;
  sound.note(midi, vel, seconds, instrumentOf(ch)); midiOut.note(midi, vel, seconds, ch);
  if (transport.recording && transport.playing) recNotes.push({ beat: transport.beat, midi, vel, len: seconds / transport.spb, ch });
}
// A note held until it is let go (an event's gate): heard, sent, and recorded with its length.
function holdNote(midi, vel = 100, ch = 1) {
  if (!Number.isFinite(midi)) return { stop() {} };
  const a = sound.hold(midi, vel, instrumentOf(ch)), b = midiOut.hold(midi, vel, ch), beat = transport.beat, rec = transport.recording && transport.playing;
  return { stop() { a.stop(); b.stop(); if (rec) recNotes.push({ beat, midi, vel, len: Math.max(1 / 16, transport.beat - beat), ch }); } };
}
// Recording from rest starts after a bar of clicks (with the metronome on), so the hand is ready.
function countIn(then) {
  if (!settings.metronome) return then();
  const spb = secPerBeat(state.music), per = state.music.meter[0], a = sound.audioNow() + 0.05;
  for (let k = 0; k < per; k++) sound.click(a + k * spb, k === 0);
  setTimeout(then, (per * spb + 0.05) * 1000);
}
// What was recorded becomes a clip on the timeline, starting on the beat it began.
function endRecording() {
  if (!recNotes.length) return;
  const at = Math.floor(Math.min(...recNotes.map((n) => n.beat)));
  call('clip.add', { at, notes: recNotes.map((n) => ({ ...n, beat: n.beat - at })) });
  recNotes = [];
}
// Recorded clips play on the transport: the notes the playhead has passed since the last frame.
function playClips() {
  const b = transport.beat;
  if (!transport.playing || b < lastBeat) { lastBeat = b; return; }
  for (const c of state.clips.values()) {
    if (c.muted) continue;
    const at = clipDrag?.id === c.id ? clipDrag.at : c.at;
    for (const n of c.notes) { const nb = at + n.beat; if (nb > lastBeat && nb <= b) { sound.note(n.midi, n.vel, n.len * transport.spb, instrumentOf(n.ch)); midiOut.note(n.midi, n.vel, n.len * transport.spb, n.ch ?? 1); } }
  }
  lastBeat = b;
}
// A line as it is shown: what a traveler follows.
const shownPath = (l) => curveOf(l, run?.shown.get(l.id) ?? ptsOf(l));
const paramsOf = (o) => { const p = {}; for (const q of blanketOf(o)?.params ?? []) p[q.name] = o.params?.[q.name] ?? q.value; if (sliding?.id === o.id && o.role === 'traveler') p.start = sliding.u; return p; };

let laidOut = -1; // the state version the last layout was made from
// One frame. An error in it is noted (debug.js) and the next frame tries again, rather than
// the drawing stopping for good.
function frame() {
  try { frameInner(); } catch (e) { dbg.error(e, 'frame'); } finally { dbg.frame(); }
}
function frameInner() {
  laidOut = state.version;
  for (const o of scores()) { const pos = scorePos(o); if (pos >= 0) step.report(o.id, { out: { pos } }); }
  // Travelers move and events fire before the code objects run, so their outputs are this frame's.
  transport.spb = secPerBeat(state.music);
  const t = transport.t;
  if ((transport.wrapped ?? 0) !== lastWrap) { lastWrap = transport.wrapped; catchUp(); } // the loop came round
  const played = dbg.time('play', () => playEngine.step(state.objects, t, transport.playing, musicHooks()));
  playClips();
  setMoved(played.moved);
  movedNow = played.moved;
  litNow = played.lit ?? new Set();
  let playSig = 0;
  for (const [id, out] of played.out) { step.report(id, { out, error: played.errors.get(id) ?? '' }); if (out.u != null) playSig += out.x * 3 + out.y * 7; }
  for (const g of played.ghosts) playSig += g.pos[0] * 5 + g.pos[1] * 11;
  for (const id of litNow) playSig += id.length * 31 + 1;
  for (const [id, when] of playEngine.hitAt) if (performance.now() - when < 160) playSig += when + id.length;
  run = dbg.time('code', () => step(state.objects, performance.now() / 1000));
  vis = new Map(); spaces = [{ id: null, kind: 'canvas', xf: ROOT }]; lines = []; ink3d = []; sceneList = []; dots = []; inkItems = []; pointSrc = [];
  dbg.time('layout', () => { walk(null, ROOT); ghostsOf(played.ghosts); if (settings.showCrossings) crossingMarks(); quantPreview(); });
  if (guide && !guide.scene) lines.push({ pts: [-1, 1].map((k) => at(guide.xf, [guide.pivot[0] + guide.axis[0] * 1e4 * k, guide.pivot[1] + guide.axis[1] * 1e4 * k])), color: 'hot', width: 1 });
  // Lines that code makes can change every frame; a cheap fingerprint tells.
  let made = 0;
  for (const pts of run.shown.values()) { const m = pts[pts.length >> 1]; made += pts.length + m[0] * 7 + m[1] * 13; }
  // the zoom, in steps of about a fifth, and each target's camera distance: curves are cut finer as they are seen nearer
  const near = Math.round(Math.log2(view.cam.zoom) * 4) + '/' + sceneList.map((s) => Math.round(Math.log2(s.dist) * 4)).join(',');
  const sig = `${state.version}|${dragSig}|${near}|${settings.quantOn}${settings.quant}|${spaces.map((s) => s.id).join()}|${made}|${playSig}`;
  const dirty = sig !== lastSig;
  lastSig = sig;
  if (dirty) dbg.time('lines', () => view.setLines(lines));
  // The ink layer is repainted when the drawing or the view changes.
  const camKey = `${view.cam.cx},${view.cam.cy},${view.cam.zoom},${view.size.w},${view.size.h},${inkColor}`;
  if (dirty || camKey !== lastCam) dbg.time('ink', () => { lastCam = camKey; ink.resize(view.size.w, view.size.h); ink.draw(inkItems); });
  dbg.time('scenes', () => view.setScenes(sceneList, dirty));
  showPoints();
  dbg.time('faces', () => faces.update(vis, { run, selection: state.selection, w: view.size.w, h: view.size.h, code: settings.codeOverlay, ground: settings.codeOpacity }));
  while (dotLayer.children.length < dots.length) dotLayer.append(document.createElement('i'));
  while (dotLayer.children.length > dots.length) dotLayer.lastChild.remove();
  dots.forEach((d, i) => {
    const el = dotLayer.children[i];
    el.className = d[2] ? 'bar' : '';
    el.style.cssText = `transform:translate(${d[0].toFixed(1)}px,${d[1].toFixed(1)}px)` + (d[2] ? `;height:${d[2].toFixed(1)}px` : '');
  });
  dbg.time('panels', () => { panels.update(); timeline?.update(); });
  zoomLabel.textContent = Math.round(view.cam.zoom * 100) + '%';
  // The grid is the stage's own background, moved and scaled with the view.
  if (settings.grid) {
    let cell = gridCell() / view.unitsPerPx();
    while (cell < 14) cell *= 5;
    const o = view.toScreen([0, 0]);
    stage.style.setProperty('--g', cell.toFixed(2) + 'px');
    stage.style.setProperty('--gx', (o[0] % cell).toFixed(2) + 'px');
    stage.style.setProperty('--gy', (o[1] % cell).toFixed(2) + 'px');
  }
}

// ---- pointer geometry ------------------------------------------------------

const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const inside = (px, x, y) => x >= px.l && x <= px.l + px.w && y >= px.t && y <= px.t + px.h;
// The innermost open space under a point. flatOnly skips targets.
function spaceAt(x, y, flatOnly = false) {
  for (let i = spaces.length - 1; i >= 0; i--) {
    const s = spaces[i];
    if (flatOnly && s.kind === 'scene') continue;
    if (!s.px || inside(s.px, x, y)) return s;
  }
  return spaces[0];
}
const toSpace = (s, x, y) => (s.kind === 'scene' ? view.sceneToLocal(s.id, x, y, s.plane, s.origin) : back(s.xf, view.toWorld(x, y)));
const unitsPerPx = (s) => view.unitsPerPx() / (s.xf?.k ?? 1);

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
  return Math.hypot(x - (a[0] + k * dx), y - (a[1] + k * dy));
}
function onPath(path, x, y, tol = 7) {
  if (path.length === 1) return Math.hypot(path[0][0] - x, path[0][1] - y) < tol + 1;
  for (let j = 0; j < path.length - 1; j++) if (path[j] && path[j + 1] && segDist(x, y, path[j], path[j + 1]) < tol) return true;
  return false;
}
// Open objects show what is in them: they are picked by their edge, not their middle.
const isOpen = (v) => (v.o.kind === 'group' && v.face === 'near') || (isTarget(v.o) && v.face !== 'far') || ((v.o.role === 'score' || v.o.role === 'grid') && v.face !== 'far');

function pick(x, y) {
  const free = (id) => !get(id)?.locked;
  for (const v of vis.values()) if (v.face === 'joint' && v.px && free(v.o.id) && Math.hypot(v.px.l + v.px.w / 2 - x, v.px.t + v.px.h / 2 - y) < Math.max(7, v.px.w / 2)) return v.o.id;
  for (const l of ink3d) if (free(l.id) && onPath(l.pts.map((p) => view.sceneToScreen(l.scene, p)), x, y)) return l.id;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].id && free(lines[i].id) && onPath(lines[i].pts.map(view.toScreen), x, y)) return lines[i].id; // ink first: it is thin
  for (const v of [...vis.values()].reverse()) {
    if (!v.px || v.o.locked || !inside(v.px, x, y)) continue;
    // An open group or target is picked by its top strip or its edge.
    const p = v.px;
    if (isOpen(v) && !(y - p.t < 20 || x - p.l < 8 || p.l + p.w - x < 8 || p.t + p.h - y < 8)) continue;
    return v.o.id;
  }
  return null;
}

// A port under the pointer, on any object showing its blanket.
function portAt(x, y) {
  for (const v of vis.values()) {
    if (!v.blanket || v.face === 'far' || v.face === 'joint' || !v.px) continue;
    for (const s of ['outs', 'ins']) for (const name of v.blanket[s]) {
      const q = view.toScreen(at(v.xf, portPos(v.o, s, name)));
      if (Math.hypot(q[0] - x, q[1] - y) < 9) return { v, side: s, name };
    }
  }
  return null;
}

// ---- joints: lines that touch connect (joints.js) ----------------------------

// Where a joint is now: on its first line as that line is shown, so it moves with a drag in progress.
function jointAt(j) {
  const r = rectOf(j);
  if (j.rect && (r.cx !== j.rect.cx || r.cy !== j.rect.cy)) return [r.cx, r.cy]; // the joint itself is being dragged
  const q = j.at?.[0], l = q && get(q.id);
  if (!l?.points || l.space !== j.space) return j.pos;
  const pts = ptsOf(l), u = sliding?.id === j.id ? sliding.u : q.u;
  return atU(measure(curveOf(l, pts)), u).slice(0, pts[0].length > 2 ? 3 : 2);
}
// While something is dragged, what is joined to it follows: live, not yet a command.
function follow(live, held) {
  setLive(live.size ? live : null);
  if (![...state.objects.values()].some((o) => o.kind === 'joint' || o.keep)) return;
  const { points } = solve(state.objects, { hold: new Set(held), pts: ptsOf, rect: rectOf });
  if (!points.size) return;
  const all = new Map(live);
  for (const [id, p] of points) if (!all.has(id)) all.set(id, { points: p, pen: get(id)?.pen });
  setLive(all);
}
const TOUCH = 10; // pixels: this close, things touch
// What a point of the stage touches in space s, other than the lines in `not`:
// a joint, the end of a line, or a line anywhere along it. { joint } | { id, u, slide?, end? }, with `px` where.
function touching(s, p, not = new Set()) {
  const scr = s.kind === 'scene' ? (q) => view.sceneToScreen(s.id, q) : (q) => view.toScreen(at(s.xf, q));
  let best = null;
  const consider = (hit, q, rank) => { if (!q) return; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < TOUCH && (!best || rank < best.rank || (rank === best.rank && d < best.d))) best = { ...hit, px: q, d, rank }; };
  for (const j of state.objects.values()) if (j.kind === 'joint' && j.space === s.id && !j.fix && !j.at.every((q) => not.has(q.id))) consider({ joint: j.id }, scr(jointAt(j)), 0);
  for (const l of state.objects.values()) {
    if (!isCurve(l) || l.space !== s.id || l.hidden || not.has(l.id)) continue;
    const path = shownPath(l), sp = path.map(scr);
    if (sp.some((q) => !q)) continue;
    if (!l.closed) { consider({ id: l.id, u: 0, end: true }, sp[0], 1); consider({ id: l.id, u: 1, end: true }, sp[sp.length - 1], 1); }
    const m = measure(path);
    for (let i = 1; i < sp.length; i++) {
      const a = sp[i - 1], b = sp[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, k = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      consider({ id: l.id, u: m.total ? (m.cum[i - 1] + k * (m.cum[i] - m.cum[i - 1])) / m.total : 0, slide: true }, [a[0] + dx * k, a[1] + dy * k], 2);
    }
  }
  return best;
}
// The joint that already holds a line at u, if any.
const jointHolding = (id, u) => [...state.objects.values()].find((j) => j.kind === 'joint' && j.at.some((q) => q.id === id && Math.abs(q.u - u) < 1e-3));
// Join the end of line `id` at u (seen at stage point p) to what it touches. Returns the joint, or null.
function joinEnd(s, id, u, p, not) {
  if (jointHolding(id, u)) return null;
  const t = touching(s, p, not ?? new Set([id]));
  if (!t) return null;
  const into = t.joint ?? (t.end ? jointHolding(t.id, t.u)?.id : null);
  if (into) return call('joint.add', { into, at: [{ id, u }] });
  return call('joint.add', { at: [{ id, u }, { id: t.id, u: round(t.u), ...(t.slide ? { slide: true } : {}) }] });
}
// After lines were drawn or moved: their ends join what they now touch.
function joinTouching(list, not = new Set(list)) {
  for (const id of list) {
    const l = get(id);
    if (!isCurve(l) || l.closed) continue;
    const s = spaces.find((x) => x.id === l.space) ?? (l.space === null ? spaces[0] : null);
    if (!s) continue;
    const scr = s.kind === 'scene' ? (q) => view.sceneToScreen(s.id, q) : (q) => view.toScreen(at(s.xf, q)), pts = ptsOf(l);
    for (const [u, q] of [[0, pts[0]], [1, pts[pts.length - 1]]]) { const p = scr(q); if (p) joinEnd(s, id, u, p, not); }
  }
}
// Join selected lines where they cross each other or any line in their space.
function joinCrossings(c) {
  batch(() => {
    const done = new Set();
    for (const l of c.lines.filter((o) => isCurve(o) && get(o.space)?.role !== 'target')) {
      for (const o of state.objects.values()) {
        if (o === l || !isCurve(o) || o.space !== l.space || o.hidden || done.has(o.id + '|' + l.id)) continue;
        done.add(l.id + '|' + o.id);
        for (const x of crossings(shownPath(l), shownPath(o))) {
          if (jointHolding(l.id, x.ua) && jointHolding(o.id, x.ub)) continue;
          call('joint.add', { at: [{ id: l.id, u: round(x.ua) }, { id: o.id, u: round(x.ub) }] });
        }
      }
    }
  });
}
const snapMark = $('snapmark');
function showTouch(t) {
  snapMark.hidden = !t;
  if (t) { snapMark.style.transform = `translate(${t.px[0].toFixed(1)}px, ${t.px[1].toFixed(1)}px)`; snapMark.dataset.kind = t.joint ? 'joint' : t.end ? 'end' : 'on'; }
}
const lineHasJoints = (o) => [...state.objects.values()].some((j) => j.kind === 'joint' && j.at.some((q) => q.id === o.id));

// ---- the magnet: where a point placed in a target lands (magnet.js) ---------------

// The pointer in a target, through the magnet: on a stroke near it, on the drawing plane's lattice,
// or on the plane. exclude: a line not to snap to (the one being moved); from: where a move began.
function magnetIn(s, p, { exclude = null, from = null, off = false } = {}) {
  const onPlane = toSpace(s, p[0], p[1]);
  if (s.kind !== 'scene' || off) return onPlane ? { point: onPlane, kind: 'free' } : null;
  const strokes = [];
  for (const o of state.objects.values()) {
    if (o.kind === 'mesh' && o.space === s.id && !o.hidden) { const vs = ptsOf(o); strokes.push({ points: o.id === exclude ? [] : vs, curve: [] }); for (const e of edgesOf(o.faces)) strokes.push({ points: [], curve: [vs[e.a], vs[e.b]] }); continue; }
    if (o.space !== s.id || o.kind !== 'line' || o.id === exclude || o.hidden || !(o.points?.length > 0)) continue;
    const pts = ptsOf(o);
    strokes.push({ points: pts, curve: curveOf(o, pts) });
  }
  const basis = view.planeBasis(s.id, s.plane);
  return magnet({ mode: settings.magnet, pointer: p, onPlane, strokes, toScreen: (q) => view.sceneToScreen(s.id, q), plane: basis && { origin: s.origin ?? [0, 0, 0], u: basis.u, v: basis.v }, cell: settings.magnetCell, from });
}
// The snap marker at what the magnet caught (nothing when it caught nothing).
function showMagnet(s, m) {
  if (!m || m.kind === 'free') { showTouch(null); return; }
  const q = view.sceneToScreen(s.id, m.point);
  if (!q) { showTouch(null); return; }
  snapMark.hidden = false;
  snapMark.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px)`;
  snapMark.dataset.kind = m.kind;
}

// ---- the points tool --------------------------------------------------------

const handles = createPoints($('handles'));
// The handles of the selected lines, or with no line selected, of every line.
function showPoints() {
  if (tool !== 'points') { if (handles.shown.length) handles.set([]); return; }
  const only = pointSrc.some((l) => state.selection.has(l.o.id)), list = [];
  for (const l of pointSrc) {
    if (only && !state.selection.has(l.o.id)) continue;
    l.pts.forEach((p, i) => {
      const q = l.scene ? view.sceneToScreen(l.scene, p) : view.toScreen(at(l.xf, p));
      if (q) list.push({ id: l.o.id, i, x: q[0], y: q[1], p, pen: l.pen?.[i], scene: l.scene, xf: l.xf });
    });
    if (list.length > 6000) break;
  }
  handles.set(list);
}
// Where the picked points of each line go when the pointer has moved (dx, dy) pixels.
function movedPoints(g, dx, dy) {
  const out = new Map();
  for (const [id, m] of g.lines) {
    const pts = m.pts.map((p) => p.slice()), u = m.scene ? 0 : view.unitsPerPx() / m.xf.k;
    for (const i of m.idx) {
      const p = m.pts[i];
      if (!m.scene) { pts[i] = snapHere(get(id)?.space ?? null, [p[0] + dx * u, p[1] - dy * u]).map(round).concat(p.slice(2)); continue; }
      // In a target a point slides on the drawing plane through where it was.
      const q = view.sceneToScreen(m.scene, p), s = spaces.find((x) => x.id === m.scene);
      const through = { ...s, origin: [p[0], p[1], p[2] ?? 0] }, mg = q && s && magnetIn(through, [q[0] + dx, q[1] + dy], { exclude: id, from: p }), r = mg?.point;
      if (r) pts[i] = r.map(round);
    }
    out.set(id, { points: pts, pen: m.pen });
  }
  return out;
}
function removePoints() {
  batch(() => {
    for (const [id, idx] of handles.byLine()) {
      const o = get(id);
      if (!o) continue;
      const left = without(ptsOf(o), o.pen, idx);
      if (left) call('line.set', { id, points: left.points.map((p) => p.map(round)), ...(left.pen ? { pen: left.pen } : {}) });
      else call('object.remove', { ids: [id] });
    }
  });
  handles.picked.clear();
}

// ---- grab, rotate, scale (G, R, S, as in Blender) ----------------------------

let guide = null; // the axis a transform is held to: { scene, pivot, axis, xf }
const readout = $('readout');
// The last session died (a crash, or the page was killed): say so, briefly; ⌥D shows what was logged.
if (dbg.crashed) { readout.hidden = false; readout.textContent = '⚠ the last session ended without closing · ⌥D'; setTimeout(() => { readout.hidden = true; }, 5000); }
// What G, R and S move: the picked points (points tool), or the selected objects; one space at a time.
function transformItems() {
  if (laidOut !== state.version) frame();
  let out;
  if (tool === 'points' && handles.picked.size) {
    out = [];
    for (const [id, idx] of handles.byLine()) { const src = pointSrc.find((l) => l.o.id === id); if (src) out.push({ id, pts: src.pts, idx, pen: src.pen, scene: src.scene, xf: src.xf }); }
  } else {
    out = [...state.selection].map(get).filter((o) => o && !o.bind && o.role !== 'traveler' && !o.locked && vis.get(o.id)).map((o) => {
      const v = vis.get(o.id);
      return v.scene ? { id: o.id, pts: ptsOf(o), scene: v.scene } : o.rect ? { id: o.id, rect: rectOf(o), xf: v.xf } : { id: o.id, pts: ptsOf(o), pen: o.pen, xf: v.xf };
    });
  }
  const sp = out.length ? get(out[0].id).space : null;
  return out.filter((it) => get(it.id).space === sp);
}
const transformed = (it, t) => { const idx = it.idx && new Set(it.idx); return it.pts.map((p, i) => (!idx || idx.has(i) ? apply(t, p) : p)); };
const modal = createModal({
  items: transformItems,
  local,
  unitsPerPx: (it) => view.unitsPerPx() / (it.xf?.k ?? 1),
  toScreen: (it, p) => (it.scene ? view.sceneToScreen(it.scene, p) : view.toScreen(at(it.xf, p))),
  toLocal: (it, x, y, plane, through) => view.sceneToLocal(it.scene, x, y, plane, through),
  basis: (scene) => view.planeBasis(scene, 'view'),
  snap: (v) => snap(v),
  preview(items, t, axis) {
    const live = new Map(), rects = new Map();
    for (const it of items) {
      if (it.rect) rects.set(it.id, applyRect(t, it.rect));
      else live.set(it.id, { points: transformed(it, t), pen: it.pen ?? get(it.id)?.pen });
    }
    setDrag(rects.size ? { ids: new Set(rects.keys()), rects } : null); follow(live, items.map((it) => it.id));
    guide = axis ? { scene: items[0].scene, pivot: t.pivot, axis, xf: items[0].xf } : null;
    dragSig = 'transform' + (++transformN);
  },
  commit(items, t) {
    this.cancel();
    if (items.some((it) => it.idx)) {
      batch(() => { for (const it of items) call('line.set', { id: it.id, points: transformed(it, t).map((p) => p.map(round)), ...(it.pen?.length === it.pts.length ? { pen: it.pen } : {}) }); if (laidOut !== state.version) frame(); joinTouching(items.map((it) => it.id)); });
      return;
    }
    const a = { ids: items.map((it) => it.id), pivot: t.pivot.map(round) };
    if (t.d.some(Boolean)) Object.assign(a, { dx: round(t.d[0]), dy: round(t.d[1]) }, t.d[2] ? { dz: round(t.d[2]) } : {});
    if (t.angle) Object.assign(a, { angle: round((t.angle * 180) / Math.PI), axis: t.axis.map(round) });
    if (t.s.some((v) => v !== 1)) Object.assign(a, { sx: round(t.s[0]), sy: round(t.s[1]) }, t.s[2] !== 1 ? { sz: round(t.s[2]) } : {});
    if (a.dx != null || a.angle != null || a.sx != null) batch(() => { call('object.transform', a); if (laidOut !== state.version) frame(); joinTouching(a.ids); });
  },
  cancel() { setLive(null); setDrag(null); guide = null; dragSig = ''; },
  readout(text) { readout.hidden = !text; readout.textContent = text ?? ''; },
});
let transformN = 0;
const canTransform = (c) => (tool === 'points' && handles.picked.size) || c.sel.some((o) => !o.bind && o.role !== 'traveler' && !o.locked);
const transform = (mode) => modal.start(mode, pointer ?? centre());

// ---- what the context menu does to a selection --------------------------------

// The point of a line nearest the pointer, in the line's space, and how far along it is.
function onLineAt(l, p) {
  const s = spaces.find((x) => x.id === l.space) ?? spaces[0], q = toSpace(s, p[0], p[1]), path = shownPath(l), u = nearestU(path, q[0], q[1]);
  return { s, u, at: along(path, u) };
}
const flatLine = (o) => isLine(o) && !o.bind && get(o.space)?.role !== 'target';
// The line nearest a point of a space, other than `not`.
function nearestLine(space, x, y, not) {
  let best = null, bestD = Infinity;
  for (const l of state.objects.values()) {
    if (!flatLine(l) || l.space !== space || l.id === not || l.hidden) continue;
    const path = shownPath(l), u = nearestU(path, x, y), q = along(path, u), d = Math.hypot(q[0] - x, q[1] - y);
    if (d < bestD) { bestD = d; best = { l, u, at: q }; }
  }
  return best;
}
function attachToNearest(c) {
  batch(() => {
    for (const o of c.shapes) {
      const r = rectOf(o), near = nearestLine(o.space, r.cx, r.cy, o.on);
      if (!near) continue;
      if (o.role === 'traveler') call('traveler.attach', { id: o.id, on: near.l.id, u: round(near.u) });
      else call('object.move', { ids: [o.id], dx: round(near.at[0] - r.cx), dy: round(near.at[1] - r.cy) });
    }
  });
}
function simplifyLines(c, px) {
  batch(() => {
    for (const l of c.lines.filter(flatLine)) {
      const v = vis.get(l.id), pts = ptsOf(l), keep = simplifyIndex(pts, px * view.unitsPerPx() / (v?.xf?.k ?? 1));
      if (keep.length < pts.length && keep.length >= 2) call('line.set', { id: l.id, points: keep.map((i) => pts[i].map(round)), ...(l.pen?.length === pts.length ? { pen: keep.map((i) => l.pen[i]) } : {}) });
    }
  });
}
function snapSelection(c, mode, k = 1) {
  const q = gridCell() * k;
  batch(() => {
    for (const o of c.sel) {
      if (o.bind || o.locked) continue;
      if (mode === 'topleft' || mode === 'center') { const d = snapBox(rectOf(o), q, mode); if (d[0] || d[1]) call('object.move', { ids: [o.id], dx: round(d[0]), dy: round(d[1]) }); continue; }
      if (!flatLine(o)) continue;
      const pts = ptsOf(o), r = snapPoints(pts, q, mode);
      call('line.set', { id: o.id, points: r.points, ...(o.pen?.length === pts.length ? { pen: r.keep.map((i) => o.pen[i]) } : {}) });
    }
  });
}
// The selection as marks on the canvas (y up), for SVG and p5.
function marksOf(c) {
  const out = [];
  for (const o of c.sel) {
    const v = vis.get(o.id), st = o.style ?? {};
    if (!v?.xf) continue;
    const look = { stroke: st.stroke, fill: st.fill, width: st.width };
    if (isLine(o)) out.push({ ...look, pts: shownPath(o).map((p) => at(v.xf, p)), closed: o.closed });
    else if (o.rect) out.push({ ...look, rect: worldRect(v), shape: o.shape });
  }
  return out;
}
// The selection with everything inside it, the travelers on it and the connectors between it.
function copyJSON(c) {
  const ids = new Set(), add = (id) => { if (ids.has(id)) return; ids.add(id); for (const o of state.objects.values()) if (o.space === id || o.on === id) add(o.id); };
  for (const o of c.sel) if (!o.bind) add(o.id);
  for (const w of state.objects.values()) if (w.bind && ids.has(w.bind.from.id) && ids.has(w.bind.to.id)) ids.add(w.id);
  const objects = [...state.objects.values()].filter((o) => ids.has(o.id));
  navigator.clipboard?.writeText(JSON.stringify({ underspace: 1, objects }));
}
const clip = (text) => navigator.clipboard?.writeText(text);

// Scale lines about their first point so each takes a whole number of bars (the grid's `bars`, else
// whole beats) in the grid it lies in; a grid that does not time paths counts a cell a beat.
function fitToGrid(list) {
  batch(() => {
    for (const l of list) {
      const path = shownPath(l), g0 = gridHere(l.space, path[path.length >> 1]), g = g0.beats > 0 ? g0 : { ...g0, beats: 1 };
      const unit = g.bars > 0 ? g.bars : 1, beats = (pathBeats(path, { ...g, bars: 0 })), target = Math.max(unit, Math.round(beats / unit) * unit), k = fitScale(path, g, target);
      if (Math.abs(k - 1) > 1e-4) { const p0 = ptsOf(l)[0]; call('object.transform', { ids: [l.id], pivot: [round(p0[0]), round(p0[1])], sx: round(k), sy: round(k) }); }
    }
  });
}

// ---- points, polylines, polygons -----------------------------------------------

// The point tool: on a joint, it gives the joint the tool's glyph (and for a Midinous kind, that
// kind's code); on a point, its glyph; on a line, a node there (travelers that pass run its code);
// anywhere else, a point.
const isNodeCode = (code) => !code || code === JUNCTIONS['round robin'] || /^\/\/ (note|cc|gate|led|counter|switch|terminator|anchor)\b/.test(code);
function setGlyph(list, kind) {
  batch(() => {
    for (const o of list) {
      const code = o.kind === 'joint' && MIDINOUS_KINDS.includes(kind) && isNodeCode(o.code) ? nodeCodeFor(kind) : null;
      call('object.glyph', { ids: [o.id], glyph: kind, ...(code ? { code } : {}) });
    }
  });
}
function placePoint(s, p) {
  if (s.kind === 'scene') return; // points inside a 3D space: later
  const kind = settings.pointGlyph, hit = get(pick(p[0], p[1]));
  if (hit?.kind === 'point' || hit?.kind === 'joint') { setGlyph([hit], kind); call('select.set', { ids: [hit.id] }); return; }
  const t = touching(s, p);
  batch(() => {
    let id;
    if (t?.joint) { setGlyph([get(t.joint)], kind); id = t.joint; }
    else if (t) id = call('joint.add', { at: [{ id: t.id, u: round(settings.quantOn ? quantU(get(t.id), t.u) : t.u) }], node: true, glyph: kind, ...(MIDINOUS_KINDS.includes(kind) ? { code: nodeCodeFor(kind) } : {}) });
    else { const q = snapHere(s.id, toSpace(s, p[0], p[1])); id = call('point.add', { space: s.id, at: q.map(round), glyph: kind, size: round(settings.pointSize * unitsPerPx(s)), ...(settings.stroke ? { style: { stroke: settings.stroke } } : {}) }); }
    if (id) call('select.set', { ids: [id] });
  });
}

// The polyline tool: a click a corner; double-click or Enter ends it, Escape drops it; a last
// click on the first corner closes it (filled with the fill swatch).
let poly = null; // { s, pts, px }
function addPolyPoint(s, p) {
  const sp = poly?.s ?? s, q0 = sp.kind === 'scene' ? magnetIn(sp, p, { from: poly?.pts.at(-1) })?.point : toSpace(sp, p[0], p[1]);
  if (!q0) return;
  const q = sp.kind === 'scene' ? q0 : snapHere(sp.id, q0);
  if (poly && Math.hypot(p[0] - poly.px.at(-1)[0], p[1] - poly.px.at(-1)[1]) < 3) return; // the second press of a double-click
  if (!poly) poly = { s, pts: [q], px: [p] }; else { poly.pts.push(q); poly.px.push(p); }
  previewPoly(p);
}
function previewPoly(p) {
  if (!poly) return;
  const end = p && toSpace(poly.s, p[0], p[1]), pts = end ? [...poly.pts, end] : poly.pts;
  if (poly.s.kind === 'scene') view.setPreview(pts, poly.s.id); else view.setPreview(pts.map((pt) => at(poly.s.xf, pt)), null, 'accent');
}
function finishPoly(keep = true) {
  const g = poly; poly = null; view.setPreview(null);
  if (!keep || !g || g.pts.length < 2) return;
  const closed = g.pts.length > 3 && Math.hypot(g.px[0][0] - g.px.at(-1)[0], g.px[0][1] - g.px.at(-1)[1]) < 8;
  const pts = closed ? g.pts.slice(0, -1) : g.pts;
  batch(() => {
    const id = call('line.add', { space: g.s.id, points: pts.map((q) => q.map(round)), ...(closed ? { closed: true } : {}), style: { path: 'straight', ...(settings.stroke ? { stroke: settings.stroke } : {}), ...(closed && settings.fill ? { fill: settings.fill } : {}), ...(settings.width !== 2.2 ? { width: settings.width } : {}) } });
    if (id && !closed && g.s.kind !== 'scene') { joinEnd(g.s, id, 0, g.px[0]); joinEnd(g.s, id, 1, g.px.at(-1)); }
    if (id) call('select.set', { ids: [id] });
  });
}
// A regular polygon (or a star) in a box { cx, cy, w, h }, as points, the first at the top.
function polygonPts(r, n = settings.polySides, star = settings.polyStar) {
  const k = star ? n * 2 : n;
  return Array.from({ length: k }, (_, i) => { const a = Math.PI / 2 + (i / k) * Math.PI * 2, f = star && i % 2 ? 0.45 : 1; return [r.cx + Math.cos(a) * r.w / 2 * f, r.cy + Math.sin(a) * r.h / 2 * f]; });
}
// The polygon tool, on the canvas: a closed straight line, filled with the fill swatch.
function polygonAt(g) {
  const a = toSpace(g.s, g.start[0], g.start[1]), b = toSpace(g.s, g.end[0], g.end[1]);
  const r = { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
  batch(() => {
    const id = call('line.add', { space: g.s.id, points: polygonPts(r).map((q) => q.map(round)), closed: true, style: { path: 'straight', ...(settings.stroke ? { stroke: settings.stroke } : {}), ...(settings.fill ? { fill: settings.fill } : {}) } });
    if (id) call('select.set', { ids: [id] });
  });
}

// ---- Poly Build: meshes in a render target (mesh.js) ------------------------------
// Click to put corners (the magnet places them: on strokes, on other corners); click the first
// corner again to close a face; click a corner a face already has to use it (welded); Enter ends
// a run of corners, Escape drops it, Backspace takes the last back. Drag a corner to move it;
// drag an edge to grow a quad from it.
let build = null; // { s, id (the mesh), chain: [vertex indices] }
function meshHit(s, p) {
  let best = null, bd = 10;
  for (const me of state.objects.values()) {
    if (me.kind !== 'mesh' || me.space !== s.id || me.hidden) continue;
    const vs = ptsOf(me);
    vs.forEach((v, i) => { const q = view.sceneToScreen(s.id, v), d = q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : Infinity; if (d < bd) { bd = d; best = { mesh: me, i }; } });
  }
  if (best) return best;
  bd = 7;
  for (const me of state.objects.values()) {
    if (me.kind !== 'mesh' || me.space !== s.id || me.hidden) continue;
    const vs = ptsOf(me);
    for (const ed of edgesOf(me.faces)) {
      const a = view.sceneToScreen(s.id, vs[ed.a]), b = view.sceneToScreen(s.id, vs[ed.b]);
      if (!a || !b) continue;
      const d = segDist(p[0], p[1], a, b);
      if (d < bd) { bd = d; best = { mesh: me, a: ed.a, b: ed.b, rim: ed.faces === 1 }; }
    }
  }
  return best;
}
function buildPreview(p) {
  if (!build) return view.setPreview(null);
  const me = get(build.id), vs = me ? ptsOf(me) : [], pts = build.chain.map((i) => vs[i]).filter(Boolean);
  const end = p && magnetIn(build.s, p)?.point;
  view.setPreview(end ? [...pts, end] : pts, build.s.id, 'hot');
}
function polyPress(s, p, e) {
  if (s.kind !== 'scene') return;
  const hit = meshHit(s, p);
  if (hit && hit.i == null && !build) { gesture = { kind: 'pedge', s, hit, start: p, moved: false }; return; }
  if (hit && hit.i != null) { gesture = { kind: 'pvert', s, hit, start: p, moved: false }; return; }
  // empty space: a new corner, of the mesh being built (or a new mesh)
  const q = magnetIn(s, p, { off: e.ctrlKey || e.metaKey })?.point;
  if (!q) return;
  batch(() => {
    if (build && get(build.id)) { const me = get(build.id); call('mesh.set', { id: me.id, verts: [...me.verts, q.map(round)] }); build.chain.push(me.verts.length - 1); }
    else { const id = call('mesh.add', { space: s.id, verts: [q.map(round)], ...(settings.fill ? { style: { fill: settings.fill } } : {}) }); build = { s, id, chain: [0] }; call('select.set', { ids: [id] }); }
  });
  buildPreview(p);
}
function polyDrag(g, p, e) {
  const me = g.hit.mesh, vs = me.verts;
  if (g.kind === 'pvert') {
    const v = vs[g.hit.i], through = { ...g.s, origin: v }, q = magnetIn(through, p, { exclude: me.id, off: e.ctrlKey || e.metaKey })?.point;
    if (q) { const next = vs.map((w, i) => (i === g.hit.i ? q : w)); setLive(new Map([[me.id, { points: next }]])); g.next = next; dragSig = 'pvert' + p.join(); }
  } else {
    // an edge pulled: its copy follows the pointer on the plane through the edge's middle
    const a = vs[g.hit.a], b = vs[g.hit.b], mid = a.map((x, k) => (x + b[k]) / 2), through = { ...g.s, origin: mid };
    const q0 = toSpace(through, g.start[0], g.start[1]), q1 = toSpace(through, p[0], p[1]);
    if (!q0 || !q1) return;
    g.d = q1.map((x, k) => x - q0[k]);
    const r = extrude(vs, me.faces, g.hit.a, g.hit.b, g.d);
    setLive(new Map([[me.id, { points: r.verts }]])); g.next = r; dragSig = 'pedge' + p.join();
  }
}
function polyRelease(g) {
  setLive(null); dragSig = '';
  const me = g.hit.mesh;
  if (g.kind === 'pedge') { if (g.moved && g.next) call('mesh.set', { id: me.id, verts: g.next.verts.map((v) => v.map(round)), faces: g.next.faces }); return; }
  if (g.moved && g.next) { call('mesh.set', { id: me.id, verts: g.next.map((v) => v.map(round)) }); return; }
  // a click on a corner: close the face (the first of the run), go on from it, or start a run from it
  const i = g.hit.i;
  if (build && build.id === me.id) {
    if (i === build.chain[0] && build.chain.length >= 3) { call('mesh.set', { id: me.id, faces: [...me.faces, build.chain.slice()] }); build = null; view.setPreview(null); return; }
    if (!build.chain.includes(i)) build.chain.push(i);
  } else build = { s: g.s, id: me.id, chain: [i] };
  call('select.set', { ids: [me.id] });
  buildPreview(g.start);
}
function buildKey(k) {
  if (k === 'Backspace' && build?.chain.length) { build.chain.pop(); if (!build.chain.length) build = null; buildPreview(null); return; }
  build = null; view.setPreview(null);
}

// ---- the hold menu: hold still while drawing to turn the stroke into something --

// What the ring offers, clockwise from the top; each is an action, so it also has a key, a menu entry and a palette entry.
const PIE = ['role.path', 'attach.traveler', 'line.travelNearest', 'role.event', 'line.toShape', 'line.toTarget', 'join.crossings', 'line.straighten', 'simplify.strongly'];
// Picks that leave the stroke a line on the drawing: its ends still join what they touch.
const KEEPS_LINE = new Set(['role.path', 'attach.traveler', 'join.crossings', 'line.straighten', 'simplify.strongly']);
const HOLD_MS = 450;
let holdTimer = 0;
function armHold(g) {
  clearTimeout(holdTimer);
  if (g.wire) return;
  holdTimer = setTimeout(() => {
    if (gesture !== g || g.pie) return;
    // the stroke so far, as if it were a line already, for the actions to judge
    const line = { id: '', kind: 'line', role: 'ink', points: g.pts, off: [0, 0], space: g.s.id }, c = { ...context(), sel: [line], one: line, lines: [line], shapes: [], groups: [], hit: line };
    let len = 0;
    for (let i = 1; i < g.pts.length; i++) len += Math.hypot(g.pts[i][0] - g.pts[i - 1][0], g.pts[i][1] - g.pts[i - 1][1]);
    if (len / unitsPerPx(g.s) < 12) return;
    const items = PIE.map((id, i) => [ACTIONS.find((a) => a.id === id), i]).filter(([a]) => a && allowed(a, c));
    if (!items.length) return;
    g.pie = showPie(stage, items.map(([a]) => ({ title: a.title, icon: a.icon })), g.last[0], g.last[1]);
    g.pie.items = items.map(([, i]) => i);
    g.choice = -1;
  }, HOLD_MS);
}
// A line's own box (no padding), in its space.
function boxOf(o) {
  const pts = ptsOf(o);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
// Replace flat lines by shapes made from their boxes.
function linesTo(c, make) {
  const out = batch(() => {
    const made = [];
    for (const l of c.lines.filter(flatLine)) {
      const v = vis.get(l.id), min = 24 * view.unitsPerPx() / (v?.xf?.k ?? 1), r = boxOf(l), extra = make(l, r);
      if (!extra) continue;
      const rect = { cx: round(r.cx), cy: round(r.cy), w: round(Math.max(min, r.w)), h: round(Math.max(min, r.h)), ...extra.rect };
      made.push(call('shape.add', { space: l.space, rect, shape: extra.shape ?? 'rect', role: extra.role, ...(extra.role === 'code' ? { preset: settings.codePreset } : {}), ...(extra.role === 'visual' && l.style?.stroke ? { style: { stroke: l.style.stroke } } : {}) }));
      call('object.remove', { ids: [l.id] });
    }
    if (made.length) call('select.set', { ids: made });
    return made;
  });
  return out;
}

// ---- gestures: what a press means depends on what is under it --------------

let tool = 'select';
let gesture = null; // what the pointer is doing between down and up
let spaceKey = false, spaceUsed = false, spaceAt0 = 0, pointer = null;
const ring = $('ring'); // the sculpt brush's reach
const touches = new Map();
const MAKE = { polygon: { role: 'visual', shape: 'polygon' }, grid: { role: 'grid', shape: 'rect' }, rect: { role: 'visual', shape: 'rect' }, ellipse: { role: 'visual', shape: 'ellipse' }, code: { role: 'code', shape: 'rect' }, target: { role: 'target', shape: 'rect' }, score: { role: 'score', shape: 'rect' }, note: { role: 'note', shape: 'rect' }, event: { role: 'event', shape: 'ellipse' } };
// The look new lines and shapes take, from the toolbar swatches.
const newStyle = (fillable) => { const st = {}; if (settings.stroke) st.stroke = settings.stroke; if (fillable && settings.fill) st.fill = settings.fill; if (settings.width !== 2.2) st.width = settings.width; if (!fillable && !settings.smooth) st.path = 'straight'; return Object.keys(st).length ? { style: st } : {}; };
const snap = (v) => (settings.snap ? Math.round(v / gridCell()) * gridCell() : v);
// The grid in force at a point of a space (a grid frame there, else the global grid), and a point snapped to it
// when that grid snaps (a frame's snap, or the global snap setting).
const gridHere = (space, p) => gridAt(state.objects, space, p, state.grid, paramsOf);
const snapHere = (space, p) => { const g = gridHere(space, p); return g.frame ? (g.snap ? snapPoint(p, g) : p) : settings.snap ? snapPoint(p, g) : p; };

const stacks = new Map(); // stack -> { b, members, current }: tools of one kind share a button
function setTool(name) {
  if (name !== 'poly' && build) { build = null; view.setPreview(null); }
  if (name !== 'polyline' && poly) finishPoly(true);
  tool = name;
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === name));
  for (const [key, st] of stacks) {
    const m = st.members.find((a) => a.tool === name);
    st.b.setAttribute('aria-pressed', String(!!m));
    if (m && m !== st.current) { st.current = m; paintStack(st); setSetting('stacks', { ...settings.stacks, [key]: name }); }
  }
  pad.dataset.tool = name;
  if (name !== 'points') { handles.clear(); handles.hover(null); }
  if (name !== 'sculpt') ring.hidden = true;
}
function showMarquee(a, b) {
  marquee.hidden = false;
  marquee.style.cssText = `left:${Math.min(a[0], b[0])}px;top:${Math.min(a[1], b[1])}px;width:${Math.abs(a[0] - b[0])}px;height:${Math.abs(a[1] - b[1])}px`;
}
// In a target the drawing plane passes through the origin, the 3D cursor, or
// (anchor 'stroke') the point of an existing stroke nearest the pointer, so a
// new stroke takes its depth from one already there and forms grow in 3D. The
// choice is made once, where the stroke begins, and holds to its end.
function placed(s, p) {
  if (s.kind !== 'scene' || (get(s.id).anchor ?? 'origin') !== 'stroke') return s;
  let best = null, bestD = 48;
  for (const l of ink3d) {
    if (l.scene !== s.id) continue;
    for (const pt of l.pts) { const q = view.sceneToScreen(l.scene, pt), d = q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : Infinity; if (d < bestD) { bestD = d; best = pt; } }
  }
  return best ? { ...s, origin: [best[0], best[1], best[2] ?? 0] } : s;
}

function startDraw(s, p, wire = false, e = null) {
  s = placed(s, p);
  const q = s.kind === 'scene' && !wire ? magnetIn(s, p, { off: e?.ctrlKey || e?.metaKey })?.point : toSpace(s, p[0], p[1]);
  if (q) gesture = { kind: 'draw', s, pts: [q], first: p, last: p, wire, pen: [[0, 0.5]], t0: performance.now(), lastT: performance.now() };
}

pad.addEventListener('pointerdown', (e) => {
  document.activeElement?.blur?.();
  closeMenu();
  if (laidOut !== state.version) frame(); // a press right after a change, before the next frame: lay out now
  const p = local(e);
  try { pad.setPointerCapture(e.pointerId); } catch {} // a scripted pointer has nothing to capture
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, p);
    if (touches.size === 2) {
      cancelGesture();
      // Inside a target, two fingers move its camera: pinch zooms, moving pans.
      const [a, b] = [...touches.values()], s = spaceAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      gesture = { kind: 'pinch', scene: s.kind === 'scene' ? { id: s.id, h: s.px.h } : null };
      return;
    }
  }
  // In a render target the mouse works as in Blender: middle-drag orbits, with
  // Shift it pans, with Ctrl it zooms. Alt+left-drag stands in for the middle button.
  const in3d = spaceAt(p[0], p[1]);
  if (in3d.kind === 'scene' && (e.button === 1 || (e.button === 0 && e.altKey)) && !spaceKey) {
    const o = get(in3d.id), cam = camOf(o);
    gesture = { kind: 'nav3d', mode: e.shiftKey ? 'pan' : e.ctrlKey || e.metaKey ? 'zoom' : 'orbit', id: o.id, start: p, cam: { ...cam, center: cam.center.slice() }, h: in3d.px.h };
    e.preventDefault();
    return;
  }
  // On the canvas the same hands: Alt+Shift-drag pans, as the middle button and Space do;
  // Ctrl+middle or Alt+Ctrl-drag zooms about where it began.
  const zoomDrag = (e.button === 1 || (e.button === 0 && e.altKey)) && (e.ctrlKey || e.metaKey);
  if (zoomDrag) { gesture = { kind: 'zoom', start: p, last: p }; e.preventDefault(); return; }
  if (e.button === 1 || (e.button === 0 && (spaceKey || tool === 'pan' || (e.altKey && e.shiftKey)))) { gesture = { kind: 'pan', last: p }; spaceUsed = true; return; }
  if (e.button !== 0) return;

  if (tool === 'points') {
    handles.hover(null);
    const h = handles.at(p[0], p[1]);
    if (h) {
      // Press a handle to pick it (Shift adds or takes away), then drag what is picked.
      const k = handles.key(h.id, h.i);
      if (e.shiftKey) { if (handles.picked.has(k)) handles.picked.delete(k); else handles.picked.add(k); }
      else if (!handles.picked.has(k)) { handles.picked.clear(); handles.picked.add(k); }
      const lines = new Map();
      for (const [id, idx] of handles.byLine()) {
        const src = pointSrc.find((l) => l.o.id === id);
        if (src) lines.set(id, { pts: src.pts, pen: src.pen, idx, scene: src.scene, xf: src.xf });
      }
      gesture = { kind: 'points', lines, start: p, moved: false, next: null };
      return;
    }
    // A line picks that line, so only its points show; anywhere else boxes points.
    const id = pick(p[0], p[1]);
    if (id && isLine(get(id))) { if (!e.shiftKey) handles.picked.clear(); call('select.set', { ids: e.shiftKey ? [...new Set([...state.selection, id])] : [id] }); }
    else gesture = { kind: 'pmarquee', start: p, end: p, add: e.shiftKey };
    return;
  }

  const here = spaceAt(p[0], p[1]), port = portAt(p[0], p[1]);
  // A drag that starts on a port draws a connector, whatever the tool.
  if (port) { const s = spaces.find((x) => x.id === port.v.o.space) ?? spaces[0]; startDraw(s, p, true); return; }
  // The corner of the selected shape resizes it.
  const one = state.selection.size === 1 ? vis.get([...state.selection][0]) : null;
  if (one?.px && one.o.rect && one.o.kind !== 'joint' && one.o.kind !== 'point' && Math.hypot(p[0] - (one.px.l + one.px.w), p[1] - (one.px.t + one.px.h)) < 10) {
    gesture = { kind: 'resize', id: one.o.id, k: one.xf.k, rect: { ...one.o.rect }, start: p, next: null }; return;
  }
  if (tool === 'sculpt') {
    // Sculpt the selected lines, or with none selected, every line in this space.
    const s = spaceAt(p[0], p[1], true), marks = new Map();
    for (const l of state.objects.values()) {
      if (!isLine(l) || l.bind || l.locked || l.hidden || l.space !== s.id || (state.selection.size && !state.selection.has(l.id))) continue;
      const pts = element(ptsOf(l), l.pen).points;
      marks.set(l.id, { o: l, pts, orig: pts, state: {}, changed: false });
    }
    gesture = { kind: 'sculpt', s, marks, last: p, start: p, first: true, n: 0 };
    return;
  }
  if (tool === 'point') { placePoint(here, p); return; }
  if (tool === 'polyline') { addPolyPoint(here, p); return; }
  if (tool === 'poly') { polyPress(spaceAt(p[0], p[1]), p, e); return; }
  if (tool === 'draw') startDraw(here, p, false, e);
  else if (tool === 'line') { const s = placed(here, p), q = s.kind === 'scene' ? magnetIn(s, p, { off: e.ctrlKey || e.metaKey })?.point : toSpace(s, p[0], p[1]); if (q) gesture = { kind: 'line', s, a: q, b: q, start: p }; }
  else if (MAKE[tool]) {
    const flat = tool !== 'rect' && tool !== 'ellipse' && tool !== 'polygon'; // only plain shapes can be drawn inside a target
    gesture = { kind: 'rect', make: MAKE[tool], s: placed(spaceAt(p[0], p[1], flat), p), start: p, end: p };
  } else {
    const id = pick(p[0], p[1]);
    if (id) {
      if (e.shiftKey) {
        const ids = new Set(state.selection); ids.has(id) ? ids.delete(id) : ids.add(id);
        call('select.set', { ids: [...ids] });
      } else if (!state.selection.has(id)) call('select.set', { ids: [id] });
      const v = vis.get(id);
      if (v.scene) return; // lines inside a target are selected, not dragged
      // a node, or a traveler, slides along its line (quantized to the beat while Q is on; Ctrl the other way)
      const sl = slideLineOf(get(id));
      if (sl && !e.shiftKey) { gesture = { kind: 'slide', id, line: sl, start: p, moved: false }; return; }
      // Only what shares the picked object's space moves with it.
      const ids = [...state.selection].filter((i) => get(i)?.space === v.o.space);
      gesture = { kind: 'move', k: v.xf.k, ids, start: p, dx: 0, dy: 0, moved: false };
    } else gesture = { kind: 'marquee', s: here, start: p, end: p };
  }
});

pad.addEventListener('pointermove', (e) => {
  const p = local(e);
  pointer = p;
  if (touches.has(e.pointerId)) {
    const before = touches.get(e.pointerId);
    if (gesture?.kind === 'pinch' && touches.size === 2) {
      const other = [...touches.entries()].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(before[0] - other[0], before[1] - other[1]), d1 = Math.hypot(p[0] - other[0], p[1] - other[1]), u = view.unitsPerPx();
      if (gesture.scene) {
        const { id, h } = gesture.scene;
        let c = navigate(camOf(get(id)), 'pan', (p[0] - before[0]) / 2, (p[1] - before[1]) / 2, h);
        if (d0 > 1 && d1 > 1) c = { ...c, dist: Math.max(0.5, Math.min(400, c.dist * d0 / d1)) };
        orbit = { ...c, id };
      } else {
        view.cam.cx -= (p[0] - before[0]) / 2 * u; view.cam.cy += (p[1] - before[1]) / 2 * u;
        if (d0 > 1) view.zoomAt((p[0] + other[0]) / 2, (p[1] + other[1]) / 2, d1 / d0);
      }
    }
    touches.set(e.pointerId, p);
  }
  ring.hidden = tool !== 'sculpt';
  if (tool === 'sculpt') ring.style.cssText = `left:${p[0]}px;top:${p[1]}px;width:${settings.sculptRadius * 2}px;height:${settings.sculptRadius * 2}px`;
  if (!gesture && poly) previewPoly(p);
  if (!gesture && build && tool === 'poly') buildPreview(p);
  if (!gesture) { pad.dataset.over = portAt(p[0], p[1]) ? 'port' : ''; if (tool === 'points') handles.hover(handles.at(p[0], p[1])); return; }
  const g = gesture;
  if (g.kind === 'sculpt') {
    const a = toSpace(g.s, g.last[0], g.last[1]), b = toSpace(g.s, p[0], p[1]), c = toSpace(g.s, g.start[0], g.start[1]);
    const boost = e.metaKey || e.ctrlKey, id = effectiveSculpt(settings.sculpt, boost);
    const stroke = { x: b[0] * UNIT, y: -b[1] * UNIT, dx: (b[0] - a[0]) * UNIT, dy: -(b[1] - a[1]) * UNIT, radius: settings.sculptRadius * unitsPerPx(g.s) * UNIT, strength: settings.sculptStrength,
      pressure: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1, invert: e.altKey, boost, first: g.first, start: [c[0] * UNIT, -c[1] * UNIT] };
    const shown = new Map();
    for (const [mid, mk] of g.marks) {
      const out = sculptMark(id, { points: mk.pts, closed: !!mk.o.closed, path: mk.o.style?.path }, stroke, settings.sculptParams[id], Math.random, mk);
      if (out) { mk.pts = out; mk.changed = true; }
      if (mk.changed) shown.set(mid, { points: mk.pts.map((q) => [q[0] / UNIT, -q[1] / UNIT]), pen: mk.pts.map((q) => [q[2] ?? 0, q[3] ?? 0.5]) });
    }
    setLive(shown); dragSig = 'sculpt' + (++g.n);
    g.last = p; g.first = false;
    return;
  }
  if (g.kind === 'pan') {
    const u = view.unitsPerPx();
    view.cam.cx -= (p[0] - g.last[0]) * u; view.cam.cy += (p[1] - g.last[1]) * u; g.last = p;
  } else if (g.kind === 'draw' && g.pie) {
    g.choice = g.pie.at(p[0], p[1]);
  } else if (g.kind === 'draw') {
    if (Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) < 1.5) return;
    armHold(g);
    const q = toSpace(g.s, p[0], p[1]);
    if (!q) return;
    // Pressure from a pen; with a mouse, a slower hand presses harder.
    const now = performance.now(), speed = Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) / Math.max(1, now - g.lastT), was = g.pen[g.pen.length - 1][1];
    const press = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : was * 0.7 + Math.max(0.15, Math.min(0.9, 0.9 - speed * 0.35)) * 0.3;
    g.pen.push([Math.round(now - g.t0), +press.toFixed(3)]); g.lastT = now;
    g.pts.push(q); g.last = p;
    if (!g.wire && g.s.kind !== 'scene') showTouch(e.ctrlKey || e.metaKey ? null : touching(g.s, p));
    if (g.s.kind === 'scene' && !g.wire) showMagnet(g.s, e.ctrlKey || e.metaKey ? null : magnetIn(g.s, p));
    if (g.s.kind === 'scene') view.setPreview(g.pts, g.s.id);
    else view.setPreview((settings.smooth ? smooth(g.pts, stepsOnScreen(1 / unitsPerPx(g.s))) : g.pts).map((pt) => at(g.s.xf, pt)), null, g.wire ? 'hot' : 'accent');
  } else if (g.kind === 'line') {
    // Shift holds a straight line to steps of 15 degrees.
    let q = p;
    if (e.shiftKey) { const dx = p[0] - g.start[0], dy = p[1] - g.start[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), d = Math.hypot(dx, dy); q = [g.start[0] + Math.cos(a) * d, g.start[1] + Math.sin(a) * d]; }
    const mg = g.s.kind === 'scene' ? magnetIn(g.s, q, { from: g.a, off: e.ctrlKey || e.metaKey }) : null, b = mg ? mg.point : toSpace(g.s, q[0], q[1]);
    if (mg) showMagnet(g.s, mg);
    if (!b) return;
    g.b = b; g.end = q;
    showTouch(e.ctrlKey || e.metaKey ? null : touching(g.s, q));
    if (g.s.kind === 'scene') view.setPreview([g.a, g.b], g.s.id); else view.setPreview([g.a, g.b].map((pt) => at(g.s.xf, pt)));
  } else if (g.kind === 'pvert' || g.kind === 'pedge') {
    if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < 4) return;
    g.moved = true;
    polyDrag(g, p, e);
  } else if (g.kind === 'slide') {
    if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < 3) return;
    g.moved = true;
    const s = spaces.find((x) => x.id === g.line.space) ?? spaces[0], q = toSpace(s, p[0], p[1]), path = shownPath(g.line);
    let u = nearestU(path, q[0], q[1]);
    if (settings.quantOn !== (e.ctrlKey || e.metaKey)) u = quantU(g.line, u);
    sliding = { id: g.id, u, line: g.line.id };
    dragSig = 'slide' + u;
  } else if (g.kind === 'move') {
    const u = view.unitsPerPx() / g.k;
    g.dx = snap((p[0] - g.start[0]) * u); g.dy = snap(-(p[1] - g.start[1]) * u);
    if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < 3) return;
    g.moved = true;
    setDrag({ ids: new Set(g.ids), dx: g.dx, dy: g.dy });
    follow(new Map(), g.ids);
    dragSig = g.dx + ',' + g.dy;
  } else if (g.kind === 'resize') {
    // The top left corner stays; the dragged corner follows the pointer.
    const u = view.unitsPerPx() / g.k, r = g.rect;
    const w = Math.max(0.2, r.w + (p[0] - g.start[0]) * u), h = Math.max(0.2, r.h + (p[1] - g.start[1]) * u);
    g.next = { cx: round(r.cx - r.w / 2 + w / 2), cy: round(r.cy + r.h / 2 - h / 2), w: round(w), h: round(h) };
    setDrag({ ids: new Set([g.id]), rect: g.next });
    dragSig = w + ',' + h;
  } else if (g.kind === 'nav3d') {
    orbit = { id: g.id, ...navigate(g.cam, g.mode, p[0] - g.start[0], p[1] - g.start[1], g.h) };
  } else if (g.kind === 'zoom') {
    view.zoomAt(g.start[0], g.start[1], Math.exp(-(p[1] - g.last[1]) * 0.01)); g.last = p;
  } else if (g.kind === 'points') {
    if (!g.moved && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < 3) return;
    g.moved = true;
    g.next = movedPoints(g, p[0] - g.start[0], p[1] - g.start[1]);
    follow(g.next, [...g.next.keys()]); dragSig = 'points' + p.join();
  } else if (g.kind === 'rect' || g.kind === 'marquee' || g.kind === 'pmarquee') { g.end = p; showMarquee(g.start, g.end); }
});

// A target's camera after an orbit, pan or zoom of (dx, dy) pixels. h is the target's height on screen.
function navigate(cam, mode, dx, dy, h) {
  if (mode === 'orbit') return { ...cam, az: cam.az - dx * 0.01, el: Math.max(-1.55, Math.min(1.55, cam.el + dy * 0.01)) };
  if (mode === 'zoom') return { ...cam, dist: Math.max(0.5, Math.min(400, cam.dist * Math.exp(dy * 0.01))) };
  // pan: slide the point it looks at across the view plane, so what is under the pointer follows it
  const ca = Math.cos(cam.az), sa = Math.sin(cam.az), ce = Math.cos(cam.el), se = Math.sin(cam.el);
  const d = [sa * ce, se, ca * ce], r = [ca, 0, -sa], u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
  const k = 2 * cam.dist * Math.tan(FOV / 2) / h;
  return { ...cam, center: cam.center.map((c, i) => c - r[i] * dx * k + u[i] * dy * k) };
}
// Store the camera a navigation arrived at, as one command.
function commitCam() {
  const o = orbit; orbit = null;
  if (o) call('target.set', { id: o.id, az: round(o.az), el: round(o.el), dist: round(o.dist), center: o.center.map(round) });
}

function cancelGesture() {
  gesture?.pie?.close(); clearTimeout(holdTimer);
  gesture = null; marquee.hidden = true; view.setPreview(null); setDrag(null); setLive(null); dragSig = ''; orbit = null; showTouch(null);
}

// A rectangle or ellipse drawn inside a target: a closed line on its plane.
function shapeIn3d(g) {
  const basis = view.planeBasis(g.s.id, g.s.plane), a = toSpace(g.s, g.start[0], g.start[1]), b = toSpace(g.s, g.end[0], g.end[1]);
  if (!basis || !a || !b) return;
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const r = { cx: (dot(a, basis.u) + dot(b, basis.u)) / 2, cy: (dot(a, basis.v) + dot(b, basis.v)) / 2, w: Math.abs(dot(a, basis.u) - dot(b, basis.u)), h: Math.abs(dot(a, basis.v) - dot(b, basis.v)) };
  const points = (g.make.shape === 'polygon' ? polygonPts(r) : outline(r, g.make.shape).slice(0, -1)).map(([x, y]) => [0, 1, 2].map((i) => round(basis.u[i] * x + basis.v[i] * y)));
  const id = call('line.add', { space: g.s.id, points, closed: true, ...newStyle(true) });
  call('select.set', { ids: [id] });
}

function endGesture(e) {
  touches.delete(e.pointerId);
  clearTimeout(holdTimer);
  const g = gesture;
  gesture = null;
  marquee.hidden = true;
  showTouch(null);
  if (!g) return;
  if (g.kind === 'pinch' && g.scene) { commitCam(); return; }
  if (g.kind === 'points') {
    setLive(null); dragSig = '';
    if (g.moved && g.next) batch(() => { for (const [id, m] of g.next) call('line.set', { id, points: m.points, ...(m.pen && m.pen.length === m.points.length ? { pen: m.pen } : {}) }); if (!(e.ctrlKey || e.metaKey)) joinTouching([...g.next.keys()]); });
    return;
  }
  if (g.kind === 'pmarquee') {
    const [x0, x1] = [Math.min(g.start[0], g.end[0]), Math.max(g.start[0], g.end[0])], [y0, y1] = [Math.min(g.start[1], g.end[1]), Math.max(g.start[1], g.end[1])];
    if (!g.add) handles.picked.clear();
    if (x1 - x0 > 3 || y1 - y0 > 3) for (const h of handles.within(x0, y0, x1, y1)) handles.picked.add(handles.key(h.id, h.i));
    else if (!g.add && state.selection.size) call('select.set', { ids: [] }); // a click on nothing: all lines' points again
    dragSig = 'picked' + handles.picked.size + Math.random();
    return;
  }
  if (g.kind === 'sculpt') {
    setLive(null); dragSig = '';
    const changed = [...g.marks.values()].filter((mk) => mk.changed);
    if (changed.length) batch(() => { for (const mk of changed) call('line.set', { id: mk.o.id, points: mk.pts.map((q) => [round(q[0] / UNIT), round(-q[1] / UNIT)]), pen: mk.pts.map((q) => [Math.round(q[2] ?? 0), +(q[3] ?? 0.5).toFixed(3)]) }); });
    return;
  }
  if (g.kind === 'draw') {
    view.setPreview(null);
    // A line begun on a port reaches further for the port at its other end.
    const tol = g.s.kind === 'scene' ? 0 : (g.wire ? 26 : 14) * unitsPerPx(g.s);
    // Keep the points that carry the shape; the curve through them is drawn smooth.
    const keep = g.s.kind === 'scene' ? g.pts.map((_, i) => i) : simplifyIndex(g.pts, settings.simplify * unitsPerPx(g.s));
    const brush = !g.wire && settings.brush && g.s.kind !== 'scene' ? { brush: { id: settings.brush, params: settings.brushParams[settings.brush] ?? {} } } : {};
    // the stroke's ends land on the grid's points when its grid snaps (its middle stays as drawn)
    const pts = keep.map((i) => g.pts[i]);
    // in a target, its end lands where the magnet says (its start did when it began)
    if (g.s.kind === 'scene' && !g.wire && pts.length > 1 && !(e.ctrlKey || e.metaKey)) { const m = magnetIn(g.s, g.last); if (m && m.kind !== 'free') pts[pts.length - 1] = m.point; }
    if (g.s.kind !== 'scene' && !g.wire && pts.length > 1) { pts[0] = snapHere(g.s.id, pts[0]); pts[pts.length - 1] = snapHere(g.s.id, pts[pts.length - 1]); }
    const add = () => call('line.add', { space: g.s.id, points: pts.map((q) => q.map(round)), tol: round(tol), ...(g.wire ? {} : { pen: keep.map((i) => g.pen[i]), ...newStyle(false), ...brush }) });
    // Held, and let go on a glyph of the ring: the stroke becomes that, in one step.
    const pick = g.pie ? PIE.map((id) => ACTIONS.find((a) => a.id === id))[g.pie.items[g.choice ?? -1] ?? -1] : null;
    g.pie?.close();
    // Its ends join what they touch (Ctrl or Cmd as it is let go: they do not).
    const ends = (id) => { if (g.wire || e.ctrlKey || e.metaKey || !isCurve(get(id)) || get(id).closed) return; joinEnd(g.s, id, 0, g.first); joinEnd(g.s, id, 1, g.last); };
    if (pick) batch(() => { const id = add(); call('select.set', { ids: [id] }); pick.run(context()); if (KEEPS_LINE.has(pick.id)) ends(id); });
    else if (g.pts.length > 1 || !g.wire) batch(() => { const id = add(); if (id) ends(id); });
  } else if (g.kind === 'line') {
    view.setPreview(null);
    const flat = g.s.kind !== 'scene', pts = [g.a, g.b].map((q) => (flat ? snapHere(g.s.id, q) : q).map(round));
    if (Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], (pts[0][2] ?? 0) - (pts[1][2] ?? 0)) > 1e-3) batch(() => {
      const id = call('line.add', { space: g.s.id, points: pts, tol: flat ? round(14 * unitsPerPx(g.s)) : 0, ...newStyle(false) });
      if (id && isCurve(get(id)) && !(e.ctrlKey || e.metaKey)) { joinEnd(g.s, id, 0, g.start); joinEnd(g.s, id, 1, g.end ?? g.start); }
    });
  } else if (g.kind === 'pvert' || g.kind === 'pedge') {
    polyRelease(g);
  } else if (g.kind === 'slide') {
    const s = sliding; sliding = null; dragSig = '';
    if (g.moved && s) { const o = get(g.id); if (o?.kind === 'joint') call('joint.slide', { id: g.id, u: round(s.u) }); else call('object.set', { id: g.id, name: 'start', value: round(s.u) }); }
  } else if (g.kind === 'move') {
    setDrag(null); setLive(null); dragSig = '';
    if (g.moved) batch(() => { call('object.move', { ids: g.ids, dx: round(g.dx), dy: round(g.dy) }); if (!(e.ctrlKey || e.metaKey)) { if (laidOut !== state.version) frame(); joinTouching(g.ids); } });
  } else if (g.kind === 'resize') {
    setDrag(null); dragSig = '';
    if (g.next) call('object.resize', { id: g.id, rect: g.next });
  } else if (g.kind === 'nav3d') {
    commitCam();
  } else if (g.kind === 'rect') {
    const tiny = Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) < 8;
    if (g.s.kind === 'scene') { if (!tiny) batch(() => shapeIn3d(g)); }
    else if (g.make.shape === 'polygon') { if (!tiny) polygonAt(g); }
    else { addShape(g.s, g.make, g.start, tiny ? null : g.end); if (g.make.role === 'note') panels.show('properties'); }
    setTool('select');
  } else if (g.kind === 'marquee') {
    const [x0, x1] = [Math.min(g.start[0], g.end[0]), Math.max(g.start[0], g.end[0])];
    const [y0, y1] = [Math.min(g.start[1], g.end[1]), Math.max(g.start[1], g.end[1])];
    const within = (q) => q && q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
    const ids = [];
    if (x1 - x0 > 3 || y1 - y0 > 3) {
      if (g.s.kind === 'scene') { for (const l of ink3d) if (l.scene === g.s.id && l.pts.some((pt) => within(view.sceneToScreen(l.scene, pt)))) ids.push(l.id); }
      else {
        const ink = new Map(lines.filter((l) => l.id).map((l) => [l.id, l.pts]));
        for (const [id, v] of vis) {
          if (v.o.space !== g.s.id || v.o.locked) continue;
          const hitBox = v.px && v.px.l < x1 && v.px.l + v.px.w > x0 && v.px.t < y1 && v.px.t + v.px.h > y0;
          if (ink.get(id)?.some((pt) => within(view.toScreen(pt))) || hitBox) ids.push(id);
        }
      }
    }
    if (ids.length || state.selection.size) call('select.set', { ids });
  }
}
pad.addEventListener('pointerup', endGesture);
pad.addEventListener('pointercancel', endGesture);

// A shape in a flat space, from a drag or (end = null) at a default size.
function addShape(s, make, start, end, extra = {}) {
  const a = toSpace(s, start[0], start[1]), u = unitsPerPx(s);
  const size = make.role === 'target' ? [360, 260] : make.role === 'score' || make.role === 'grid' ? [460, 240] : make.role === 'code' ? [170, 110] : make.role === 'note' ? [180, 70] : make.role === 'event' ? [90, 90] : [120, 120];
  let rect = { cx: a[0], cy: a[1], w: size[0] * u, h: size[1] * u };
  if (end) { const b = toSpace(s, end[0], end[1]); rect = { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }; }
  if (settings.snap && end) { const x0 = snap(rect.cx - rect.w / 2), x1 = snap(rect.cx + rect.w / 2), y0 = snap(rect.cy - rect.h / 2), y1 = snap(rect.cy + rect.h / 2); rect = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(gridCell(), x1 - x0), h: Math.max(gridCell(), y1 - y0) }; }
  for (const k in rect) rect[k] = round(rect[k]);
  return batch(() => {
    const id = call('shape.add', { space: s.id, rect, shape: make.shape, role: make.role, ...(make.role === 'code' ? { preset: settings.codePreset } : make.role === 'score' ? { preset: settings.scoreBrush } : {}), ...(make.role === 'visual' ? { ...newStyle(true), ...(settings.planeBrush ? { brush: { id: settings.planeBrush, params: settings.brushParams[settings.planeBrush] ?? {} } } : {}) } : {}), ...extra });
    if (make.role === 'target' && settings.targetPlane !== 'view') call('target.set', { id, plane: settings.targetPlane });
    if (make.role === 'target') takeInto(id); // drawn over marks, it takes them into its 3D scene
    call('select.set', { ids: [id] });
    return id;
  });
}

// The wheel. On the canvas: a pinch (or Ctrl/Cmd+wheel) zooms about the pointer, a
// trackpad's two fingers pan, a mouse wheel zooms. Over a render target that is
// selected or open, the same gestures move its camera, as in Blender: two fingers
// orbit, with Shift they pan, a pinch or the wheel zooms.
const isMouseWheel = (e) => settings.wheel === 'zoom' || (settings.wheel === 'auto' && (e.deltaMode !== 0 || (e.deltaX === 0 && e.wheelDeltaY && Math.abs(e.wheelDeltaY) % 120 === 0)));
let wheelTimer = 0;
// A pinch at p by factor f (> 1 closer): inside a render target, its camera; else the canvas.
function pinchAt(p, f) {
  const s = spaceAt(p[0], p[1]);
  if (s.kind === 'scene' && !gesture) {
    const o = get(s.id), cam = camOf(o);
    orbit = { ...cam, id: o.id, dist: Math.max(0.5, Math.min(400, cam.dist / f)) };
    clearTimeout(wheelTimer); wheelTimer = setTimeout(commitCam, 250);
  } else view.zoomAt(p[0], p[1], f);
}
// Safari reports a trackpad pinch as gesture events, not as Ctrl+wheel.
let gestureScale = 1;
stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
stage.addEventListener('gesturechange', (e) => { e.preventDefault(); if (laidOut !== state.version) frame(); pinchAt(local(e), e.scale / gestureScale); gestureScale = e.scale; });
addEventListener('gesturestart', (e) => e.preventDefault());
function onWheel(e) {
  if (e.target.closest?.('textarea, .panel, .menu') && !(e.ctrlKey || e.metaKey)) return; // let text scroll
  e.preventDefault();
  if (laidOut !== state.version) frame();
  const p = local(e), pinch = e.ctrlKey || e.metaKey, s = spaceAt(p[0], p[1]);
  if (pinch) { pinchAt(p, Math.exp(-e.deltaY * 0.01)); return; }
  if (s.kind === 'scene' && s.focused && !gesture) {
    const o = get(s.id), cam = camOf(o);
    orbit = { id: o.id, ...(pinch || isMouseWheel(e) ? navigate(cam, 'zoom', 0, e.deltaY * (pinch ? 1 : 0.25), s.px.h) : navigate(cam, e.shiftKey ? 'pan' : 'orbit', -e.deltaX, -e.deltaY, s.px.h)) };
    clearTimeout(wheelTimer); wheelTimer = setTimeout(commitCam, 250); // one command when the wheel rests
    return;
  }
  if (isMouseWheel(e)) view.zoomAt(p[0], p[1], Math.exp(-Math.sign(e.deltaY) * Math.min(0.5, Math.abs(e.deltaY) * 0.002 + 0.08)));
  else { const u = view.unitsPerPx(); view.cam.cx += e.deltaX * u; view.cam.cy -= e.deltaY * u; }
}
stage.addEventListener('wheel', onWheel, { passive: false });
addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
pad.addEventListener('auxclick', (e) => e.preventDefault()); // the middle button is ours

// ---- navigation ------------------------------------------------------------

const worldRect = (v) => { const r = rectOf(v.o), c = at(v.xf, [r.cx, r.cy]); return { cx: c[0], cy: c[1], w: r.w * v.xf.k, h: r.h * v.xf.k }; };
function frameIds(ids, fill = 0.8) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const v = vis.get(id) ?? (get(id)?.space === null ? { o: get(id), xf: ROOT } : null);
    if (!v?.xf || v.o.bind) continue;
    const r = worldRect(v);
    x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2); y0 = Math.min(y0, r.cy - r.h / 2); y1 = Math.max(y1, r.cy + r.h / 2);
  }
  if (x0 === Infinity) return false;
  // With the side panel open, frame into the part of the stage it leaves free.
  const taken = settings.panelOpen && !document.body.classList.contains('clean') ? Math.min(316, view.size.w * 0.5) : 0, free = (view.size.w - taken) / view.size.w;
  view.frame({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(1, x1 - x0) / free, h: Math.max(1, y1 - y0) }, fill);
  view.cam.cx += taken / 2 * view.unitsPerPx();
  return true;
}
function fit() {
  if (!frameIds([...state.objects.values()].filter((o) => o.space === null).map((o) => o.id))) { view.cam.cx = 0; view.cam.cy = 0; view.cam.zoom = 1; }
}
const centre = () => [view.size.w / 2, view.size.h / 2];
// Step out of the space in the middle of the view: show its object from outside.
function goUp() {
  const s = spaceAt(...centre());
  if (s.id === null) return fit();
  const parent = get(s.id).space;
  if (parent === null) fit(); else frameIds([parent], 0.82);
}
// An example dragged from the panel lands where it is dropped (on the canvas).
stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/underspace-example')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
stage.addEventListener('drop', (e) => {
  const i = e.dataTransfer?.getData('text/underspace-example');
  if (i === '' || i == null || !EXAMPLES[+i]) return;
  e.preventDefault();
  const p = local(e), q = back(ROOT, view.toWorld(p[0], p[1]));
  app.addExample(EXAMPLES[+i], q.map(round));
});
pad.addEventListener('dblclick', (e) => {
  if (poly) { finishPoly(true); return; }
  const p = local(e), v = vis.get(pick(p[0], p[1]));
  if (!v || !v.px) return fit();
  frameIds([v.o.id], 0.82);
});

// ---- the assistant ---------------------------------------------------------


// A free place in a space: below everything in it, or the middle of the view.
function below(s) {
  let low = Infinity, x0 = Infinity, x1 = -Infinity;
  for (const o of state.objects.values()) {
    if (o.space !== s.id || o.bind) continue;
    const r = rectOf(o);
    low = Math.min(low, r.cy - r.h / 2); x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2);
  }
  return low === Infinity ? back(s.xf ?? ROOT, view.toWorld(...centre())) : [(x0 + x1) / 2, low - 3.2];
}

// Text to objects: the scripted engine first, a local model when it has no answer.
async function ask(text) {
  let plan = scripted(text), by = 'assistant';
  if (!plan) {
    if (!settings.assistBase) throw new Error('no model endpoint set');
    if (!settings.assistModel) setSetting('assistModel', (await listModels(settings.assistBase))[0]);
    plan = await endpoint(text, { base: settings.assistBase, model: settings.assistModel }); by = settings.assistModel;
  }
  // New work goes in the space in the middle of the view, below what is there.
  const s = spaceAt(...centre(), true);
  const where = below(s);
  const made = [];
  batch(() => {
    for (const cmd of plan.commands) {
      const args = { ...cmd.args };
      if (cmd.name === 'patch.add') { args.at ??= where.map(round); args.space ??= s.id; }
      const r = call(cmd.name, args, by);
      if (r?.ids) made.push(...Object.values(r.ids));
      if (r?.group) made.push(r.group);
    }
  });
  if (made.length) requestAnimationFrame(() => frameIds(made.filter(get), 0.6));
  return plan.say;
}

// ---- actions: one table for toolbar, keys, menus and the palette -----------
// { id, title, icon, keys, group, bar: 'tools' | 'edit', menu, when(ctx), run(ctx) }

const PANELS = [
  { id: 'code', title: 'Code', icon: 'code', keys: 'mod+;', make: codePanel },
  { id: 'properties', title: 'Properties', icon: 'props', keys: 'alt+;', make: propertiesPanel },
  { id: 'outliner', title: 'Outliner', icon: 'tree', make: outlinerPanel },
  { id: 'examples', title: 'Examples', icon: 'examples', make: examplesPanel },
  { id: 'docs', title: 'Docs', icon: 'book', make: docsPanel },
  { id: 'help', title: 'Shortcuts', icon: 'help', keys: 'shift+?', make: helpPanel },
  { id: 'settings', title: 'Settings', icon: 'gear', keys: 'mod+,', make: settingsPanel },
];

function context(hitId) {
  const sel = [...state.selection].map(get).filter(Boolean), p = pointer ?? centre();
  const hit = hitId !== undefined ? get(hitId) : null, here = spaceAt(p[0], p[1]);
  const target = sel.find(isTarget) ?? (here.kind === 'scene' ? get(here.id) : null);
  return { sel, one: sel.length === 1 ? sel[0] : null, hit, p, here, target, lines: sel.filter(isLine), shapes: sel.filter((o) => o.kind === 'shape'), groups: sel.filter((o) => o.kind === 'group') };
}
const ids = (list) => list.map((o) => o.id);
const setRole = (list, role) => batch(() => { for (const o of list) { call('object.role', { id: o.id, role, ...(role === 'connector' ? { tol: round(40 * view.unitsPerPx()) } : {}) }); if (role === 'target' && o.kind === 'shape') takeInto(o.id); } });
// A render target over marks takes them in: the lines of its space that lie wholly inside its frame.
function takeInto(id) {
  const t = get(id);
  if (!t || !isTarget(t)) return;
  const r = t.rect, inside = (p) => Math.abs(p[0] - r.cx) <= r.w / 2 && Math.abs(p[1] - r.cy) <= r.h / 2;
  const ids = [...state.objects.values()].filter((o) => o.kind === 'line' && !o.bind && o.space === t.space && o.points.length > 1 && ptsOf(o).every(inside)).map((o) => o.id);
  if (ids.length) call('target.take', { id, ids });
}
const nudge = (c, dx, dy, e) => {
  const u = (e?.shiftKey ? 40 : 8) * view.unitsPerPx();
  if (c.sel.length) call('object.move', { ids: ids(c.sel), dx: round(dx * u), dy: round(dy * u) });
  else { view.cam.cx += dx * u * 6; view.cam.cy += dy * u * 6; }
};
const cycle = (dir) => {
  const s = spaceAt(...(pointer ?? centre())), list = [...state.objects.values()].filter((o) => o.space === s.id && !o.bind);
  if (!list.length) return;
  const i = list.findIndex((o) => state.selection.has(o.id));
  call('select.set', { ids: [list[(i + dir + list.length) % list.length].id] });
};
const addHere = (c, make, extra) => { const s = spaceAt(c.p[0], c.p[1], true); addShape(s, make, c.p, null, extra); };
const can = (list, role) => list.some((o) => o.role !== role);
// What can be made an event: lines on the flat canvas and plain shapes, not already events.
const eventable = (c) => c.sel.filter((o) => o.role !== 'event' && ((isLine(o) && flatLine(o) && o.role !== 'traveler') || (o.kind === 'shape' && o.role === 'visual') || o.kind === 'point'));

const ACTIONS = [
  // grab, rotate, scale: G, R, S with something selected (or points picked), as in Blender
  { id: 'grab', title: 'Grab', icon: 'grab', keys: 'g', group: 'transform', menu: true, when: canTransform, run: () => transform('grab') },
  { id: 'rotate', title: 'Rotate', icon: 'rotate', keys: 'r', group: 'transform', menu: true, when: canTransform, run: () => transform('rotate') },
  { id: 'scale', title: 'Scale', icon: 'scale', keys: 's', group: 'transform', menu: true, when: canTransform, run: () => transform('scale') },
  { id: 'dupgrab', title: 'Duplicate and grab', icon: 'copy', keys: 'shift+d', group: 'transform', when: (c) => c.sel.some((o) => !o.bind), run: (c) => { call('object.copy', { ids: ids(c.sel), dx: 0, dy: 0 }); transform('grab'); } },
  // tools
  { id: 'tool.select', title: 'Select', icon: 'select', keys: 'v', group: 'tool', bar: 'tools', tool: 'select', stack: 'select' },
  { id: 'tool.points', title: 'Control points', icon: 'points', keys: 'shift+v', group: 'tool', bar: 'tools', tool: 'points', stack: 'select' },
  { id: 'tool.pan', title: 'Pan', icon: 'pan', keys: 'h', group: 'tool', bar: 'tools', tool: 'pan' },
  { id: 'tool.draw', title: 'Draw', icon: 'draw', keys: 'd', group: 'tool', bar: 'tools', tool: 'draw', stack: 'line' },
  { id: 'tool.line', title: 'Straight line', icon: 'line', keys: 'l', group: 'tool', bar: 'tools', tool: 'line', stack: 'line' },
  { id: 'tool.polyline', title: 'Polyline: click corners, double-click to end', icon: 'polyline', group: 'tool', bar: 'tools', tool: 'polyline', stack: 'line' },
  { id: 'tool.point', title: 'Point: on a line, a node', icon: 'point', keys: 'i', group: 'tool', bar: 'tools', tool: 'point', stack: 'line' },
  { id: 'tool.poly', title: 'Poly Build (in a 3D scene): click corners, the first again closes a face; drag an edge to extrude', icon: 'mesh', keys: 'shift+b', group: 'tool', bar: 'tools', tool: 'poly', stack: 'line' },
  { id: 'mesh.weld', title: 'Weld corners that sit together', icon: 'joint', group: 'attach', menu: 'Constrain', when: (c) => c.sel.some((o) => o.kind === 'mesh'), run: (c) => batch(() => { for (const o of c.sel.filter((x) => x.kind === 'mesh')) { const w = weld(o.verts, o.faces, 0.02); call('mesh.set', { id: o.id, verts: w.verts, faces: w.faces }); } }) },
  { id: 'tool.rect', title: 'Rectangle', icon: 'rect', keys: 'r', group: 'tool', bar: 'tools', tool: 'rect', stack: 'shape' },
  { id: 'tool.ellipse', title: 'Ellipse', icon: 'ellipse', keys: 'o', group: 'tool', bar: 'tools', tool: 'ellipse', stack: 'shape' },
  { id: 'tool.polygon', title: 'Polygon (sides and star in its settings)', icon: 'polygon', group: 'tool', bar: 'tools', tool: 'polygon', stack: 'shape' },
  // what a point or a joint is (glyphs.js): a submenu of the context menu
  ...POINT_KINDS.map((k) => ({ id: 'glyph.' + k, title: GLYPH_TITLE[k], short: k, icon: 'g.' + k, group: 'role', menu: 'Point', when: (c) => c.sel.some((o) => o.kind === 'point' || o.kind === 'joint'), on: () => [...state.selection].map(get).some((o) => o?.glyph === k), run: (c) => setGlyph(c.sel.filter((o) => o.kind === 'point' || o.kind === 'joint'), k) })),
  { id: 'quant.toggle', title: 'Quantize sliding to the beat', icon: 'grid', keys: 'q', group: 'play', menu: 'Quantize', on: () => settings.quantOn, run: () => setSetting('quantOn', !settings.quantOn) },
  ...[[1 / 16, '1/16 beat', 16], [1 / 8, '1/8 beat', 8], [1 / 4, '1/4 beat', 4], [1 / 3, '1/3 beat (triplets)', 3], [1 / 2, '1/2 beat', 2], [1, 'a beat', 1], [4, 'a bar of 4', 'bar']].map(([q, title, key]) => ({ id: 'quant.' + key, title: `Quantize to ${title}`, short: title, icon: 'grid', group: 'play', menu: 'Quantize', on: () => settings.quantOn && Math.abs(settings.quant - q) < 1e-9, run: () => { setSetting('quant', q); setSetting('quantOn', true); } })),
  { id: 'magnet.toggle', title: 'Magnet in 3D', icon: 'magnet', keys: 'shift+m', group: 'plane', menu: 'Magnet', on: () => settings.magnet !== 'off', run: () => { if (settings.magnet !== 'off') { setSetting('magnetLast', settings.magnet); setSetting('magnet', 'off'); } else setSetting('magnet', settings.magnetLast || 'auto'); } },
  ...MAGNETS.filter((m) => m !== 'off').map((m) => ({ id: 'magnet.' + m, title: `Magnet: ${MAGNET_TITLE[m]}`, short: MAGNET_TITLE[m], icon: 'magnet', group: 'plane', menu: 'Magnet', on: () => settings.magnet === m, run: () => setSetting('magnet', m) })),
  { id: 'view.crossings', title: 'Show where lines cross', icon: 'crossing', group: 'show', menu: true, when: (c) => !c.hit, on: () => settings.showCrossings, run: () => setSetting('showCrossings', !settings.showCrossings) },
  { id: 'tool.sculpt', title: 'Sculpt', icon: 'sculpt', keys: 'u', group: 'tool', bar: 'tools', tool: 'sculpt' },
  { id: 'sculpt.smaller', title: 'Sculpt: smaller', keys: '[', group: 'brush', hidden: true, when: () => tool === 'sculpt', run: () => setSetting('sculptRadius', Math.max(6, Math.round(settings.sculptRadius / 1.2))) },
  { id: 'sculpt.larger', title: 'Sculpt: larger', keys: ']', group: 'brush', hidden: true, when: () => tool === 'sculpt', run: () => setSetting('sculptRadius', Math.min(400, Math.round(settings.sculptRadius * 1.2))) },
  { id: 'sculpt.weaker', title: 'Sculpt: weaker', keys: 'shift+{', group: 'brush', hidden: true, when: () => tool === 'sculpt', run: () => setSetting('sculptStrength', Math.max(0.05, +(settings.sculptStrength - 0.1).toFixed(2))) },
  { id: 'sculpt.stronger', title: 'Sculpt: stronger', keys: 'shift+}', group: 'brush', hidden: true, when: () => tool === 'sculpt', run: () => setSetting('sculptStrength', Math.min(1, +(settings.sculptStrength + 0.1).toFixed(2))) },
  ...Object.entries(SCULPTS).map(([id, t]) => ({ id: 'sculpt.' + id, title: `Sculpt: ${t.label}`, short: t.label, icon: 'sculpt', group: 'brush', menu: 'Sculpt', menuWhen: (c) => c.lines.some(flatLine), on: () => settings.sculpt === id && tool === 'sculpt', run: () => { setSetting('sculpt', id); setTool('sculpt'); } })),
  { id: 'tool.note', title: 'Note', icon: 'note', keys: 'n', group: 'tool', bar: 'tools', tool: 'note' },
  { id: 'tool.code', title: 'Code container', icon: 'box', keys: 'b', group: 'tool2', bar: 'tools', tool: 'code', stack: 'object' },
  // roles: the same key means "tool" with nothing selected and "make this one" with a selection
  { id: 'role.target', title: 'Make render target', icon: 'target', keys: 't', group: 'role', menu: 'Convert to', when: (c) => c.shapes.length && can(c.shapes, 'target'), run: (c) => setRole(c.shapes, 'target') },
  { id: 'tool.target', title: 'Render target', icon: 'target', keys: 't', group: 'tool2', bar: 'tools', tool: 'target', stack: 'object' },
  { id: 'role.score', title: 'Make score', icon: 'score', group: 'role', menu: 'Convert to', when: (c) => c.shapes.length && can(c.shapes, 'score'), run: (c) => setRole(c.shapes, 'score') },
  { id: 'tool.score', title: 'Score', icon: 'score', keys: 's', group: 'tool2', bar: 'tools', tool: 'score', stack: 'object' },
  { id: 'tool.grid', title: 'Grid frame', icon: 'grid', group: 'tool2', bar: 'tools', tool: 'grid', stack: 'object' },
  { id: 'role.grid', title: 'Make grid frame', icon: 'grid', group: 'role', menu: 'Convert to', when: (c) => c.shapes.length && can(c.shapes, 'grid') && c.shapes.every((o) => o.kind === 'shape' && !['traveler', 'note'].includes(o.role)), run: (c) => setRole(c.shapes, 'grid') },
  { id: 'add.grid', title: 'Add grid frame', icon: 'grid', group: 'add', short: 'grid', menu: 'Add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.grid) },
  { id: 'grid.fit', title: 'Fit its length to the bars', icon: 'length', group: 'attach', menu: 'Constrain', when: (c) => c.lines.some((l) => isCurve(l) && get(l.space)?.role !== 'target'), run: (c) => fitToGrid(c.lines.filter(isCurve)) },
  { id: 'tool.event', title: 'Event', icon: 'event', keys: 'y', group: 'tool2', bar: 'tools', tool: 'event', stack: 'object' },
  // Make event: the mark itself becomes the event, looking as it did (crossing a line, entering a closed one or a shape, fires it)
  { id: 'role.event', title: 'Make event', icon: 'event', group: 'role', menu: 'Convert to', when: (c) => eventable(c).length > 0, run: (c) => setRole(eventable(c), 'event') },
  { id: 'attach.event', title: 'Attach an event here', icon: 'event', group: 'attach', menu: true, when: (c) => c.lines.length === 1 && flatLine(c.lines[0]),
    run: (c) => { const l = c.lines[0], { s, at: q } = onLineAt(l, c.p), size = round(26 * unitsPerPx(s)); call('shape.add', { space: l.space, role: 'event', shape: 'ellipse', rect: { cx: round(q[0]), cy: round(q[1]), w: size, h: size } }); } },
  { id: 'attach.nearest', title: 'Attach to the nearest line', icon: 'path', group: 'attach', menu: true, when: (c) => c.shapes.length && c.shapes.every((o) => o.kind === 'shape' && get(o.space)?.role !== 'target') && [...state.objects.values()].some((l) => flatLine(l) && l.space === c.shapes[0].space), run: attachToNearest },
  { id: 'line.travelNearest', title: 'Travel the nearest line', icon: 'traveler', group: 'attach', menu: 'Turn into', when: (c) => c.lines.length === 1 && flatLine(c.lines[0]) && !!nearestLine(c.lines[0].space, boxOf(c.lines[0]).cx, boxOf(c.lines[0]).cy, c.lines[0].id),
    run: (c) => { const l = c.lines[0], r = boxOf(l), near = nearestLine(l.space, r.cx, r.cy, l.id); call('traveler.attach', { id: l.id, on: near.l.id, u: round(near.u) }); } },
  // Constraints, after Sketchpad: joints between lines, pins, and rules a line keeps.
  { id: 'join.crossings', title: 'Join where it crosses', icon: 'joint', group: 'attach', menu: 'Constrain', when: (c) => c.lines.some((l) => isCurve(l) && get(l.space)?.role !== 'target'), run: joinCrossings },
  { id: 'join.touching', title: 'Join where its ends touch', icon: 'joint', group: 'attach', menu: 'Constrain', when: (c) => c.lines.some(isCurve), run: (c) => batch(() => joinTouching(ids(c.lines.filter(isCurve)), new Set())) },
  { id: 'join.pin', title: 'Pin here', icon: 'pin', group: 'attach', menu: 'Constrain', when: (c) => isCurve(c.hit ?? c.one), run: (c) => { const l = isCurve(c.hit) ? c.hit : c.one, { u } = onLineAt(l, c.p); call('joint.add', { at: [{ id: l.id, u: round(u) }], fix: true }); } },
  { id: 'keep.horv', title: 'Keep level or plumb', icon: 'level', group: 'attach', menu: 'Constrain', when: (c) => c.lines.some((l) => isCurve(l) && !l.keep?.horv), run: (c) => call('line.keep', { ids: ids(c.lines.filter(isCurve)), horv: true }) },
  { id: 'keep.length', title: 'Keep its length', icon: 'length', group: 'attach', menu: 'Constrain', when: (c) => c.lines.some((l) => isCurve(l) && !l.keep?.length), run: (c) => call('line.keep', { ids: ids(c.lines.filter(isCurve)), length: true }) },
  { id: 'join.free', title: 'Let go', icon: 'free', group: 'attach', menu: 'Constrain', when: (c) => c.sel.some((o) => o.kind === 'joint' || o.keep || (isLine(o) && lineHasJoints(o))), run: (c) => call('joint.free', { ids: ids(c.sel) }) },
  { id: 'line.toShape', title: 'Turn into the shape it looks like', icon: 'ellipse', group: 'attach', menu: 'Turn into', when: (c) => c.lines.some((l) => flatLine(l) && recognize(ptsOf(l))), run: (c) => linesTo(c, (l) => { const r = recognize(ptsOf(l)); return r && { role: 'visual', shape: r.shape }; }) },
  { id: 'line.toTarget', title: 'Turn into a render target', icon: 'target', group: 'attach', menu: 'Turn into', when: (c) => c.lines.some(flatLine), run: (c) => linesTo(c, () => ({ role: 'target' })) },
  { id: 'line.toCode', title: 'Turn into a code container', icon: 'box', group: 'attach', menu: 'Turn into', when: (c) => c.lines.some(flatLine), run: (c) => linesTo(c, () => ({ role: 'code' })) },
  { id: 'line.straighten', title: 'Straighten', icon: 'straighten', group: 'attach', menu: 'Turn into', when: (c) => c.lines.some((o) => !o.bind && o.points.length > 2), run: (c) => batch(() => { for (const l of c.lines.filter((o) => !o.bind && o.points.length > 2)) { const pts = ptsOf(l); call('line.set', { id: l.id, points: [pts[0], pts[pts.length - 1]].map((p) => p.map(round)), ...(l.pen?.length === pts.length ? { pen: [l.pen[0], l.pen[l.pen.length - 1]] } : {}) }); } }) },
  { id: 'target.out', title: 'Take out of the 3D scene', icon: 'up', group: 'attach', menu: true, when: (c) => c.lines.some((l) => get(l.space)?.role === 'target'), run: (c) => { const l = c.lines.find((x) => get(x.space)?.role === 'target'); call('target.take', { id: l.space, ids: ids(c.lines.filter((x) => x.space === l.space)), out: true }); } },
  { id: 'attach.traveler', title: 'Attach a traveler here', icon: 'traveler', keys: 'a', group: 'attach', menu: true, when: (c) => c.lines.length === 1 && !c.lines[0].bind,
    run: (c) => { const l = c.lines[0], s = spaces.find((x) => x.id === l.space) ?? spaces[0], q = toSpace(s, c.p[0], c.p[1]); const path = shownPath(l), g = gridHere(l.space, path[path.length >> 1]); const id = call('traveler.add', { on: l.id, u: round(nearestU(path, q[0], q[1])), size: round(22 * unitsPerPx(s)), ...(g.beats > 0 ? { dur: 0 } : {}) }); if (id) call('select.set', { ids: [id] }); } },
  { id: 'role.code', title: 'Make code container', icon: 'code', keys: 'c', group: 'role', menu: 'Convert to', when: (c) => c.shapes.length && can(c.shapes, 'code'), run: (c) => setRole(c.shapes, 'code') },
  { id: 'role.path', title: 'Make path', icon: 'path', keys: 'c', group: 'role', menu: 'Convert to', when: (c) => c.lines.length && can(c.lines, 'path'), run: (c) => setRole(c.lines, 'path') },
  { id: 'role.connector', title: 'Make connector', icon: 'connector', keys: 'w', group: 'role', menu: 'Convert to', when: (c) => c.lines.some((o) => !o.bind), run: (c) => setRole(c.lines, 'connector') },
  { id: 'role.ink', title: 'Make plain ink', icon: 'ink', keys: 'x', group: 'role', menu: 'Convert to', when: (c) => c.lines.length && can(c.lines, 'ink'), run: (c) => setRole(c.lines, 'ink') },
  { id: 'path.straight', title: 'Straight strokes', icon: 'line', keys: 'shift+s', group: 'role', menu: true, when: (c) => c.lines.some((o) => o.style?.path !== 'straight' && !o.closed), run: (c) => call('object.style', { ids: ids(c.lines), style: { path: 'straight' } }) },
  { id: 'path.smooth', title: 'Smooth strokes', icon: 'draw', keys: 'shift+s', group: 'role', menu: true, when: (c) => c.lines.some((o) => o.style?.path === 'straight'), run: (c) => call('object.style', { ids: ids(c.lines), style: { path: null } }) },
  { id: 'role.visual', title: 'Make visual', icon: 'visual', keys: 'x', group: 'role', menu: 'Convert to', when: (c) => c.shapes.length && can(c.shapes, 'visual'), run: (c) => setRole(c.shapes, 'visual') },
  // sound: a tap of Space plays or stops (holding it and dragging pans)
  { id: 'play', title: 'Play or pause', icon: 'play', keys: 'mod+enter', group: 'play', bar: 'edit', menu: true, when: () => canPlay(), run: (c) => togglePlay(c) },
  // The timeline: the transport, the musical context, and what plays on it (timeline.js).
  { id: 'timeline', title: 'Timeline', icon: 'timeline', keys: 'alt+t', group: 'play', bar: 'edit', on: () => !!timeline?.visible, run: () => timeline.show() },
  { id: 'take.replay', title: 'Replay the making', icon: 'play', group: 'history', when: () => history().steps.length > 0, run: () => replay() },
  { id: 'debug.show', title: 'Performance and errors', icon: 'fit', keys: 'alt+d', group: 'panel', menu: false, on: () => dbg.visible, run: () => dbg.show() },
  { id: 'debug.copy', title: 'Copy a debug report', icon: 'copy', group: 'panel', run: () => { const r = { ...dbg.report(), objects: state.objects.size, takeSteps: take.clips.length, takeKB: Math.round(JSON.stringify(take).length / 1024), music: state.music, grid: state.grid }; navigator.clipboard?.writeText(JSON.stringify(r, null, 2)); console.info('underspace debug report', r); } },
  { id: 'debug.clear', title: 'Clear the error log', icon: 'clear', group: 'panel', run: () => dbg.clearErrors() },
  { id: 'transport.rewind', title: 'Back to the start', icon: 'rewind', keys: 'alt+,', group: 'play', run: () => rewind() },
  { id: 'transport.record', title: 'Record what plays', icon: 'record', keys: 'alt+r', group: 'play', on: () => transport.recording, run: () => { const was = transport.recording; if (was) { transport.record(false); endRecording(); return; } transport.record(true); if (!transport.playing) countIn(() => togglePlay()); } },
  { id: 'transport.metronome', title: 'Metronome', icon: 'metronome', group: 'play', on: () => settings.metronome, run: () => setSetting('metronome', !settings.metronome) },
  { id: 'transport.loop', title: 'Loop', icon: 'loop', keys: 'alt+l', group: 'play', on: () => transport.loop.on, run: () => { transport.loop = { ...transport.loop, on: !transport.loop.on }; } },
  { id: 'render.clip', title: 'Render to a clip', icon: 'record', group: 'play', menu: true, when: (c) => !c.hit && (travelers().length || scores().length), run: () => renderToClip() },
  { id: 'iannix.import', title: 'Import an IanniX score', icon: 'open', group: 'play', menu: true, when: (c) => !c.hit, run: () => iannixInput.click() },
  { id: 'nous.import', title: 'Import a Midinous project', icon: 'open', group: 'play', menu: true, when: (c) => !c.hit, run: () => nousInput.click() },
  { id: 'midi.import', title: 'Import a MIDI file', icon: 'open', group: 'play', menu: true, when: (c) => !c.hit, run: () => midiInput.click() },
  { id: 'audio.export', title: 'Export the sound', icon: 'save', group: 'play', menu: true, when: (c) => !c.hit && canPlay(), run: () => exportAudio() },
  { id: 'midi.export', title: 'Export recorded clips as MIDI', icon: 'save', group: 'play', menu: true, when: (c) => !c.hit && state.clips.size > 0, run: () => exportMidi() },
  { id: 'midi.connect', title: 'Send notes to MIDI', icon: 'connector', group: 'play', run: () => connectMidi() },
  // ink brushes: on the selection, or with nothing selected, for the lines drawn next
  ...['', ...brushesFor('line')].map((id) => ({
    id: 'brush.' + (id || 'none'), title: id ? `Brush: ${INK[id].label}` : 'Brush: plain line', short: id ? INK[id].label : 'Plain line', icon: 'brush', group: 'brush', menu: 'Brush', menuWhen: (c) => c.lines.some((o) => !o.bind),
    run: (c) => { const on = c.lines.filter((o) => !o.bind); if (on.length) call('object.brush', { ids: ids(on), id: id || null }); else { setSetting('brush', id); setTool('draw'); } },
  })),
  ...brushesFor('plane').filter((id) => !brushesFor('line').includes(id)).map((id) => ({
    id: 'brush.' + id, title: `Fill brush: ${INK[id].label}`, icon: 'brush', group: 'brush',
    run: (c) => { const on = c.shapes.filter((o) => o.role === 'visual'); if (on.length) call('object.brush', { ids: ids(on), id }); else setSetting('planeBrush', id); },
  })),
  // structure
  { id: 'collapse', title: 'Collapse into a group', icon: 'collapse', keys: 'mod+g', group: 'edit', menu: true, when: (c) => c.sel.some((o) => !o.bind), run: (c) => call('group.collapse', { ids: ids(c.sel) }) },
  { id: 'expand', title: 'Expand group', icon: 'expand', keys: ['mod+shift+g', 'e'], group: 'edit', menu: true, when: (c) => c.groups.length, run: (c) => batch(() => c.groups.forEach((g) => call('group.expand', { id: g.id }))) },
  { id: 'copy', title: 'Duplicate', icon: 'copy', keys: 'mod+d', group: 'edit', menu: true, when: (c) => c.sel.some((o) => !o.bind), run: (c) => { const u = round(24 * unitsPerPx(c.here.kind === 'scene' ? spaces[0] : spaces.find((s) => s.id === c.sel[0].space) ?? spaces[0])); call('object.copy', { ids: ids(c.sel), dx: u, dy: -u }); } },
  { id: 'copycode', title: 'Copy code', short: 'Code', icon: 'code', keys: 'mod+c', group: 'edit', menu: 'Copy as', when: (c) => c.one && hasCode(c.one), run: (c) => clip(c.one.code) },
  { id: 'copy.json', title: 'Copy', short: 'JSON', icon: 'copy', keys: 'mod+c', group: 'edit', menu: 'Copy as', when: (c) => c.sel.some((o) => !o.bind), run: copyJSON },
  { id: 'copy.svg', title: 'Copy as SVG', short: 'SVG', icon: 'visual', group: 'edit', menu: 'Copy as', when: (c) => marksOf(c).length, run: (c) => clip(toSVG(marksOf(c))) },
  { id: 'copy.p5', title: 'Copy as p5 code', short: 'p5 code', icon: 'code', group: 'edit', menu: 'Copy as', when: (c) => marksOf(c).length, run: (c) => clip(toP5(marksOf(c))) },
  ...[['lightly', 'Lightly', 1.5], ['moderately', 'Moderately', 4], ['strongly', 'Strongly', 10]].map(([id, title, px]) => ({ id: 'simplify.' + id, title: `Simplify ${id}`, short: title, icon: 'simplify', group: 'edit', menu: 'Simplify', when: (c) => c.lines.some(flatLine), run: (c) => simplifyLines(c, px) })),
  ...[['points', 'Points to grid', 'points'], ['tidy', 'Points to grid, tidy', 'tidy'], ['topleft', 'Position: top left', 'topleft'], ['center', 'Position: centre', 'center'], ['q2', 'Quantize 2× grid', 'tidy', 2], ['q4', 'Quantize 4× grid', 'tidy', 4]].map((d) => ({ id: 'snap.' + d[0], title: `Snap: ${d[1]}`, short: d[1], icon: 'grid', group: 'edit', menu: 'Snap', when: (c) => (d[2] === 'topleft' || d[2] === 'center' ? c.sel.some((o) => !o.bind && vis.get(o.id)?.xf) : c.lines.some(flatLine)), run: (c) => snapSelection(c, d[2], d[3]) })),
  { id: 'front', title: 'Bring to front', icon: 'front', keys: 'mod+shift+]', group: 'edit', menu: 'Arrange', when: (c) => c.sel.length, run: (c) => call('object.order', { ids: ids(c.sel), to: 'front' }) },
  { id: 'forward', title: 'Bring forward', icon: 'front', keys: 'mod+]', group: 'edit', menu: 'Arrange', when: (c) => c.sel.length, run: (c) => call('object.order', { ids: ids(c.sel), to: 'forward' }) },
  { id: 'backward', title: 'Send backward', icon: 'back', keys: 'mod+[', group: 'edit', menu: 'Arrange', when: (c) => c.sel.length, run: (c) => call('object.order', { ids: ids(c.sel), to: 'backward' }) },
  { id: 'back', title: 'Send to back', icon: 'back', keys: 'mod+shift+[', group: 'edit', menu: 'Arrange', when: (c) => c.sel.length, run: (c) => call('object.order', { ids: ids(c.sel), to: 'back' }) },
  { id: 'hide', title: 'Hide', icon: 'hide', keys: 'shift+h', group: 'edit', menu: true, when: (c) => c.sel.length, run: (c) => call('object.flag', { ids: ids(c.sel), hidden: true }) },
  { id: 'lock', title: 'Lock', icon: 'lock', keys: 'shift+l', group: 'edit', menu: true, when: (c) => c.sel.length, run: (c) => call('object.flag', { ids: ids(c.sel), locked: true }) },
  { id: 'showall', title: 'Show and unlock everything', icon: 'clean', group: 'edit', when: () => [...state.objects.values()].some((o) => o.hidden || o.locked), run: () => call('object.flag', { ids: [...state.objects.values()].filter((o) => o.hidden || o.locked).map((o) => o.id), hidden: false, locked: false }) },
  { id: 'points.remove', title: 'Delete points', icon: 'remove', keys: ['backspace', 'delete'], group: 'edit', hidden: true, when: () => tool === 'points' && handles.picked.size, run: removePoints },
  { id: 'view.code', title: 'Code on objects', icon: 'overlay', keys: ';', group: 'show', menu: true, on: () => settings.codeOverlay, run: () => setSetting('codeOverlay', !settings.codeOverlay) },
  { id: 'showcode', title: 'Show code', icon: 'code', group: 'show', menu: true, when: (c) => c.one && hasCode(c.one), run: () => panels.show('code') },
  { id: 'showprops', title: 'Show properties', icon: 'props', group: 'show', menu: true, when: (c) => c.sel.length, run: () => panels.show('properties') },
  { id: 'showtree', title: 'Show in outliner', icon: 'tree', group: 'show', menu: true, when: (c) => c.sel.length, run: () => panels.show('outliner') },
  { id: 'remove', title: 'Delete', icon: 'remove', keys: ['backspace', 'delete'], group: 'delete', menu: true, when: (c) => c.sel.length, run: (c) => call('object.remove', { ids: ids(c.sel) }) },
  // drawing plane of a target
  ...['view', 'front', 'top', 'side'].map((plane) => ({
    id: 'plane.' + plane, title: `Draw on the ${plane} plane`, short: plane, icon: 'plane', group: 'plane', menu: 'Drawing plane', on: (c) => (c.target?.plane ?? 'view') === plane,
    when: (c) => c.target && (c.target.plane ?? 'view') !== plane, run: (c) => call('target.set', { id: c.target.id, plane }),
  })),
  ...[['front', '1', 0, 0], ['side', '3', Math.PI / 2, 0], ['top', '7', 0, 1.55]].map(([name, key, az, el]) => ({
    id: 'view3d.' + name, title: `View from the ${name}`, short: name, icon: 'target', keys: key, group: 'plane', menu: 'View',
    when: (c) => c.here.kind === 'scene' || c.one?.role === 'target', run: (c) => call('target.set', { id: c.target.id, az, el }),
  })),
  { id: 'view3d.home', title: 'Reset the view', short: 'reset', icon: 'target', keys: 'home', group: 'plane', menu: 'View', when: (c) => c.target, run: (c) => call('target.set', { id: c.target.id, az: 0.5, el: 0.3, dist: 13, center: [0, 0, 0] }) },
  ...['origin', 'cursor', 'stroke'].map((anchor) => ({
    id: 'anchor.' + anchor, title: `Draw from the ${anchor === 'stroke' ? 'nearest stroke' : anchor === 'cursor' ? '3D cursor' : 'origin'}`, short: anchor === 'stroke' ? 'nearest stroke' : anchor === 'cursor' ? '3D cursor' : 'origin', icon: 'plane', group: 'plane', menu: 'Draw from',
    when: (c) => c.target && (c.target.anchor ?? 'origin') !== anchor, run: (c) => call('target.set', { id: c.target.id, anchor }),
  })),
  { id: 'plane.next', title: 'Next drawing plane', icon: 'plane', keys: 'p', group: 'plane', when: (c) => c.target, run: (c) => { const all = ['view', 'front', 'top', 'side']; call('target.set', { id: c.target.id, plane: all[(all.indexOf(c.target.plane ?? 'view') + 1) % 4] }); } },
  // adding, at the pointer
  { id: 'add.code', title: 'Add code container', icon: 'box', group: 'add', short: 'code container', menu: 'Add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.code) },
  { id: 'add.target', title: 'Add render target', icon: 'target', group: 'add', short: 'render target', menu: 'Add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.target) },
  { id: 'add.rect', title: 'Add rectangle', icon: 'rect', group: 'add', short: 'rectangle', menu: 'Add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.rect) },
  { id: 'add.score', title: 'Add score', icon: 'score', group: 'add', short: 'score', menu: 'Add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.score) },
  { id: 'add.note', title: 'Add note', icon: 'note', group: 'add', short: 'note', menu: 'Add', when: (c) => !c.hit, run: (c) => { addHere(c, MAKE.note); panels.show('properties'); } },
  { id: 'add.ellipse', title: 'Add ellipse', icon: 'ellipse', group: 'add', short: 'ellipse', menu: 'Add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.ellipse) },
  ...Object.keys(PRESETS).filter((k) => !['path', 'wave', 'blank'].includes(k)).map((k) => ({ id: 'add.' + k, title: 'Add ' + k, icon: 'box', group: 'add', when: (c) => !c.hit, run: (c) => addHere(c, MAKE.code, { preset: k }) })),
  ...['path', 'wave'].map((k) => ({ id: 'code.' + k, title: `Path code: ${k}`, short: k, icon: 'path', group: 'role', menu: 'Path code', when: (c) => c.lines.length && !c.lines.some((o) => o.bind), run: (c) => batch(() => c.lines.forEach((o) => { call('object.role', { id: o.id, role: 'path' }); call('object.code', { id: o.id, code: PRESETS[k] }); })) })),
  // navigation
  { id: 'enter', title: 'Go into', icon: 'enter', keys: 'enter', group: 'nav', menu: true, when: (c) => c.one?.rect || (c.one && blanketOf(c.one)), run: (c) => frameIds([c.one.id], 0.82) },
  { id: 'points.none', title: 'Unpick points', keys: 'escape', group: 'nav', hidden: true, when: () => tool === 'points' && handles.picked.size, run: () => handles.picked.clear() },
  { id: 'points.all', title: 'Pick every point shown', keys: 'mod+a', group: 'nav', hidden: true, when: () => tool === 'points', run: () => { for (const h of handles.shown) handles.picked.add(handles.key(h.id, h.i)); } },
  { id: 'deselect', title: 'Deselect', keys: 'escape', group: 'nav', when: (c) => c.sel.length, run: () => call('select.set', { ids: [] }) },
  { id: 'up', title: 'Go up a level', icon: 'up', keys: 'escape', group: 'nav', run: goUp },
  { id: 'frame', title: 'Frame the selection', icon: 'frame', keys: ['shift+f', '2'], group: 'nav', menu: true, when: (c) => c.sel.length, run: (c) => frameIds(ids(c.sel), 0.6) },
  { id: 'fit', title: 'Fit everything', icon: 'fit', keys: ['f', '1'], group: 'nav', menu: true, when: (c) => !c.hit, run: fit },
  { id: 'zoom100', title: 'Zoom to 100%', icon: 'frame', keys: '0', group: 'nav', run: () => { view.zoomAt(...centre(), 1 / view.cam.zoom); } },
  { id: 'zoomin', title: 'Zoom in', icon: 'zoomin', keys: ['=', 'shift++'], group: 'nav', run: () => view.zoomAt(...(pointer ?? centre()), 1.3) },
  { id: 'zoomout', title: 'Zoom out', icon: 'zoomout', keys: '-', group: 'nav', run: () => view.zoomAt(...(pointer ?? centre()), 1 / 1.3) },
  { id: 'left', title: 'Left', keys: ['arrowleft', 'shift+arrowleft'], group: 'nav', hidden: true, run: (c, e) => nudge(c, -1, 0, e) },
  { id: 'right', title: 'Right', keys: ['arrowright', 'shift+arrowright'], group: 'nav', hidden: true, run: (c, e) => nudge(c, 1, 0, e) },
  { id: 'upward', title: 'Up', keys: ['arrowup', 'shift+arrowup'], group: 'nav', hidden: true, run: (c, e) => nudge(c, 0, 1, e) },
  { id: 'down', title: 'Down', keys: ['arrowdown', 'shift+arrowdown'], group: 'nav', hidden: true, run: (c, e) => nudge(c, 0, -1, e) },
  { id: 'next', title: 'Select next', keys: ']', group: 'nav', run: () => cycle(1) },
  { id: 'prev', title: 'Select previous', keys: '[', group: 'nav', run: () => cycle(-1) },
  { id: 'all', title: 'Select all here', icon: 'all', keys: 'mod+a', group: 'nav', menu: true, when: (c) => !c.hit, run: (c) => call('select.set', { ids: [...state.objects.values()].filter((o) => o.space === c.here.id).map((o) => o.id) }) },
  // history and file
  { id: 'undo', title: 'Undo', icon: 'undo', keys: 'mod+z', group: 'history', bar: 'edit', run: undo },
  { id: 'redo', title: 'Redo', icon: 'redo', keys: ['mod+shift+z', 'mod+y'], group: 'history', bar: 'edit', run: redo },
  { id: 'save', title: 'Save take', icon: 'save', keys: 'mod+s', group: 'file', run: saveTake },
  { id: 'open', title: 'Open take', icon: 'open', keys: 'mod+o', group: 'file', run: () => $('file').click() },
  { id: 'clear', title: 'Clear everything', icon: 'clear', group: 'file', run: () => call('space.clear') },
  { id: 'demo', title: 'Build the demo', icon: 'demo', group: 'file', run: demo },
  // panels and the assistant
  { id: 'palette', title: 'Command palette', icon: 'palette', keys: ['mod+k', '/'], group: 'panel', bar: 'edit', menu: true, when: (c) => !c.hit, run: () => palette.toggle() },
  { id: 'side', title: 'Side panel', icon: 'side', keys: '\\', group: 'panel', run: () => panels.toggle() },
  ...PANELS.map((d) => ({ id: 'panel.' + d.id, title: d.title, icon: d.icon, keys: d.keys, group: 'panel', run: () => panels.show(d.id) })),
  { id: 'paste.here', title: 'Paste here', icon: 'copy', group: 'add', menu: true, when: (c) => !c.hit && !!navigator.clipboard?.readText, run: async (c) => pasteText(await navigator.clipboard.readText(), c) },
  { id: 'grid', title: 'Grid', icon: 'grid', keys: "mod+'", group: 'panel', menu: true, when: (c) => !c.hit, on: () => settings.grid, run: () => setSetting('grid', !settings.grid) },
  { id: 'snap', title: 'Snap to the grid', icon: 'grid', keys: "mod+shift+'", group: 'panel', menu: true, when: (c) => !c.hit, on: () => settings.snap, run: () => setSetting('snap', !settings.snap) },
  { id: 'clean', title: 'Hide the interface', icon: 'clean', keys: ['tab', 'alt+z', 'mod+.'], group: 'panel', run: () => document.body.classList.toggle('clean') },
];
for (const a of ACTIONS) if (a.tool) a.run = () => setTool(a.tool);

const SYMBOL = { mod: '⌘', shift: '⇧', alt: '⌥', backspace: '⌫', enter: '↵', escape: 'esc', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', tab: 'tab' };
const keysOf = (a) => [a.keys ?? []].flat();
const showKey = (a) => { const k = keysOf(a)[0]; return k ? k.split('+').map((s) => SYMBOL[s] ?? s.toUpperCase()).join('') : ''; };
const asItem = (a, c, short) => ({ title: short ? a.short ?? a.title : a.title, icon: a.icon, keys: showKey(a), on: a.on?.(c), run: () => a.run(c) });
// The context menu: what can be done to what is under the pointer (after AMS's),
// the actions marked `menu`, those with a name in submenus of that name.
const allowed = (a, c) => !a.when || a.when(c);
const MENU_ORDER = ['attach', 'transform', 'role', 'brush', 'play', 'edit', 'plane', 'add', 'nav', 'panel', 'show', 'delete'];
function contextItems(c) {
  const groups = new Map(), subs = new Map();
  for (const a of ACTIONS) {
    if (!a.menu || !allowed(a, c) || (a.menuWhen && !a.menuWhen(c))) continue;
    if (!groups.has(a.group)) groups.set(a.group, []);
    if (typeof a.menu === 'string') {
      if (!subs.has(a.menu)) { const sub = { title: a.menu, items: [] }; subs.set(a.menu, sub); groups.get(a.group).push(sub); }
      subs.get(a.menu).items.push(asItem(a, c, true));
    } else groups.get(a.group).push(asItem(a, c));
  }
  const rank = (g) => { const i = MENU_ORDER.indexOf(g); return i < 0 ? MENU_ORDER.length : i; };
  const items = c.sel.length ? [{ header: true, title: c.one ? c.one.name || blanketOf(c.one)?.name || c.one.role : `${c.sel.length} objects` }] : [];
  for (const g of [...groups.keys()].sort((a, b) => rank(a) - rank(b))) items.push(null, ...groups.get(g));
  return items;
}

function saveTake() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(take)], { type: 'application/json' }));
  a.download = 'underspace-take.json'; a.click(); URL.revokeObjectURL(a.href);
}
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) try { loadTake(JSON.parse(await f.text())); fit(); } catch (err) { console.warn(err.message); }
});

// Islands: the tools in the middle, file and history at the left, the panel
// tabs at the right, zoom at the bottom. Each button is an action.
function island(el, name) {
  let lastGroup = null;
  for (const a of ACTIONS.filter((x) => x.bar === name)) {
    if (a.stack && stacks.has(a.stack)) { stacks.get(a.stack).members.push(a); continue; }
    if (lastGroup && a.group !== lastGroup) el.append(document.createElement('hr'));
    lastGroup = a.group;
    const b = document.createElement('button'), key = showKey(a);
    if (a.stack) {
      // One button for the tools of a kind. Click picks the one shown; click
      // again, or right-click, for the others.
      const st = { b, members: [a], current: a };
      stacks.set(a.stack, st);
      b.className = 'stack';
      b.onclick = () => (tool === st.current.tool ? stackMenu(st) : st.current.run());
      b.oncontextmenu = (e) => { e.preventDefault(); stackMenu(st); };
    } else {
      b.title = key ? `${a.title} (${key})` : a.title; b.setAttribute('aria-label', a.title); b.innerHTML = icon(a.icon);
      if (a.tool) { b.dataset.tool = a.tool; b.oncontextmenu = (e) => { e.preventDefault(); toolPopover(a.tool, b); }; }
      b.onclick = () => { const c = context(); if (allowed(a, c)) a.run(c); };
    }
    el.append(b);
  }
  for (const [key, st] of stacks) { st.current = st.members.find((a) => a.tool === settings.stacks[key]) ?? st.current; paintStack(st); }
}
function paintStack(st) {
  const a = st.current, key = showKey(a);
  st.b.title = `${a.title}${key ? ` (${key})` : ''} · ${st.members.filter((x) => x !== a).map((x) => x.title).join(', ')}`;
  st.b.setAttribute('aria-label', a.title); st.b.innerHTML = icon(a.icon);
}
function stackMenu(st) {
  const r = st.b.getBoundingClientRect();
  showMenu([...st.members.map((a) => ({ title: a.title, icon: a.icon, keys: showKey(a), run: () => a.run() })), null, { title: 'Tool settings', icon: 'props', run: () => toolPopover(st.current.tool, st.b) }], r.left, r.bottom + 6);
}
// The small Properties at a point: the tool's settings, or the selection's.
let pop = null;
function toolPopover(name, anchor) {
  const r = anchor.getBoundingClientRect?.() ?? { left: anchor[0], bottom: anchor[1] };
  pop = showPopover(() => toolProps(app, name), r.left, r.bottom + 6);
}
onChange(() => pop?.refresh());
onSettings(() => pop?.refresh());

// An island moves by its grip and stays where it is put; double-click the
// grip to send it home.
function placeIsland(el, x, y) {
  x = Math.max(0, Math.min(x, stage.clientWidth - el.offsetWidth)); y = Math.max(0, Math.min(y, stage.clientHeight - el.offsetHeight));
  el.style.cssText = `left:${x}px;top:${y}px;right:auto;bottom:auto;transform:none`;
  return [x, y];
}
function grip(el) {
  const g = document.createElement('i');
  g.className = 'grip'; g.title = 'Drag to move · double-click to put back';
  el.prepend(g);
  g.addEventListener('pointerdown', (e) => {
    g.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(), off = [e.clientX - r.left, e.clientY - r.top];
    let at = null;
    const move = (ev) => { at = placeIsland(el, ev.clientX - s.left - off[0], ev.clientY - s.top - off[1]); };
    const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); if (at) setSetting('islands', { ...settings.islands, [el.id]: at }); };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
  });
  g.addEventListener('dblclick', () => { el.style.cssText = ''; const rest = { ...settings.islands }; delete rest[el.id]; setSetting('islands', rest); });
}
const placeIslands = () => { for (const [id, at] of Object.entries(settings.islands)) if ($(id)) placeIsland($(id), at[0], at[1]); };
const runAction = (id, c = context()) => { const a = ACTIONS.find((x) => x.id === id); if (a && allowed(a, c)) a.run(c); };
const glyph = (name, title, onClick) => { const b = document.createElement('button'); b.title = title; b.setAttribute('aria-label', title); b.innerHTML = icon(name); b.onclick = onClick; return b; };

// File menu: everything in the file group, then the panels that explain.
$('edit').append(glyph('menu', 'Menu', (e) => {
  const c = context(), r = e.currentTarget.getBoundingClientRect();
  const pickIds = ['save', 'open', 'demo', 'clear', null, 'showall', 'grid', 'snap', null, 'panel.examples', 'panel.docs', 'panel.help', 'panel.settings'];
  showMenu(pickIds.map((id) => { const a = id && ACTIONS.find((x) => x.id === id); return a && allowed(a, c) ? asItem(a, c) : null; }), r.left, r.bottom + 6);
}), document.createElement('hr'));
island($('edit'), 'edit');
island($('tools'), 'tools');

// Stroke and fill: new marks take them, and so does the selection.
function swatch(key, title) {
  const b = document.createElement('button');
  b.className = 'swatch-button ' + key; b.title = title; b.setAttribute('aria-label', title);
  const paint = () => { b.style.setProperty('--c', settings[key] ?? (key === 'stroke' ? 'var(--ink)' : 'transparent')); b.classList.toggle('none', !settings[key]); };
  b.onclick = () => {
    const r = b.getBoundingClientRect(), pop = document.createElement('div');
    pop.className = 'menu popover';
    pop.append(colorField(settings[key], (c) => {
      setSetting(key, c);
      const sel = context().sel.filter((o) => !o.bind && o.kind !== 'group');
      if (sel.length) call('object.style', { ids: ids(sel), style: { [key]: c } });
      pop.remove();
    }));
    document.body.append(pop);
    pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 6 + 'px';
    setTimeout(() => addEventListener('pointerdown', function away(ev) { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('pointerdown', away, true); } }, true));
  };
  onSettings((k) => { if (k === key) paint(); });
  paint();
  return b;
}
$('tools').append(document.createElement('hr'), swatch('stroke', 'Stroke'), swatch('fill', 'Fill'));

const zoomLabel = document.createElement('button');
zoomLabel.className = 'zoom-label'; zoomLabel.title = 'Zoom to 100% (0)'; zoomLabel.onclick = () => runAction('zoom100');
const gridButton = glyph('grid', "Grid (⌘')", () => runAction('grid'));
$('zoom').append(glyph('minus', 'Zoom out (−)', () => view.zoomAt(...centre(), 1 / 1.3)), zoomLabel, glyph('plus', 'Zoom in (+)', () => view.zoomAt(...centre(), 1.3)), glyph('fit', 'Fit everything (F)', fit), document.createElement('hr'), gridButton);

$('peek').innerHTML = icon('clean');
$('peek').onclick = () => document.body.classList.toggle('clean');

// What the panels may use.
let settingsVersion = 0;
onSettings(() => settingsVersion++);
const app = {
  state, call, batch, get, tools, PRESETS, BRUSHES, INK, SCULPTS, brushesFor, actions: ACTIONS, onParam, onCode, frameIds, runAction,
  run: () => run, setRole, keysShown: (a) => showKey(a), tool: () => tool, settingsVersion: () => settingsVersion,
  presetsFor: (o) => (o.role === 'target' ? TARGET_PRESETS : o.role === 'score' ? BRUSHES : o.role === 'junction' ? JUNCTIONS : o.role === 'event' ? EVENTS : o.role === 'grid' ? GRID_PRESETS : PRESETS),
  // Add an example: built, then moved as a whole to `drop` (a canvas point: dragged from the panel),
  // or just below what is on the canvas, clear of it; it comes in selected, so it can be moved at once.
  addExample(ex, drop = null) {
    const before = new Set(state.objects.keys());
    const box = (list) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const o of list) { if (o.bind || o.kind === 'joint') continue; const r = rectOf(o); x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2); y0 = Math.min(y0, r.cy - r.h / 2); y1 = Math.max(y1, r.cy + r.h / 2); }
      return x0 === Infinity ? null : { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    };
    const old = box([...state.objects.values()].filter((o) => o.space === null));
    let fresh = [];
    batch(() => {
      const c = (name, args) => call(name, args, 'example');
      const made = ex.build(c, [0, 0]);
      for (const [from, out, to, inn] of made?.connect ?? []) {
        const p = portPos(get(from), 'outs', out), q = portPos(get(to), 'ins', inn);
        c('line.add', { points: Array.from({ length: 12 }, (_, i) => { const u = i / 11; return [round(p[0] + (q[0] - p[0]) * u), round(p[1] + (q[1] - p[1]) * u + Math.sin(u * Math.PI) * 0.4)]; }), tol: 0.05 });
      }
      fresh = [...state.objects.keys()].filter((id) => !before.has(id) && get(id)?.space === null && !get(id).bind);
      const b = box(fresh.map(get));
      if (b) {
        const mid = back(ROOT, view.toWorld(...centre()));
        const to = drop ?? (old ? [old.cx, old.y0 - 1.5 - (b.y1 - b.y0) / 2] : mid);
        const dx = round(to[0] - b.cx), dy = round(to[1] - b.cy);
        if (dx || dy) c('object.move', { ids: fresh, dx, dy });
      }
      c('select.set', { ids: fresh.filter((id) => get(id)?.kind !== 'joint' && get(id)?.role !== 'traveler') });
    });
    if (!drop) requestAnimationFrame(() => frameIds(fresh, 0.6));
  },
};
const panels = createPanels($('tabs'), $('side'), app, PANELS);
// Replay the making: every step again, at the pace it was made (pauses over 1.5 s shortened).
// A press or a key stops it where it is.
// A stroke a step added is drawn again as the hand drew it, point by point on its pen times.
let replaying = 0, replayToken = 0;
function stopReplay() { clearTimeout(replaying); replaying = 0; replayToken++; setLive(null); dragSig = ''; }
function replay() {
  if (replaying) { stopReplay(); return; }
  const steps = history().steps, end = steps.length;
  if (!end) return;
  travel(0);
  const token = ++replayToken;
  let i = 0;
  const next = () => {
    if (token !== replayToken) return;
    const before = new Set(state.objects.keys());
    travel(++i);
    const drawn = [...state.objects.values()].filter((o) => !before.has(o.id) && isLine(o) && o.pen?.length === o.points.length && o.points.length > 1);
    const wait = () => { replaying = i < end ? setTimeout(next, Math.max(0.05, Math.min(1.5, steps[i].t - steps[i - 1].t - steps[i].drew)) * 1000) : 0; };
    if (!drawn.length) return wait();
    // draw them out: each point appears at its time; a long stroke is sped up to at most 8 s
    const t0 = performance.now(), span = Math.max(...drawn.map((o) => o.pen[o.pen.length - 1][0] - o.pen[0][0])), k = span > 8000 ? span / 8000 : 1;
    replaying = 1;
    const tick = () => {
      if (token !== replayToken) return;
      const ms = (performance.now() - t0) * k, live = new Map();
      for (const o of drawn) { const p0 = o.pen[0][0]; let n = 1; while (n < o.points.length && o.pen[n][0] - p0 <= ms) n++; if (n < o.points.length) live.set(o.id, { points: ptsOf(o).slice(0, Math.max(2, n)), pen: o.pen.slice(0, Math.max(2, n)) }); }
      setLive(live.size ? live : null); dragSig = 'replay' + ms;
      if (live.size) requestAnimationFrame(tick); else { setLive(null); dragSig = ''; wait(); }
    };
    requestAnimationFrame(tick);
  };
  replaying = setTimeout(next, 400);
}
for (const type of ['pointerdown', 'keydown']) addEventListener(type, (e) => { if (replaying && !e.target.closest?.('.timeline')) stopReplay(); }, true);

timeline = createTimeline($('timeline'), {
  transport, state, call, history, travel, replay, get replaying() { return !!replaying; }, runAction: (id) => runAction(id), get metronome() { return settings.metronome; },
  lanes() {
    const m = state.music, spb = secPerBeat(m), out = [];
    for (const o of travelers()) { const p = paramsOf(o), line = get(o.on), path = line && shownPath(line), len = p.speed > 0 && line ? measure(path).total / (p.speed * gridCell()) : !(p.dur > 0) && line ? pathBeats(path, gridHere(line.space, path[path.length >> 1])) || 8 : p.dur; out.push({ id: o.id, kind: 'traveler', name: o.name || 'traveler ' + o.id, at: p.at ?? 0, len: Math.max(0.25, len), repeat: p.loop !== 0 }); }
    for (const o of scores()) out.push({ id: o.id, kind: 'score', name: o.name || 'score ' + o.id, at: 0, len: passLen(o) / spb, repeat: true, muted: !scorePlaying(o) });
    for (const c of state.clips.values()) { const len = Math.max(1, ...c.notes.map((n) => n.beat + n.len)); out.push({ id: c.id, kind: 'clip', name: c.name, at: clipDrag?.id === c.id ? clipDrag.at : c.at, len, notes: c.notes, muted: c.muted }); }
    return out;
  },
  seek,
  preview(id, at) { clipDrag = id ? { id, at } : null; },
  // channels and the instruments they play: a menu from the timeline's head
  instruments(x, y) {
    const chans = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    showMenu(chans.map((c) => ({ title: `${c} · ${instrumentOf(c)}`, items: INSTRUMENTS.map((inst) => ({ title: inst, on: instrumentOf(c) === inst, run: () => { call('music.set', { channels: { [c]: inst } }); sound.note(c === 10 ? 38 : 60, 100, 0.4, inst); } })) })), x, y);
  },
  actions: { play: () => togglePlay(), stop: () => rewind(), record: () => runAction('transport.record'), loop: () => runAction('transport.loop') },
  clipMenu(id, x, y) {
    const c = state.clips.get(id);
    showMenu([{ header: true, title: c.name }, { title: c.muted ? 'Unmute' : 'Mute', icon: 'hide', run: () => call('clip.set', { id, muted: !c.muted }) }, { title: timeline.editing === id ? 'Close the notes' : 'Edit the notes', icon: 'points', run: () => timeline.edit(timeline.editing === id ? null : id) }, { title: 'Export as MIDI', icon: 'save', run: () => exportMidi([c]) }, { title: 'Duplicate after it', icon: 'copy', run: () => { const len = Math.max(1, ...c.notes.map((n) => n.beat + n.len)), per = state.music.meter[0]; call('clip.add', { at: c.at + Math.ceil(len / per) * per, notes: c.notes, name: c.name }); } }, { title: 'Rename', icon: 'note', run: () => { const name = prompt('Name', c.name); if (name) call('clip.set', { id, name }); } }, null, { title: 'Delete', icon: 'remove', run: () => call('clip.set', { id, remove: true }) }], x, y);
  },
});
// Render the drawing to a clip, offline: travelers, events and junctions are played from the
// start, and each score's passes are read, over the loop range (or 8 bars); what they play
// becomes a clip there. Same as playing it live, without waiting.
function renderToClip() {
  const m = state.music, spb = secPerBeat(m), per = m.meter[0];
  const [a, b] = transport.loop.on && transport.loop.b > transport.loop.a ? [transport.loop.a, transport.loop.b] : [0, 8 * per];
  const notes = renderNotes(state.objects, b * spb, musicHooks()).map((n) => ({ beat: n.sec / spb, midi: n.midi, vel: n.vel, len: n.len / spb, ch: n.ch }));
  for (const o of scores()) {
    if (o.hidden) continue;
    const L = passLen(o) / spb; // beats a pass
    for (let k = Math.floor(a / L); k * L < b; k++) {
      const sc = scoreOf(o.id);
      for (const v of sc?.voices ?? []) v.events.forEach((e, i) => { const nx = v.events[i + 1]; notes.push({ beat: k * L + e.time / spb, midi: Math.round(e.midi), vel: Math.round(100 * (e.gain ?? 0.7)), len: Math.max(1 / 16, nx ? (nx.time - e.time) / spb : 0.5), ch: 1 }); });
    }
  }
  const inside = notes.filter((n) => n.beat >= a && n.beat < b).map((n) => ({ ...n, beat: n.beat - a }));
  if (!inside.length) { readout.hidden = false; readout.textContent = '∅'; setTimeout(() => { readout.hidden = true; }, 1200); return; }
  const id = call('clip.add', { at: a, notes: inside, name: 'render' });
  timeline?.show(true);
  return id;
}
// The performance as sound, rendered offline over the loop range (or 8 bars): travelers, events,
// junctions, scores' brushes and the recorded clips, through the built-in instruments, as a WAV.
async function exportAudio() {
  const m = state.music, spb = secPerBeat(m), per = m.meter[0];
  const [a, b] = transport.loop.on && transport.loop.b > transport.loop.a ? [transport.loop.a, transport.loop.b] : [0, 8 * per];
  const notes = renderNotes(state.objects, b * spb, musicHooks()).filter((n) => n.sec >= a * spb).map((n) => ({ ...n, sec: n.sec - a * spb, instrument: instrumentOf(n.ch) }));
  for (const c of state.clips.values()) if (!c.muted) for (const n of c.notes) { const beat = c.at + n.beat; if (beat >= a && beat < b) notes.push({ sec: (beat - a) * spb, midi: n.midi, vel: n.vel, len: n.len * spb, instrument: instrumentOf(n.ch) }); }
  const passes = [];
  for (const o of scores()) {
    if (o.hidden) continue;
    const L = passLen(o);
    for (let k = Math.floor((a * spb) / L); k * L < b * spb; k++) { const sc = scoreOf(o.id); if (sc) passes.push({ at: k * L - a * spb, score: sc }); }
  }
  readout.hidden = false; readout.textContent = '◌';
  try {
    const blob = await sound.renderAudio(notes, passes, (b - a) * spb);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'underspace.wav'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    readout.hidden = true;
  } catch (e) { readout.textContent = e.message; setTimeout(() => { readout.hidden = true; }, 2500); }
}
// A MIDI file as clips: one clip, at the playhead's bar; its tempo is offered to the timeline.
const midiInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.mid,.midi,audio/midi', hidden: true });
document.body.append(midiInput);
midiInput.addEventListener('change', async () => {
  const f = midiInput.files?.[0];
  midiInput.value = '';
  if (!f) return;
  try {
    const { notes, bpm, meter } = readNotes(new Uint8Array(await f.arrayBuffer()));
    if (!notes.length) throw new Error('no notes');
    const at = Math.floor(transport.beat / state.music.meter[0]) * state.music.meter[0];
    batch(() => { if (!state.clips.size && bpm) call('music.set', { bpm, meter }); call('clip.add', { at, notes, name: f.name.replace(/\.midi?$/i, '') }); });
    timeline?.show(true);
  } catch (e) { readout.hidden = false; readout.textContent = e.message; setTimeout(() => { readout.hidden = true; }, 2500); }
});

// An IanniX score (.iannix): its code is run (it is your own file: asked first), and its
// curves, cursors and triggers become lines, travelers and events in the middle of the view.
const iannixInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.iannix,.js,.txt', hidden: true });
document.body.append(iannixInput);
iannixInput.addEventListener('change', async () => {
  const f = iannixInput.files?.[0];
  iannixInput.value = '';
  if (!f || !confirm(`Run ${f.name} as code?`)) return;
  try {
    const at = view.toWorld(...centre()), u = view.unitsPerPx();
    const plan = iannixPlan(await f.text(), { width: Math.min(view.size.w, view.size.h * 1.4) * 0.8 * u, at });
    if (!plan.curves.length) throw new Error(plan.warnings[0] ?? 'nothing in it');
    const made = batch(() => { const m = applyPlan(plan, call, secPerBeat(state.music)); call('select.set', { ids: m }); return m; });
    if (plan.warnings.length) console.info('IanniX import:', plan.warnings.join('; '));
    readout.hidden = false; readout.textContent = `${plan.title} · ${plan.stats.curves} ⌇ ${plan.stats.cursors} ● ${plan.stats.triggers} ◦`;
    setTimeout(() => { readout.hidden = true; }, 3000);
    return made;
  } catch (e) { readout.hidden = false; readout.textContent = e.message; setTimeout(() => { readout.hidden = true; }, 3000); }
});

// A Midinous or midinojs project (.nous or .json): its nodes become joints whose code plays and
// routes, its paths lines a grid cell a beat long each, its start nodes travelers.
const nousInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.nous,.json', hidden: true });
document.body.append(nousInput);
nousInput.addEventListener('change', async () => {
  const f = nousInput.files?.[0];
  nousInput.value = '';
  if (!f) return;
  try {
    const plan = nousPlan(await f.text(), { cell: gridCell(), at: view.toWorld(...centre()) });
    if (!plan.nodes.length) throw new Error(plan.warnings[0] ?? 'no nodes');
    batch(() => {
      const m = plan.settings, ctx = {};
      if (m.bpm) ctx.bpm = m.bpm; if (m.scale) ctx.scale = m.scale; if (m.root != null) ctx.root = m.root;
      if (Object.keys(ctx).length) call('music.set', ctx);
      call('select.set', { ids: applyNous(plan, call) });
    });
    if (plan.warnings.length) console.info('Midinous import:', plan.warnings.join('; '));
    readout.hidden = false; readout.textContent = `${f.name} · ${plan.stats.nodes} ◦ ${plan.stats.paths} ⌇`; setTimeout(() => { readout.hidden = true; }, 3000);
  } catch (e) { readout.hidden = false; readout.textContent = e.message; setTimeout(() => { readout.hidden = true; }, 3000); }
});

// The recorded clips as a Standard MIDI File, downloaded.
function exportMidi(list = [...state.clips.values()].filter((c) => !c.muted)) {
  const notes = list.flatMap((c) => c.notes.map((n) => ({ ...n, beat: c.at + n.beat })));
  const bytes = midiFile(notes, { bpm: state.music.bpm, meter: state.music.meter, name: 'underspace' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' })); a.download = 'underspace.mid'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function connectMidi() {
  try { const ports = await midiOut.connect(); readout.hidden = false; readout.textContent = ports.length ? '⇢ ' + ports.map((p) => p.name).join(', ') : '⇢ no MIDI outputs'; setTimeout(() => { readout.hidden = true; }, 2500); }
  catch (e) { readout.hidden = false; readout.textContent = e.message; setTimeout(() => { readout.hidden = true; }, 2500); }
}
$('tabs').append(document.createElement('hr'), glyph('clean', 'Hide the interface (Tab)', () => document.body.classList.toggle('clean')));

// Settings that change what is on screen.
function applySettings() {
  document.documentElement.dataset.theme = settings.theme === 'auto' ? '' : settings.theme;
  inkColor = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || inkColor;
  stage.classList.toggle('grid', settings.grid);
  gridButton.setAttribute('aria-pressed', String(settings.grid));
  view.readTheme();
}
onSettings(applySettings);
applySettings();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
for (const id of ['edit', 'tools', 'tabs', 'zoom']) grip($(id));
placeIslands();
addEventListener('resize', placeIslands);

const palette = createPalette($('palette'), { ask, getActions: () => { const c = context(); return ACTIONS.filter((a) => !a.hidden && a.id !== 'palette' && allowed(a, c)).map((a) => asItem(a, c)); } });

// Context menu: the actions that apply to what was clicked, grouped.
pad.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gesture?.kind === 'zoom' || gesture?.kind === 'nav3d') return; // Ctrl+click on a Mac is also a right-click
  const p = local(e), id = pick(p[0], p[1]);
  pointer = p;
  if (id && !state.selection.has(id)) call('select.set', { ids: [id] });
  const in3d = spaceAt(p[0], p[1]);
  if (e.shiftKey && in3d.kind === 'scene') { // Shift+right-click in a target: put its 3D cursor here, and draw from it
    const o = get(in3d.id), at3 = magnetIn({ ...in3d, plane: o.plane ?? 'view', origin: o.cursor ?? [0, 0, 0] }, p)?.point;
    if (at3) call('target.set', { id: o.id, cursor: at3.map(round), anchor: 'cursor' });
    return;
  }
  if (e.altKey) { // Alt+right-click: properties here, of what is selected or else of the tool
    const sel = () => [...state.selection].map(get).filter(Boolean);
    pop = showPopover(() => (sel().length ? selectionProps(app, sel()) : toolProps(app, tool)), e.clientX, e.clientY);
    return;
  }
  showMenu(contextItems(context(id ?? null)), e.clientX, e.clientY);
});

// Keys: the first action bound to the key whose context holds.
// With Alt (Option) a Mac types another character (Alt+T is †): read the key that was pressed instead.
const CODE_KEY = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Quote: "'", Minus: '-', Equal: '=', Backslash: '\\' };
const baseKey = (e) => (e.altKey && /^(Key|Digit)./.test(e.code ?? '') ? e.code.slice(-1).toLowerCase() : e.altKey && CODE_KEY[e.code] ? CODE_KEY[e.code] : e.key === ' ' ? 'space' : e.key.toLowerCase());
const keyOf = (e) => [(e.metaKey || e.ctrlKey) && 'mod', e.shiftKey && 'shift', e.altKey && 'alt', baseKey(e)].filter(Boolean).join('+');
addEventListener('keydown', (e) => {
  if (poly && (e.key === 'Enter' || e.key === 'Escape')) { finishPoly(e.key === 'Enter'); e.preventDefault(); return; }
  if (build && (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace')) { buildKey(e.key); e.preventDefault(); return; }
  if (e.target.closest?.('input, textarea, select, .menu')) return;
  if (e.key === ' ') { if (!spaceKey) { spaceUsed = false; spaceAt0 = performance.now(); } spaceKey = true; pad.dataset.pan = '1'; e.preventDefault(); return; }
  const k = keyOf(e), c = context();
  if (k === 'mod+c' && !c.sel.length) return; // let the browser copy
  const a = ACTIONS.find((x) => keysOf(x).includes(k) && allowed(x, c));
  if (a) { e.preventDefault(); a.run(c, e); }
});
addEventListener('keyup', (e) => {
  if (e.key !== ' ' || !spaceKey) return;
  spaceKey = false; delete pad.dataset.pan;
  if (!spaceUsed && performance.now() - spaceAt0 < 400 && canPlay()) togglePlay(); // a tap, not a hold
});

// Paste code onto the canvas: it becomes a code container at the pointer.
// A whole p5.js or three.js sketch runs as it is.
addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (pasteText(e.clipboardData?.getData('text/plain') ?? '', context())) e.preventDefault();
});
// Objects copied out (Copy, or Copy as JSON) come back at the pointer; code becomes a container.
function pasteText(code, c) {
  if (/^\s*\{/.test(code)) {
    let data = null;
    try { data = JSON.parse(code); } catch {}
    if (data?.underspace && Array.isArray(data.objects)) {
      const s = spaceAt(c.p[0], c.p[1], true), a = toSpace(s, c.p[0], c.p[1]), ids0 = new Set(data.objects.map((o) => o.id));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const o of data.objects) {
        if (ids0.has(o.space) || o.bind) continue;
        const pts = o.rect ? [[o.rect.cx - o.rect.w / 2, o.rect.cy - o.rect.h / 2], [o.rect.cx + o.rect.w / 2, o.rect.cy + o.rect.h / 2]] : (o.points ?? []).map((p) => [p[0] + (o.off?.[0] ?? 0), p[1] + (o.off?.[1] ?? 0)]);
        for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      }
      if (x0 === Infinity) return false;
      call('object.paste', { objects: data.objects, space: s.id, dx: round(a[0] - (x0 + x1) / 2), dy: round(a[1] - (y0 + y1) / 2) });
      return true;
    }
  }
  if (!code.trim() || !(sketchKind(code) || /\breturn\b|\/\/\s*(in|out|param)\s*:|=>|\bfunction\b/.test(code))) return false;
  const s = spaceAt(c.p[0], c.p[1], true), u = unitsPerPx(s), a = toSpace(s, c.p[0], c.p[1]);
  const size = sketchKind(code) ? [320, 240] : [170, 110];
  batch(() => {
    const id = call('shape.add', { space: s.id, role: 'code', code, rect: { cx: round(a[0]), cy: round(a[1]), w: round(size[0] * u), h: round(size[1] * u) } });
    call('select.set', { ids: [id] });
  });
  return true;
}

// ---- the door for agents ---------------------------------------------------
// The same registry, with the view added as commands that are not recorded.

define({ name: 'view.fit', doc: 'Show everything.', record: false, run: () => fit() });
define({ name: 'view.frame', doc: 'Show these objects; a single object is opened to its near face.', args: { ids: T.ids }, required: ['ids'], record: false, run: (a) => frameIds(a.ids, a.ids.length === 1 ? 0.82 : 0.6) });
define({ name: 'view.zoom', doc: 'Zoom by a factor about the middle of the view.', args: { factor: T.num }, required: ['factor'], record: false, run: (a) => view.zoomAt(...centre(), a.factor) });
define({ name: 'tool.set', doc: 'Choose the pointer tool.', args: { name: { enum: ['select', 'pan', 'draw', 'line', 'rect', 'ellipse', 'sculpt', 'note', 'code', 'target', 'score', 'event'] } }, required: ['name'], record: false, run: (a) => setTool(a.name) });
define({ name: 'space.read', doc: 'Read the document: every object with its role, space, rectangle, ports and code.', record: false, run: () => [...state.objects.values()].map((o) => ({ id: o.id, kind: o.kind, role: o.role, space: o.space, rect: o.rect, name: blanketOf(o)?.name, ins: blanketOf(o)?.ins, outs: blanketOf(o)?.outs, params: o.params, code: hasCode(o) ? o.code : undefined, bind: o.bind, points: o.points?.length })) });
define({ name: 'score.play', doc: 'Play a score on the transport, pass after pass. What is drawn or changed while it plays is heard from the next pass.', args: { id: T.id }, required: ['id'], record: false, run: (a) => { if (get(a.id)?.role !== 'score') return; if (scoreSet) scoreSet.add(a.id); if (!transport.playing) { lastBeat = transport.beat; transport.play(); } scoreTick(); } });
define({ name: 'play.toggle', doc: 'Start or stop playing: scores loop and travelers set off along their lines.', record: false, run: () => togglePlay() });
define({ name: 'score.stop', doc: 'Stop one score (the others play on), or pause everything when no id is given.', args: { id: T.id }, record: false, run: (a) => { if (!a.id) { if (transport.playing) togglePlay(); return; } scoreSet = new Set(scores().filter((o) => o.id !== a.id && scorePlaying(o)).map((o) => o.id)); sound.silence(a.id); scorePlan.delete(a.id); } });
define({ name: 'assistant.ask', doc: 'Ask the built-in assistant to build something from a sentence.', args: { text: T.str }, required: ['text'], record: false, run: (a) => ask(a.text) });

window.underspace = { call, batch, tools, commands: tools, state, take, undo, redo, view, ask, actions: ACTIONS, backend: view.backend };
// WebMCP, where the browser has it: every command is offered as a tool.
try {
  const mc = navigator.modelContext;
  if (mc?.registerTool) for (const t of tools()) mc.registerTool({ name: t.name.replace('.', '_'), description: t.description, inputSchema: t.inputSchema, execute: async (args) => ({ content: [{ type: 'text', text: JSON.stringify((await call(t.name, args, 'webmcp')) ?? null) }] }) });
} catch (e) { console.warn('webmcp:', e.message); }

// ---- keep the take between visits; ?demo builds a small example ------------

let saveTimer = 0;
onChange(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(take)); } catch {} }, 400); });

function demo() {
  const c = (name, args) => call(name, args, 'demo');
  batch(() => {
    c('space.clear');
    const r = c('patch.add', { at: [0, 1.4], nodes: [{ key: 'osc', preset: 'osc' }, { key: 'scale', preset: 'scale' }, { key: 'view', role: 'target' }], links: ['osc.y -> scale.x', 'scale.y -> view.spin'] });
    const curl = c('line.add', { points: Array.from({ length: 40 }, (_, i) => [round(-5.6 + i * 0.12), round(-2.6 + Math.sin(i * 0.4) * 0.7)]), role: 'path' });
    const from = portPos(get(curl), 'outs', 'y'), to = portPos(get(r.ids.view), 'ins', 'tilt');
    c('line.add', { points: Array.from({ length: 12 }, (_, i) => { const u = i / 11; return [round(from[0] + (to[0] - from[0]) * u), round(from[1] + (to[1] - from[1]) * u - Math.sin(u * Math.PI) * 0.4)]; }), tol: 0.05 });
    for (let k = 0; k < 3; k++) c('line.add', { space: r.ids.view, points: Array.from({ length: 30 }, (_, i) => [round(Math.cos(i * 0.3 + k * 2) * (1 + i * 0.08)), round(Math.sin(i * 0.3 + k * 2) * (1 + i * 0.08)), round(k - 1)]) });
    // a score: three lines in a frame, across is time and up is pitch
    c('shape.add', { role: 'score', rect: { cx: 0, cy: -7.2, w: 11, h: 4 } });
    for (let k = 0; k < 3; k++) c('line.add', { points: Array.from({ length: 24 }, (_, i) => [round(-5 + k * 0.8 + i * 0.36), round(-8.6 + k * 0.9 + Math.sin(i * 0.45 + k) * 0.7 + i * 0.04)]) });
    c('select.set', { ids: [] });
  });
  requestAnimationFrame(fit);
}

const query = new URLSearchParams(location.search);
if (query.has('demo')) demo();
else if (!query.has('new')) {
  try { const saved = JSON.parse(localStorage.getItem(STORE)); if (saved) loadTake(saved); } catch { localStorage.removeItem(STORE); }
}
setTool('select');
requestAnimationFrame(fit);
