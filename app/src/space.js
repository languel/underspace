// State, the command registry and the take.
//
// The registry is the one door: the toolbar, keys, context menus, the palette,
// the assistant and outside agents all go through call(). A command that
// changes the document is recorded as a clip; undo is the take replayed
// without its last step.

import { ROLES, parseBlanket, blanketOf, ptsOf, isTarget, along, smooth, TARGET_CODE } from './object.js';
import { EVENT } from './play.js';
import { bindFor, drawnWire } from './bind.js';
import { collapse, expand } from './collapse.js';
import { PRESETS } from './presets.js';
import { camera, flatCamera } from './framing.js';
import { BRUSHES } from './brushes.js';
import { BRUSHES as INK, syncBrushes } from './ink/brushes.js';
import { spec, apply, applyRect } from './transform.js';
import { settle, JUNCTION, isCurve, curveOf, measure, atU } from './joints.js';
import { DEFAULT_MUSIC, scaleName, scaleNames } from './music.js';
import { DEFAULT_GRID, GRID, GRID_KEYS } from './grid.js';
import { INSTRUMENTS } from './instruments.js';
import { SYNTH_PARTS, LINE_PARTS, SHAPE_PARTS, READYMADES, instrumentId, formulaOf, formulaPoints, formula } from './synth.js';

export const state = {
  objects: new Map(),   // id -> object, see object.js
  music: { ...DEFAULT_MUSIC }, // the context everything is heard in (music.js)
  grid: { ...DEFAULT_GRID },
  brushes: {},                 // ink brushes written in this drawing: id -> source (ink/brushes.js)
  sculpts: {},                 // sculpt tools written in this drawing: id -> source (ink/sculpt.js)   // the global grid: how space, time and pitch are quantized (grid.js)
  clips: new Map(),     // id -> a recorded clip: { id, name, at (beats), notes: [{ beat, midi, vel, len }] }
  selection: new Set(),
  n: 0,                 // ids are counted, so a replay gives the same ids
  version: 0,
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---- registry ---------------------------------------------------------------

const commands = new Map();
// spec: { name, doc, args: JSON-schema properties, required?, record = true, run(args), hold?(args) }
// hold: the ids a command has put somewhere; when constraints are solved after it, they stay and the rest gives way (default: its ids or id).
export function define(spec) { commands.set(spec.name, { record: true, args: {}, ...spec }); }

export const newId = () => 'o' + (++state.n);
export const inSpace = (space) => [...state.objects.values()].filter((o) => o.space === space);
const round = (v) => Math.round(v * 1e4) / 1e4;
const T = {
  id: { type: 'string', description: 'object id' },
  ids: { type: 'array', items: { type: 'string' }, description: 'object ids' },
  space: { type: ['string', 'null'], description: 'id of the group or target to work in; null or omitted for the canvas' },
  rect: { type: 'object', description: '{ cx, cy, w, h } in the space\'s units (y up)', properties: { cx: { type: 'number' }, cy: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
  num: { type: 'number' }, str: { type: 'string' },
  brush: { type: 'object', description: '{ id, params }: an ink brush. ids: ' + Object.keys(INK).join(', '), properties: { id: { type: ['string', 'null'] }, params: { type: 'object' } } },
  style: { type: 'object', description: '{ stroke, fill, width, opacity, path }: colours as CSS hex, null for the default', properties: { stroke: { type: ['string', 'null'] }, fill: { type: ['string', 'null'] }, width: { type: 'number' }, opacity: { type: 'number' }, path: { enum: ['smooth', 'straight', null], description: 'how a line is drawn through its points; smooth is the default' } } },
};
export { T as argTypes };

// A connector that loses a port becomes ink, where it was.
function unbind(w) {
  w.points = drawnWire(state.objects, w).map((p) => [round(p[0]), round(p[1])]);
  w.off = [0, 0]; w.role = 'ink';
  delete w.bind;
}
// After an object's blanket changes, connectors on ports that are gone let go.
function prune(o) {
  const b = blanketOf(o);
  for (const w of [...state.objects.values()]) {
    if (!w.bind) continue;
    if ((w.bind.from.id === o.id && !b?.outs.includes(w.bind.from.port)) || (w.bind.to.id === o.id && !b?.ins.includes(w.bind.to.port))) unbind(w);
  }
}
// An input takes one connector: a new one replaces the old.
function bindInto(o, b) {
  for (const w of inSpace(o.space)) if (w !== o && w.bind && w.bind.to.id === b.bind.to.id && w.bind.to.port === b.bind.to.port) unbind(w);
  o.points = b.points; o.off = [0, 0]; o.bind = b.bind; o.role = 'connector';
}

// The points of a line as given to a command: [[x, y], ...] (z too in a target). A point written as
// text ("[0, 1]": some models do) is read; no points, or a point that is not numbers, is refused, so a
// line that cannot be drawn is not kept and the caller is told.
function cleanPoints(points) {
  if (typeof points === 'string') { try { points = JSON.parse(points); } catch { /* refused below */ } }
  if (!Array.isArray(points) || !points.length) throw new Error('points must be a list of points, like [[0, 0], [4, 2]] (got ' + JSON.stringify(points ?? null).slice(0, 80) + ')');
  return points.map((p) => {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { /* refused below */ } }
    if (!Array.isArray(p) || p.length < 2 || !p.slice(0, 3).every(Number.isFinite)) throw new Error('each point is [x, y] in numbers, like [[0, 0], [4, 2]] (got ' + JSON.stringify(p).slice(0, 60) + ')');
    return p.slice(0, 3);
  });
}

define({
  name: 'line.add',
  doc: 'Draw a line. With tol > 0, a line whose ends land on an output and an input port becomes a connector. role "path" attaches code that reads the line.',
  args: { space: T.space, points: { type: 'array', description: '[[x, y], ...]; [x, y, z] inside a target' }, tol: T.num, role: { enum: ROLES.line.filter((r) => r !== 'traveler') }, closed: { type: 'boolean' }, style: T.style, brush: T.brush, pen: { type: 'array', description: '[[ms, pressure 0..1], ...], one per point: the hand that drew it' } },
  required: ['points'],
  run(a) {
    const space = a.space ?? null;
    const o = { id: newId(), kind: 'line', role: 'ink', space, points: cleanPoints(a.points), off: [0, 0] };
    if (a.closed) o.closed = true;
    if (a.style) o.style = { ...a.style };
    if (a.brush?.id && INK[a.brush.id]) o.brush = { id: a.brush.id, params: { ...a.brush.params } };
    if (Array.isArray(a.pen) && a.pen.length === o.points.length) o.pen = a.pen.map((q) => [q[0], q[1]]);
    const b = a.tol > 0 && o.points.length > 1 ? bindFor(inSpace(space), o.points, a.tol) : null;
    if (b) bindInto(o, b);
    else if (a.role === 'path') { o.role = 'path'; o.code = PRESETS.path; o.params = {}; }
    state.objects.set(o.id, o);
    return o.id;
  },
});

define({
  name: 'shape.add',
  doc: 'Add a shape. role: "visual" (something to look at), "code" (a code container; give code, or a preset name), "target" (a render target with a 3D interior), "score" (a frame that plays the lines drawn in it; its code is a brush), "grid" (a frame whose parameters quantize space, time and pitch inside it), "event", "note" (text on the canvas, not a musical note: a note that sounds is an event, see code.help). A traveler is not made here: traveler.add puts one on a line.',
  args: { space: T.space, rect: T.rect, shape: { enum: ['rect', 'ellipse'] }, role: { enum: ROLES.shape.filter((r) => r !== 'traveler') }, code: T.str, text: T.str, style: T.style, brush: T.brush, preset: { enum: [...Object.keys(PRESETS), ...Object.keys(BRUSHES)] } },
  required: ['rect'],
  run(a) {
    const o = { id: newId(), kind: 'shape', role: a.role ?? 'visual', shape: a.shape ?? 'rect', space: a.space ?? null, rect: { ...a.rect } };
    if (o.role === 'code') { o.code = a.code ?? PRESETS[a.preset] ?? PRESETS.blank; o.params = {}; }
    if (o.role === 'score') { o.code = a.code ?? BRUSHES[a.preset] ?? BRUSHES.glissando; o.params = {}; }
    if (o.role === 'note') o.text = a.text ?? '';
    if (o.role === 'event') { o.code = a.code ?? EVENT; o.params = {}; }
    if (o.role === 'grid') { o.code = a.code ?? GRID; o.params = {}; }
    if (o.role === 'target') { o.code = a.code ?? TARGET_CODE; o.params = {}; }
    if (o.role === 'traveler') return null; // a traveler needs a line: traveler.add
    if (a.style) o.style = { ...a.style };
    if (a.brush?.id && INK[a.brush.id]) o.brush = { id: a.brush.id, params: { ...a.brush.params } };
    state.objects.set(o.id, o);
    return o.id;
  },
});

define({
  name: 'traveler.add', doc: 'Put a traveler on a line: a shape that moves along it while playing. u is where it starts (0..1). Its parameters: dur (beats for the whole line, default 8; 0: its time comes from the grid its line is in), loop (0 once, 1 loop, 2 there and back). More with object.set: at (the beat it sets off on), speed (grid cells a beat, in place of dur), drawn (above 0: at the pace the line was drawn), drives (0: a signal that node logic can stop). Null when `on` is not a line.',
  args: { on: { type: 'string', description: 'id of the line to travel' }, u: T.num, size: T.num, dur: T.num, loop: T.num }, required: ['on'],
  run(a) {
    const line = state.objects.get(a.on);
    if (!line || line.kind !== 'line' || line.bind) return null;
    const u = Math.max(0, Math.min(1, a.u ?? 0)), pts = ptsOf(line), at = along(line.style?.path === 'straight' ? pts : smooth(pts), u), size = a.size > 0 ? a.size : 0.5;
    const o = { id: newId(), kind: 'shape', role: 'traveler', shape: 'ellipse', space: line.space, on: line.id, rect: { cx: round(at[0]), cy: round(at[1]), w: size, h: size }, params: { start: round(u) } };
    if (Number.isFinite(a.dur) && a.dur >= 0) o.params.dur = a.dur; // 0: its time comes from the grid
    if (Number.isFinite(a.loop)) o.params.loop = a.loop;
    state.objects.set(o.id, o);
    return o.id;
  },
});

define({
  name: 'traveler.attach', doc: 'Make a line or shape a traveler on a line, starting at u (0..1), or put a traveler on another line. Its own shape is kept: it is what travels.',
  args: { id: T.id, on: { type: 'string' }, u: T.num }, required: ['id', 'on'],
  run(a) {
    const o = state.objects.get(a.id), line = state.objects.get(a.on);
    if (!o || o.id === a.on || !line || line.kind !== 'line' || line.bind || line.role === 'traveler' || line.space !== o.space) return false;
    if (o.role !== 'traveler') {
      if (o.kind === 'group' || o.bind || ['target', 'code', 'score', 'note'].includes(o.role)) return false;
      if (o.code != null) { (o.stash ??= {})[o.role] = o.code; delete o.code; }
      if (o.kind === 'shape' && o.role === 'visual') o.keeps = true; // it keeps looking as it did
      o.role = 'traveler';
      for (const j of [...state.objects.values()]) if (j.kind === 'joint' && j.at.some((q) => q.id === o.id)) dropPlaces(j, new Set([o.id])); // a traveler is not held anywhere
    }
    o.on = line.id; o.params = { ...o.params, start: Math.max(0, Math.min(1, a.u ?? 0)) };
    return true;
  },
});

// ---- joints (joints.js) -----------------------------------------------------

const place = { type: 'object', description: '{ id, u, slide? }: a point on a line, u how far along it (0..1); slide lets it move along that line', properties: { id: { type: 'string' }, u: { type: 'number' }, slide: { type: 'boolean' } } };
// A joint loses the places on lines that are gone; with fewer than two (and no pin) it goes.
function dropPlaces(j, gone) {
  j.at = j.at.filter((q) => !gone.has(q.id));
  if (j.at.length < (j.fix || j.node ? 1 : 2)) { state.objects.delete(j.id); state.selection.delete(j.id); }
}
define({
  name: 'joint.add',
  doc: 'Join lines where they touch: the places given are held together from now on, and moving one line carries the others (each keeps its drawn shape). The first place is the one that comes to the others. With into, the places join an existing joint. With fix and one place, a pin: that place stays at pos. A joint is also a junction: its code says which way a traveler goes on.',
  args: { at: { type: 'array', items: place }, into: T.id, fix: { type: 'boolean' }, node: { type: 'boolean', description: 'one place, no constraint: a node on a line (travelers passing run its code)' }, glyph: { type: 'string' }, pos: { type: 'array', items: { type: 'number' } }, code: T.str }, required: ['at'],
  hold: (a) => (a.into ? [a.into] : a.fix ? [] : a.at.slice(1).map((q) => q.id)),
  run(a) {
    const ok = (a.at ?? []).filter((q) => isCurve(state.objects.get(q.id)) && Number.isFinite(q.u));
    const clean = (q) => ({ id: q.id, u: Math.max(0, Math.min(1, round(q.u))), ...(q.slide ? { slide: true } : {}) });
    if (a.into) {
      const j = state.objects.get(a.into);
      if (j?.kind !== 'joint') return null;
      for (const q of ok) if (state.objects.get(q.id).space === j.space && !j.at.some((p) => p.id === q.id)) j.at.push(clean(q));
      return j.id;
    }
    if (!ok.length || (!a.fix && !a.node && new Set(ok.map((q) => q.id)).size < 2)) return null;
    const space = state.objects.get(ok[0].id).space;
    if (ok.some((q) => state.objects.get(q.id).space !== space)) return null;
    const first = state.objects.get(ok[0].id), m = measure(curveOf(first, ptsOf(first))), at = atU(m, ok[0].u);
    const pos = (Array.isArray(a.pos) && a.pos.length >= 2 ? a.pos : at.slice(0, first.points[0].length > 2 ? 3 : 2)).map(round);
    const j = { id: newId(), kind: 'joint', role: 'junction', space, at: (a.fix ? ok.slice(0, 1) : ok).map(clean), pos, rect: { cx: pos[0], cy: pos[1], w: 0, h: 0 }, code: a.code ?? JUNCTION, params: {} };
    if (a.fix) j.fix = true;
    if (a.node && ok.length === 1) j.node = true;
    if (a.glyph) j.glyph = a.glyph;
    state.objects.set(j.id, j);
    return j.id;
  },
});

define({
  name: 'point.add', doc: 'Put a point: a mark with a glyph (dot, ring, plus, or a Midinous kind: note, cc, gate, led, counter, switch, terminator, anchor), `size` across, in canvas units. role "event": a traveler passing within it fires it.',
  args: { space: T.space, at: { type: 'array', items: { type: 'number' } }, glyph: { type: 'string' }, size: T.num, role: { enum: ['ink', 'event'] }, style: T.style }, required: ['at'],
  run(a) {
    const size = a.size > 0 ? a.size : 0.4, o = { id: newId(), kind: 'point', role: 'ink', space: a.space ?? null, glyph: a.glyph ?? 'dot', rect: { cx: round(a.at[0]), cy: round(a.at[1]), w: size, h: size } };
    if (Number.isFinite(a.at[2])) o.z = round(a.at[2]); // a point in a render target
    if (a.style) o.style = { ...a.style };
    if (a.role === 'event') { o.role = 'event'; o.code = EVENT; o.params = {}; }
    state.objects.set(o.id, o);
    return o.id;
  },
});
define({
  name: 'object.glyph', doc: 'How points and joints look: a glyph (dot, ring, plus, note, cc, gate, led, counter, switch, terminator, anchor). With code, a joint also gets that code (a Midinous node of that kind).',
  args: { ids: T.ids, glyph: { type: 'string' }, code: T.str }, required: ['ids', 'glyph'],
  run(a) {
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o || (o.kind !== 'point' && o.kind !== 'joint')) continue;
      o.glyph = a.glyph;
      if (a.code && o.kind === 'joint') o.code = a.code;
    }
  },
});

define({
  name: 'joint.slide', doc: 'Move a node (a joint on one line) along its line, to u (0..1).',
  args: { id: T.id, u: T.num }, required: ['id', 'u'], hold: () => [],
  run(a) { const j = state.objects.get(a.id); if (j?.kind !== 'joint' || j.at.length !== 1) return false; j.at[0].u = Math.max(0, Math.min(1, round(a.u))); return true; },
});

const verts = { type: 'array', description: '[[x, y, z], ...]' }, faces = { type: 'array', description: '[[i, j, k, ...], ...]: indices of verts, three or more' };
const cleanMesh = (o, a) => {
  if (Array.isArray(a.verts)) o.verts = a.verts.map((p) => [round(p[0]), round(p[1]), round(p[2] ?? 0)]);
  if (Array.isArray(a.faces)) o.faces = a.faces.map((f) => f.filter((i) => Number.isInteger(i) && i >= 0 && i < o.verts.length)).filter((f) => new Set(f).size >= 3);
};
define({
  name: 'mesh.add', doc: 'Make a mesh in a render target (what Poly Build makes): verts, and faces as lists of their indices.',
  args: { space: T.space, verts, faces, style: T.style }, required: ['space', 'verts'],
  run(a) {
    const o = { id: newId(), kind: 'mesh', role: 'visual', space: a.space ?? null, verts: [], faces: [] };
    cleanMesh(o, { verts: a.verts, faces: a.faces ?? [] });
    if (a.style) o.style = { ...a.style };
    state.objects.set(o.id, o);
    return o.id;
  },
});
// A brush is put among the brushes as it is defined (not later, by the view): the next command may draw with it.
define({
  name: 'brush.define', doc: 'Write an ink brush, or change one written here. code is JavaScript that calls brush({ id, label, doc, roles: ["line"] or ["plane"], params: { name: [min, max, default, doc] }, draw(ctx, e, p, k) { } }) with the same id.',
  args: { id: { type: 'string' }, code: { type: 'string' } }, required: ['id', 'code'],
  run(a) { if (!/^[a-z][\w-]*$/i.test(a.id) || !a.code.trim()) return false; state.brushes = { ...state.brushes, [a.id]: a.code }; syncBrushes(state.brushes); return a.id; },
});
define({
  name: 'brush.remove', doc: 'Remove an ink brush written in this drawing. Marks drawn with it go back to plain lines.', args: { id: { type: 'string' } }, required: ['id'],
  run(a) {
    if (!(a.id in state.brushes)) return false;
    const { [a.id]: _, ...rest } = state.brushes; state.brushes = rest; syncBrushes(state.brushes);
    for (const o of state.objects.values()) if (o.brush?.id === a.id) delete o.brush;
    return true;
  },
});
define({
  name: 'sculpt.define', doc: 'Write a sculpt tool, or change one written here. code is JavaScript that calls sculpt({ id, label, doc, refine, params: { name: [min, max, default, doc] }, step(pts, s, p, k) { return pts } }) with the same id.',
  args: { id: { type: 'string' }, code: { type: 'string' } }, required: ['id', 'code'],
  run(a) { if (!/^[a-z][\w-]*$/i.test(a.id) || !a.code.trim()) return false; state.sculpts = { ...state.sculpts, [a.id]: a.code }; return a.id; },
});
define({
  name: 'sculpt.remove', doc: 'Remove a sculpt tool written in this drawing.', args: { id: { type: 'string' } }, required: ['id'],
  run(a) { if (!(a.id in state.sculpts)) return false; const { [a.id]: _, ...rest } = state.sculpts; state.sculpts = rest; return true; },
});

define({
  name: 'mesh.set', doc: 'Give a mesh new verts, or new faces, or both (a Poly Build step).',
  args: { id: T.id, verts, faces }, required: ['id'],
  run(a) { const o = state.objects.get(a.id); if (o?.kind !== 'mesh') return false; cleanMesh(o, { verts: a.verts ?? o.verts, faces: a.faces ?? o.faces }); return true; },
});

define({
  name: 'joint.free', doc: 'Let lines go: remove the joints and pins that hold them, and their own rules (keep).',
  args: { ids: T.ids }, required: ['ids'], hold: (a) => a.ids,
  run(a) {
    const ids = new Set(a.ids);
    for (const o of [...state.objects.values()]) {
      if (o.kind === 'joint' && (ids.has(o.id) || o.at.some((q) => ids.has(q.id)))) { if (ids.has(o.id)) { state.objects.delete(o.id); state.selection.delete(o.id); } else dropPlaces(o, ids); }
      if (ids.has(o.id) && o.keep) delete o.keep;
    }
  },
});

define({
  name: 'line.keep', doc: 'Give lines rules they keep from now on: horv (the chord from end to end stays level or plumb, whichever it is nearer), length (the chord stays this long; true keeps the length it has). false removes a rule.',
  args: { ids: T.ids, horv: { type: 'boolean' }, length: { type: ['number', 'boolean'] } }, required: ['ids'], hold: () => [],
  run(a) {
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!isCurve(o)) continue;
      const k = { ...o.keep };
      if (a.horv === true) k.horv = true; else if (a.horv === false) delete k.horv;
      if (a.length === false) delete k.length;
      else if (a.length != null) { const p = ptsOf(o), e = p[p.length - 1]; k.length = a.length === true ? round(Math.hypot(e[0] - p[0][0], e[1] - p[0][1], (e[2] ?? 0) - (p[0][2] ?? 0))) : a.length; }
      if (Object.keys(k).length) o.keep = k; else delete o.keep;
    }
  },
});

define({
  name: 'object.paste', doc: 'Add objects copied out as JSON (Copy as JSON), with new ids, into a space, moved by dx, dy. Returns the new ids of the outermost ones.',
  args: { objects: { type: 'array' }, space: { type: ['string', 'null'] }, dx: T.num, dy: T.num }, required: ['objects'],
  run(a) {
    const space = a.space && state.objects.has(a.space) ? a.space : null, map = new Map();
    const list = a.objects.filter((o) => o && typeof o.id === 'string' && (o.kind === 'line' || o.kind === 'shape' || o.kind === 'group' || (o.kind === 'joint' && Array.isArray(o.at))));
    for (const o of list) map.set(o.id, newId());
    const top = [];
    for (const src of list) {
      const c = structuredClone(src);
      c.id = map.get(src.id);
      if (map.has(c.space)) c.space = map.get(c.space);
      else {
        c.space = space;
        if (c.rect) { c.rect.cx += a.dx ?? 0; c.rect.cy += a.dy ?? 0; } else c.off = [(c.off?.[0] ?? 0) + (a.dx ?? 0), (c.off?.[1] ?? 0) + (a.dy ?? 0)];
        if (!c.bind) top.push(c.id);
      }
      if (c.on) { if (!map.has(c.on)) continue; c.on = map.get(c.on); }
      if (c.kind === 'joint') { if (!c.at.every((q) => map.has(q.id))) continue; c.at = c.at.map((q) => ({ ...q, id: map.get(q.id) })); if (top.at(-1) === c.id) top.pop(); }
      if (c.bind) { if (!map.has(c.bind.from.id) || !map.has(c.bind.to.id)) continue; c.bind = { from: { ...c.bind.from, id: map.get(c.bind.from.id) }, to: { ...c.bind.to, id: map.get(c.bind.to.id) } }; }
      if (c.kind === 'group') for (const side of ['ins', 'outs']) for (const p of c.ports?.[side] ?? []) if (p.inner && map.has(p.inner.id)) p.inner.id = map.get(p.inner.id);
      state.objects.set(c.id, c);
    }
    state.selection = new Set(top);
    return top;
  },
});

define({
  name: 'object.role',
  doc: 'Change what an object is, keeping its shape. A line: "ink", "connector" (binds to the ports nearest its ends, within tol), "path" (code that reads the line), "event" (a traveler crossing it fires it). A shape: "visual", "target", "code", "score", "grid", "note", "event". ("traveler" only for what traveler.attach put on a line.) False when the role is not one its kind can take.',
  args: { id: T.id, role: { enum: [...ROLES.line, ...ROLES.shape] }, tol: T.num },
  required: ['id', 'role'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || !ROLES[o.kind]?.includes(a.role) || (a.role === 'traveler' && !o.on)) return false;
    if (a.role === 'connector') {
      if (o.bind) return true;
      const b = bindFor(inSpace(o.space).filter((x) => x !== o), ptsOf(o), a.tol ?? 0.8);
      if (!b) return false;
      bindInto(o, b);
      return true;
    }
    if (o.bind) unbind(o);
    // Each role keeps its own code, so changing role and back loses nothing.
    if (o.code != null) (o.stash ??= {})[o.role] = o.code;
    // A visual made an event (or a traveler) keeps looking as it did.
    if (o.kind === 'shape' && o.role === 'visual' && (a.role === 'event' || a.role === 'traveler')) o.keeps = true;
    if (a.role === 'visual') delete o.keeps;
    o.role = a.role;
    if (a.role === 'note') o.text ??= '';
    const fresh = { path: PRESETS.path, code: PRESETS.blank, score: BRUSHES.glissando, event: EVENT, junction: JUNCTION, grid: GRID, target: TARGET_CODE }[a.role];
    if (fresh) { o.code = o.stash?.[a.role] ?? fresh; o.params ??= {}; } else delete o.code;
    prune(o);
    return true;
  },
});

define({
  name: 'synth.make',
  doc: 'Make an object a part of a synth you draw, keeping its shape. A line: "osc" (its curve is one cycle of the wave), "partials" (its height across is the strength of each harmonic), "env" (its curve is a level over time), "shaper" (its curve maps what comes in to what goes out). A shape: "filter", "amp", "mix", "noise", "out" (the instrument: its channel parameter is the MIDI channel it plays). Wire parts with connectors from an out port to an in port (line.add with tol, ends on the two ports). code.help { role: "synth" } says more.',
  args: { id: T.id, kind: { enum: Object.keys(SYNTH_PARTS) }, preset: { type: 'string', description: 'a readymade shape for a line part, instead of the drawing: osc ' + Object.keys(READYMADES.osc).join(', ') + '; partials ' + Object.keys(READYMADES.partials).join(', ') + '; env ' + Object.keys(READYMADES.env).join(', ') + '; shaper ' + Object.keys(READYMADES.shaper).join(', ') + '. The line is redrawn to show it.' } }, required: ['id', 'kind'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || o.bind) return false;
    const ok = o.kind === 'line' ? LINE_PARTS.includes(a.kind) : o.kind === 'shape' ? SHAPE_PARTS.includes(a.kind) : false;
    if (!ok) throw new Error(`a ${o.kind} cannot be a ${a.kind}: a line is one of ${LINE_PARTS.join(', ')}; a shape one of ${SHAPE_PARTS.join(', ')}`);
    if (o.code != null && o.role !== 'synth') (o.stash ??= {})[o.role] = o.code;
    const body = a.preset != null ? READYMADES[a.kind]?.[a.preset] : null;
    if (a.preset != null && body == null) throw new Error(`no ${a.kind} readymade "${a.preset}" (one of ${Object.keys(READYMADES[a.kind] ?? {}).join(', ') || 'none: only lines have them'})`);
    o.role = 'synth'; o.code = SYNTH_PARTS[a.kind] + (body ? '\n' + body : ''); o.params ??= {};
    if (a.kind === 'out') o.publish ??= ['channel', 'gain']; // an instrument's face: what it plays and how loud (publish.js)
    if (body && o.kind === 'line') { o.points = formulaPoints(o, body); o.off = [0, 0]; delete o.pen; }
    prune(o);
    return true;
  },
});

define({
  name: 'object.code', doc: 'Set the code of an object that has code: a code container, a path, a score (its brush), an event, a joint (a junction), a grid frame or a render target. The header comments declare its ports and parameters. code.help says what each kind of code is given and returns. False when the object has no code (give it a role first: object.role).',
  args: { id: T.id, code: T.str }, required: ['id', 'code'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || !['code', 'path', 'score', 'event', 'junction', 'grid', 'target', 'synth'].includes(o.role)) return false;
    if (typeof a.code !== 'string') throw new Error('code must be a string of JavaScript');
    if (o.role === 'synth' && o.kind === 'line' && formulaOf({ code: a.code })) { // a formula: checked, and drawn
      const body = formulaOf({ code: a.code });
      try { formula(body)(0.5); } catch (e) { throw new Error(`this formula does not work: ${e.message}. It is the body of a function of x (0 to 1) that returns a height, e.g. return sin(2 * PI * x);`); }
      o.code = a.code; o.points = formulaPoints(o, body); o.off = [0, 0]; delete o.pen;
    }
    o.code = a.code; o.params ??= {};
    parseBlanket(o.code);
    prune(o);
    return true;
  },
});

define({
  name: 'object.set', doc: 'Set a parameter of an object: one its code declares (// param: name value), or a traveler\'s (start, dur, loop, at, speed, drawn, drives). False when the object has no parameters.', args: { id: T.id, name: T.str, value: T.num }, required: ['id', 'name', 'value'],
  run(a) { const o = state.objects.get(a.id); if (!o?.params) return false; o.params[a.name] = a.value; return true; },
});

define({
  name: 'object.move', doc: 'Move objects within their space.', args: { ids: T.ids, dx: T.num, dy: T.num }, required: ['ids', 'dx', 'dy'],
  run(a) {
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o || o.bind) continue;
      if (o.rect) { o.rect.cx += a.dx; o.rect.cy += a.dy; }
      else o.off = [o.off[0] + a.dx, o.off[1] + a.dy];
    }
  },
});

define({
  name: 'object.resize', doc: 'Give a shape or group a new rectangle.', args: { id: T.id, rect: T.rect }, required: ['id', 'rect'],
  run(a) { const o = state.objects.get(a.id); if (o?.rect) o.rect = { cx: a.rect.cx, cy: a.rect.cy, w: Math.max(0.05, a.rect.w), h: Math.max(0.05, a.rect.h) }; },
});

define({
  name: 'object.transform',
  doc: 'Move, rotate or scale objects about a pivot, as G, R and S do: p\' = pivot + R(axis, angle) * S * (p - pivot) + d. angle in degrees. On the canvas lines turn about z; a shape\'s centre moves and its size scales (a quarter turn swaps width and height). Lines inside a render target turn about axis ("x", "y", "z" or [x, y, z]).',
  args: { ids: T.ids, pivot: { type: 'array', items: { type: 'number' } }, dx: T.num, dy: T.num, dz: T.num, angle: T.num, axis: { type: ['string', 'array'] }, sx: T.num, sy: T.num, sz: T.num }, required: ['ids'],
  run(a) {
    const t = spec(a);
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o || o.bind || o.role === 'traveler') continue;
      if (o.rect) { const r = applyRect(t, o.rect); for (const k in r) r[k] = Math.round(r[k] * 1e4) / 1e4; o.rect = r; }
      else if (o.points) { o.points = ptsOf(o).map((p) => apply(t, p).map((v) => Math.round(v * 1e4) / 1e4)); o.off = [0, 0]; }
      else if (o.verts) o.verts = o.verts.map((p) => apply(t, p).map((v) => Math.round(v * 1e4) / 1e4));
    }
  },
});

define({
  name: 'object.style', doc: 'Set how objects look. Only the given keys change; null puts a key back to its default. A line\'s colour is its stroke: { "stroke": "#ff0000" }; fill colours the inside of a closed line or a shape. Colours are CSS strings.',
  args: { ids: T.ids, style: T.style }, required: ['ids', 'style'],
  run(a) {
    // a look that cannot be drawn is refused, not kept: a colour is a string, a width and an opacity numbers
    for (const [k, v] of Object.entries(a.style ?? {})) {
      if (v == null || v === '') continue;
      if ((k === 'stroke' || k === 'fill') && typeof v !== 'string') throw new Error(`style.${k} must be a colour as a string, like "#ff0000" (got ${JSON.stringify(v)})`);
      if ((k === 'width' || k === 'opacity') && !Number.isFinite(v)) throw new Error(`style.${k} must be a number (got ${JSON.stringify(v)})`);
    }
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o) continue;
      const next = { ...o.style };
      for (const [k, v] of Object.entries(a.style)) { if (v == null || v === '') delete next[k]; else next[k] = v; }
      if (Object.keys(next).length) o.style = next; else delete o.style;
    }
  },
});

define({
  name: 'line.set', doc: 'Replace a line\'s points (what a sculpt stroke does). pen, when given, has one [ms, pressure] per point.',
  args: { id: T.id, points: { type: 'array' }, pen: { type: 'array' }, closed: { type: 'boolean', description: 'close or open the line (left as it is when not given)' } }, required: ['id', 'points'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || o.kind !== 'line' || o.bind) return false;
    const pts = cleanPoints(a.points);
    if (pts.length < 2) return false;
    o.points = pts; o.off = [0, 0];
    if (a.closed === true) o.closed = true; else if (a.closed === false) delete o.closed;
    if (Array.isArray(a.pen) && a.pen.length === o.points.length) o.pen = a.pen.map((q) => [q[0], q[1]]); else delete o.pen;
    return true;
  },
});

define({
  name: 'object.brush', doc: 'Draw lines or visual shapes with an ink brush. id null goes back to a plain line. params are merged into the brush\'s own.',
  args: { ids: T.ids, id: { type: ['string', 'null'], description: 'brush id, or null' }, params: { type: 'object' } }, required: ['ids'],
  run(a) {
    for (const oid of a.ids) {
      const o = state.objects.get(oid);
      if (!o || o.bind || o.kind === 'group') continue;
      if (a.id === null) { delete o.brush; continue; }
      const id = a.id ?? o.brush?.id;
      if (!INK[id]) continue;
      o.brush = { id, params: { ...(id === o.brush?.id ? o.brush.params : {}), ...a.params } };
    }
  },
});

define({
  name: 'object.name', doc: 'Name an object. An empty name removes it.', args: { id: T.id, name: T.str }, required: ['id', 'name'],
  run(a) { const o = state.objects.get(a.id); if (!o) return; if (a.name) o.name = a.name; else delete o.name; },
});

define({
  name: 'object.text', doc: 'Set the text of a note.', args: { id: T.id, text: T.str }, required: ['id', 'text'],
  run(a) { const o = state.objects.get(a.id); if (o?.role === 'note') o.text = a.text; },
});

define({
  name: 'object.flag', doc: 'Hide or lock objects. A hidden object is not drawn; a locked one cannot be picked on the canvas.',
  args: { ids: T.ids, hidden: { type: 'boolean' }, locked: { type: 'boolean' } }, required: ['ids'],
  run(a) {
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o) continue;
      for (const k of ['hidden', 'locked']) if (k in a) { if (a[k]) o[k] = true; else delete o[k]; }
      if (o.hidden || o.locked) state.selection.delete(id);
    }
  },
});

define({
  name: 'object.order', doc: 'Bring objects to the front, one step forward, one step backward, or to the back of the drawing order.',
  args: { ids: T.ids, to: { enum: ['front', 'forward', 'backward', 'back'] } }, required: ['ids', 'to'],
  run(a) {
    if (a.to === 'forward' || a.to === 'backward') {
      // each one changes place with its neighbour in the same space
      const list = [...state.objects], sel = new Set(a.ids), up = a.to === 'forward';
      for (let n = 0; n < list.length; n++) {
        const i = up ? list.length - 1 - n : n;
        if (!sel.has(list[i][0])) continue;
        let j = i + (up ? 1 : -1);
        while (j >= 0 && j < list.length && list[j][1].space !== list[i][1].space) j += up ? 1 : -1;
        if (j < 0 || j >= list.length || sel.has(list[j][0])) continue;
        const [it] = list.splice(i, 1); list.splice(j, 0, it);
      }
      state.objects.clear();
      for (const [id, o] of list) state.objects.set(id, o);
      return;
    }
    const moved = a.ids.filter((id) => state.objects.has(id)).map((id) => [id, state.objects.get(id)]);
    const rest = [...state.objects].filter(([id]) => !a.ids.includes(id));
    state.objects.clear();
    for (const [id, o] of a.to === 'front' ? [...rest, ...moved] : [...moved, ...rest]) state.objects.set(id, o);
  },
});

define({
  name: 'object.copy', doc: 'Duplicate objects, with what is inside them and the connectors between them, offset by dx, dy. Returns the new ids.',
  args: { ids: T.ids, dx: T.num, dy: T.num }, required: ['ids'],
  run(a) {
    const map = new Map(), order = [];
    const add = (id) => { if (map.has(id) || !state.objects.has(id)) return; map.set(id, null); order.push(id); for (const o of [...state.objects.values()]) if (o.space === id) add(o.id); };
    for (const id of a.ids) if (!state.objects.get(id)?.bind) add(id);
    for (const w of state.objects.values()) if (w.bind && !map.has(w.id) && map.has(w.bind.from.id) && map.has(w.bind.to.id)) { map.set(w.id, null); order.push(w.id); }
    for (const j of state.objects.values()) if (j.kind === 'joint' && !map.has(j.id) && j.at.every((q) => map.has(q.id))) { map.set(j.id, null); order.push(j.id); }
    for (const id of order) map.set(id, newId());
    const top = [];
    for (const id of order) {
      const c = structuredClone(state.objects.get(id));
      c.id = map.get(id);
      if (map.has(c.space)) c.space = map.get(c.space);
      else if (c.rect) { c.rect.cx += a.dx ?? 0; c.rect.cy += a.dy ?? 0; top.push(c.id); }
      else { if (!c.bind) top.push(c.id); c.off = [(c.off?.[0] ?? 0) + (a.dx ?? 0), (c.off?.[1] ?? 0) + (a.dy ?? 0)]; }
      if (c.bind) { c.bind.from.id = map.get(c.bind.from.id); c.bind.to.id = map.get(c.bind.to.id); }
      if (c.on && map.has(c.on)) c.on = map.get(c.on);
      if (c.kind === 'joint') { c.at = c.at.map((q) => ({ ...q, id: map.get(q.id) })); if (top.includes(c.id)) top.splice(top.indexOf(c.id), 1); }
      for (const side of ['ins', 'outs']) for (const p of c.ports?.[side] ?? []) p.inner.id = map.get(p.inner.id) ?? p.inner.id;
      state.objects.set(c.id, c);
    }
    state.selection = new Set(top);
    return top;
  },
});

define({
  name: 'object.remove', doc: 'Remove objects and what is inside them.', args: { ids: T.ids }, required: ['ids'],
  run(a) {
    const gone = new Set();
    const take = (id) => { if (gone.has(id) || !state.objects.has(id)) return; gone.add(id); for (const o of state.objects.values()) if (o.space === id) take(o.id); };
    a.ids.forEach(take);
    for (const o of state.objects.values()) if (o.role === 'traveler' && gone.has(o.on)) gone.add(o.id); // a traveler goes with its line
    for (const j of [...state.objects.values()]) if (j.kind === 'joint' && !gone.has(j.id) && j.at.some((q) => gone.has(q.id))) dropPlaces(j, gone);
    for (const w of state.objects.values()) {
      if (w.bind && !gone.has(w.id) && (gone.has(w.bind.from.id) || gone.has(w.bind.to.id))) unbind(w);
    }
    for (const id of gone) { state.objects.delete(id); state.selection.delete(id); }
  },
});

define({
  name: 'group.collapse', doc: 'Fold objects into one group; the connectors that are cut become its ports.', args: { ids: T.ids, name: T.str }, required: ['ids'],
  run(a) {
    const g = collapse(state.objects, a.ids, 'o' + (state.n + 1));
    if (!g) return null;
    state.n++;
    if (a.name) g.name = a.name;
    state.selection = new Set([g.id]);
    return g.id;
  },
});

define({
  name: 'group.expand', doc: 'Open a group back into its contents.', args: { id: T.id }, required: ['id'],
  run(a) {
    const inside = inSpace(a.id).filter((o) => !o.bind).map((o) => o.id);
    if (expand(state.objects, a.id)) state.selection = new Set(inside);
  },
});

define({
  name: 'target.set', doc: 'Set how a render target is drawn into and seen. plane: the drawing plane ("view" faces the camera; "front", "top", "side"). anchor: what the plane passes through ("origin", the 3D "cursor", or the nearest "stroke"). cursor: the 3D cursor [x, y, z]. az, el, dist, center: the resting camera (angles in radians, distance, the point it looks at).',
  args: { id: T.id, plane: { enum: ['view', 'front', 'top', 'side'] }, anchor: { enum: ['origin', 'cursor', 'stroke'] }, cursor: { type: 'array' }, az: T.num, el: T.num, dist: T.num, center: { type: 'array' } }, required: ['id'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || !isTarget(o)) return;
    if (a.plane) o.plane = a.plane;
    if (Number.isFinite(a.az)) o.az = a.az;
    if (Number.isFinite(a.el)) o.el = a.el;
    if (a.anchor) o.anchor = a.anchor;
    if (a.dist > 0) o.dist = a.dist;
    for (const k of ['cursor', 'center']) if (Array.isArray(a[k]) && a[k].length === 3 && a[k].every(Number.isFinite)) o[k] = a[k].slice();
  },
});

// How wide a target's 3D scene is, in its own units, across the longer side of its frame
// (its camera starts 13 away, with a 12-unit floor).
export const TARGET_SPAN = 8;
define({
  name: 'target.take', doc: 'Put lines into a render target\'s 3D scene, on its front plane where they lie in its frame (as drawing a target over marks does). view: true also sets its camera straight in front, so the 3D view is the flat drawing (only when the scene held nothing before). With out: true, back onto the canvas, projected through the target\'s camera so they land where they showed, as lines (a mesh\'s faces become closed lines). Joints and travelers on them go with them.',
  args: { id: T.id, ids: T.ids, out: { type: 'boolean' }, view: { type: 'boolean' } }, required: ['id', 'ids'], hold: () => [],
  run(a) {
    const t = state.objects.get(a.id);
    if (!t || !isTarget(t)) return [];
    const r = t.rect, k = TARGET_SPAN / Math.max(r.w, r.h), moved = new Set(), had = inSpace(t.id).some((o) => !o.bind);
    const cam = camera({ az: t.az ?? 0.5, el: t.el ?? 0.3, dist: t.dist ?? 13, center: t.center ?? [0, 0, 0] }, r.w / r.h);
    const down = (p) => { const q = cam([p[0], p[1], p[2] ?? 0]); return q ? [round(r.cx + q[0] * r.w / 2), round(r.cy + q[1] * r.h / 2)] : null; };
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (a.out && o?.kind === 'mesh' && o.space === t.id) { // a mesh has no flat form: its faces, outlined
        for (const f of o.faces) {
          const pts = f.map((i) => down(o.verts[i])).filter(Boolean);
          if (pts.length < 3) continue;
          const n = newId();
          state.objects.set(n, { id: n, kind: 'line', role: 'ink', space: t.space, points: pts, off: [0, 0], closed: true, ...(o.style ? { style: { ...o.style } } : {}) });
          moved.add(n);
        }
        state.objects.delete(id); state.selection.delete(id);
        continue;
      }
      if (!isCurve(o) && !(o?.kind === 'line' && o.role === 'traveler')) continue;
      if (!a.out && o.space === t.space) { o.points = ptsOf(o).map((p) => [round((p[0] - r.cx) * k), round((p[1] - r.cy) * k), 0]); o.space = t.id; }
      else if (a.out && o.space === t.id) {
        const flat = ptsOf(o).map(down);
        if (flat.some((p) => !p) && flat.filter(Boolean).length < 2) continue; // behind the camera
        o.points = flat.filter(Boolean); o.space = t.space;
      }
      else continue;
      o.off = [0, 0]; delete o.brush; // brushes paint the flat canvas only
      moved.add(id);
    }
    for (const o of state.objects.values()) {
      if ((o.kind === 'joint' && o.at.every((q) => moved.has(q.id))) || (o.role === 'traveler' && moved.has(o.on))) o.space = a.out ? t.space : t.id;
    }
    if (a.view && !a.out && !had && moved.size) Object.assign(t, flatCamera(r, TARGET_SPAN), { plane: 'view' });
    return [...moved];
  },
});

// A target taken away and what it held kept: everything in its scene is projected onto the
// canvas, through its camera, and then only the frame goes.
define({
  name: 'target.dissolve', doc: 'Remove a render target but keep what is in it: lines (and a mesh\'s faces, as closed lines) are projected through its camera onto the canvas, where they showed.',
  args: { id: T.id }, required: ['id'], hold: () => [],
  run(a) {
    const t = state.objects.get(a.id);
    if (!t || !isTarget(t)) return [];
    const inside = inSpace(t.id).filter((o) => !o.bind && o.kind !== 'joint').map((o) => o.id);
    const kept = commands.get('target.take').run({ id: a.id, ids: inside, out: true });
    commands.get('object.remove').run({ ids: [a.id] });
    state.selection = new Set((kept ?? []).filter((id) => state.objects.has(id)));
    return kept ?? [];
  },
});

define({
  name: 'select.set', doc: 'Replace the selection.', args: { ids: T.ids }, required: ['ids'],
  run(a) { state.selection = new Set(a.ids.filter((id) => state.objects.has(id))); },
});

define({ name: 'space.clear', doc: 'Remove everything.', run: () => reset() });

// ---- music: the context, and recorded clips (music.js) -------------------------

define({
  name: 'music.set', doc: 'Set the musical context everything plays in: bpm, meter [beats in a bar, note value], scale (one of the names below, or a list of steps in semitones from the root, fractions allowed), root (a MIDI note), low and high (the range that heights and places 0..1 map to), channels ({ 1..16: instrument }; instruments: ' + INSTRUMENTS.join(', ') + '; channel 10 is drums by default: note 36 kick, 38 snare, 42 and 46 hats). Scales: ' + scaleNames().join(', ') + '.',
  args: { bpm: T.num, meter: { type: 'array', items: { type: 'number' } }, scale: { type: ['string', 'array'] }, root: T.num, low: T.num, high: T.num, channels: { type: 'object' } },
  run(a) {
    // what cannot be meant is refused, not passed over: a wrong name would read as done
    if (typeof a.scale === 'string' && !scaleName(a.scale)) throw new Error(`no scale named "${a.scale}" (one of ${scaleNames().join(', ')}; or give its steps as a list)`);
    for (const [c, inst] of Object.entries(a.channels && typeof a.channels === 'object' ? a.channels : {})) {
      if (!(+c >= 1 && +c <= 16)) throw new Error(`channels: ${c} is not a channel (1 to 16)`);
      if (!INSTRUMENTS.includes(inst) && !instrumentId(state.objects, inst)) throw new Error(`no instrument "${inst}" (one of ${INSTRUMENTS.join(', ')}, or the id or name of a drawn synth's out part)`);
    }
    const m = state.music;
    if (a.bpm > 0) m.bpm = Math.min(400, Math.max(10, a.bpm));
    if (Array.isArray(a.meter) && a.meter[0] > 0 && a.meter[1] > 0) m.meter = [Math.round(a.meter[0]), Math.round(a.meter[1])];
    if (Array.isArray(a.scale) && a.scale.length) m.scale = a.scale.map(Number).filter(Number.isFinite);
    else if (typeof a.scale === 'string' && scaleName(a.scale)) m.scale = scaleName(a.scale);
    for (const k of ['root', 'low', 'high']) if (Number.isFinite(a[k])) m[k] = Math.max(0, Math.min(127, a[k]));
    if (a.channels && typeof a.channels === 'object') { m.channels = { ...m.channels }; for (const [c, inst] of Object.entries(a.channels)) if (+c >= 1 && +c <= 16 && (INSTRUMENTS.includes(inst) || instrumentId(state.objects, inst))) m.channels[+c] = inst; }
  },
});
define({
  name: 'grid.set', doc: 'Set the global grid (grid frames override it inside them): cell (canvas units), sub (snap points a cell), beats (beats a cell of path; 0: travelers keep their own dur), metric (0 along a path, 1 at right angles, 2 across only), bars (round path times to this many beats; 0 off), rows (scale degrees a cell up; 0: continuous pitch), snap (1: drawing snaps).',
  args: Object.fromEntries(GRID_KEYS.map((k) => [k, T.num])),
  run(a) { for (const k of GRID_KEYS) if (Number.isFinite(a[k])) state.grid[k] = k === 'cell' ? Math.max(0.01, a[k]) : k === 'sub' ? Math.max(1, Math.round(a[k])) : Math.max(0, a[k]); },
});
define({
  name: 'clip.add', doc: 'Add a clip of notes to the timeline (what recording makes). at: where it starts, in beats; each note { beat (from the clip\'s start), midi, vel, len (beats) }.',
  args: { notes: { type: 'array' }, at: T.num, name: T.str }, required: ['notes'],
  run(a) {
    const notes = (a.notes ?? []).filter((n) => Number.isFinite(n.beat) && Number.isFinite(n.midi)).map((n) => ({ beat: round(n.beat), midi: round(n.midi), vel: Math.round(n.vel ?? 100), len: round(n.len ?? 0.25), ...(n.ch > 1 ? { ch: Math.min(16, Math.round(n.ch)) } : {}) }));
    if (!notes.length) return null;
    const id = 'c' + (++state.n);
    state.clips.set(id, { id, name: a.name ?? `take ${state.clips.size + 1}`, at: round(a.at ?? 0), notes });
    return id;
  },
});
define({
  name: 'clip.set', doc: 'Move a clip (at, in beats), rename it, mute it, give it new notes (what the piano roll does), or remove it (remove: true).',
  args: { id: T.id, at: T.num, name: T.str, muted: { type: 'boolean' }, notes: { type: 'array' }, remove: { type: 'boolean' } }, required: ['id'],
  run(a) {
    const c = state.clips.get(a.id);
    if (!c) return false;
    if (a.remove) { state.clips.delete(a.id); return true; }
    if (Number.isFinite(a.at)) c.at = round(Math.max(0, a.at));
    if (a.name) c.name = a.name;
    if (a.muted === true) c.muted = true; else if (a.muted === false) delete c.muted;
    if (Array.isArray(a.notes)) c.notes = a.notes.filter((n) => Number.isFinite(n.beat) && Number.isFinite(n.midi)).map((n) => ({ beat: round(Math.max(0, n.beat)), midi: round(n.midi), vel: Math.round(n.vel ?? 100), len: round(Math.max(1 / 64, n.len ?? 0.25)), ...(n.ch > 1 ? { ch: Math.min(16, Math.round(n.ch)) } : {}) }));
    return true;
  },
});

// Run a command from inside another, without recording it separately.
export const exec = (name, args) => commands.get(name).run(args);

function reset() { state.objects.clear(); state.selection.clear(); state.n = 0; state.music = { ...DEFAULT_MUSIC }; state.grid = { ...DEFAULT_GRID }; state.sculpts = {}; state.brushes = {}; syncBrushes({}); state.clips.clear(); }

// ---- the take ---------------------------------------------------------------

export const take = { type: 'underspace-take', version: 1, clips: [], undone: [] };
const t0 = performance.now();
let batchId = 0, batchSeq = 0;

// How long solving constraints took (the debug display reads it).
export const stats = { settleMs: 0, settles: 0 };

// A command, then the constraints it may have broken are solved again, in the
// same way on every replay, so a take gives the same drawing.
function runCmd(cmd, args, by) {
  const result = cmd.run(args, by);
  if (cmd.record && cmd.name !== 'select.set') {
    const hold = cmd.hold ? cmd.hold(args) : args.ids ?? (args.id ? [args.id] : []);
    const t0 = performance.now();
    settle(state.objects, new Set(hold), ptsOf);
    stats.settleMs = performance.now() - t0; stats.settles++;
  }
  return result;
}

// call(name, args, by): the one way to do anything. `by` says who: 'human',
// 'assistant', an agent or model name.
export function call(name, args = {}, by = 'human') {
  const cmd = commands.get(name) ?? commands.get(String(name).replace('_', '.')); // "line_add": the name an agent's tool list gives it
  if (!cmd) throw new Error(`unknown command: ${name}`);
  name = cmd.name;
  for (const fn of callers) fn(name, by);
  const result = runCmd(cmd, args, by);
  if (cmd.record) {
    const clip = { t: +((performance.now() - t0) / 1000).toFixed(3), name, args: structuredClone(args), by };
    if (batchId) clip.batch = batchId;
    take.clips.push(clip);
    if (name !== 'select.set') take.undone.length = 0;
    changed();
  }
  return result;
}

// Who is calling: told of every call (the agent port shows who is at work).
const callers = new Set();
export const onCall = (fn) => { callers.add(fn); return () => callers.delete(fn); };

// Everything called inside fn is one step for undo.
export function batch(fn) {
  if (batchId) return fn();
  batchId = Date.now() * 100 + (++batchSeq % 100);
  try { return fn(); } finally { batchId = 0; }
}

// A step of undo that stays open across calls, for a drag (a number dragged with Cmd): beginStep() ... endStep().
export function beginStep() { if (!batchId) { batchId = Date.now() * 100 + (++batchSeq % 100); heldStep = true; } }
export function endStep() { if (heldStep) { batchId = 0; heldStep = false; } }
let heldStep = false;

function changed() { state.version++; for (const fn of listeners) fn(); }

function rerun() {
  reset();
  for (const clip of take.clips) {
    // Only what a take can hold is run from one: the commands that change the drawing. A take that
    // names another (setting.set, action.run, user.ask: none is ever recorded) was written by hand,
    // and opening a file must not be able to change this browser's settings or act on the page.
    try { const cmd = commands.get(clip.name); if (cmd?.record) runCmd(cmd, structuredClone(clip.args), clip.by); else console.warn('take: not a recorded command, left out:', clip.name); } catch (e) { console.warn('take:', clip.name, e.message); }
  }
  changed();
}

// A step is one command or one batch; selection changes ride along with it.
function popStep(from) {
  const step = [];
  while (from.length && from[from.length - 1].name === 'select.set') step.unshift(from.pop());
  const last = from.pop();
  if (!last) return step;
  step.unshift(last);
  while (last.batch && from.length && from[from.length - 1].batch === last.batch) step.unshift(from.pop());
  return step;
}
export function undo() {
  const step = popStep(take.clips);
  if (!step.length) return;
  take.undone.push(step);
  rerun();
}
export function redo() {
  const step = take.undone.pop();
  if (!step) return;
  take.clips.push(...step);
  rerun();
}

// ---- the take as a history to move through (the timeline's "making" lane) ----------

// The take's clips as steps, oldest first: what one undo takes away (a command,
// or a batch, with the selection changes that ride along).
function groupSteps(clips) {
  const out = [];
  let cur = null;
  for (const c of clips) {
    const sel = c.name === 'select.set';
    if (!cur || (!sel && cur.main && !(c.batch && c.batch === cur.main.batch))) { cur = { clips: [], main: null }; out.push(cur); }
    cur.clips.push(c);
    if (!sel && !cur.main) cur.main = c;
  }
  return out.map((st) => st.clips);
}
// Every step, done and undone, in the order they were made; `done` of them are in effect.
// drew: how long the hand took to draw a stroke the step added (seconds), else 0.
export function history() {
  const done = groupSteps(take.clips), all = [...done, ...take.undone.slice().reverse()];
  return { done: done.length, steps: all.map((clips) => { const main = clips.find((c) => c.name !== 'select.set') ?? clips[0]; const pen = main.args?.pen; return { t: clips[0].t, name: main.name, by: main.by, size: clips.length, drew: Array.isArray(pen) && pen.length > 1 ? Math.max(0, (pen[pen.length - 1][0] - pen[0][0]) / 1000) : 0 }; }) };
}
// Go to just after step k: the steps after it are undone (redo brings them back), one rerun.
export function travel(k) {
  const done = groupSteps(take.clips), all = [...done, ...take.undone.slice().reverse()];
  k = Math.max(0, Math.min(all.length, Math.round(k)));
  if (k === done.length) return;
  take.clips = all.slice(0, k).flat();
  take.undone = all.slice(k).reverse();
  rerun();
}

export function loadTake(json) {
  if (json?.type !== 'underspace-take' || !Array.isArray(json.clips)) throw new Error('not an underspace take');
  take.clips = json.clips; take.undone = [];
  rerun();
}

// The commands as tools, for an assistant or an agent outside the page.
export const tools = () => [...commands.values()].map((c) => ({
  name: c.name, description: c.doc, recorded: c.record,
  inputSchema: { type: 'object', properties: c.args, required: c.required ?? [] },
}));
