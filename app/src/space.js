// State, the command registry and the take.
//
// The registry is the one door: the toolbar, keys, context menus, the palette,
// the assistant and outside agents all go through call(). A command that
// changes the document is recorded as a clip; undo is the take replayed
// without its last step.

import { ROLES, parseBlanket, blanketOf, ptsOf, isTarget } from './object.js';
import { bindFor, wirePoints } from './bind.js';
import { collapse, expand } from './collapse.js';
import { PRESETS } from './presets.js';
import { BRUSHES } from './brushes.js';

export const state = {
  objects: new Map(),   // id -> object, see object.js
  selection: new Set(),
  n: 0,                 // ids are counted, so a replay gives the same ids
  version: 0,
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---- registry ---------------------------------------------------------------

const commands = new Map();
// spec: { name, doc, args: JSON-schema properties, required?, record = true, run(args) }
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
  style: { type: 'object', description: '{ stroke, fill, width, opacity, path }: colours as CSS hex, null for the default', properties: { stroke: { type: ['string', 'null'] }, fill: { type: ['string', 'null'] }, width: { type: 'number' }, opacity: { type: 'number' }, path: { enum: ['smooth', 'straight', null], description: 'how a line is drawn through its points; smooth is the default' } } },
};
export { T as argTypes };

// A connector that loses a port becomes ink, where it was.
function unbind(w) {
  w.points = wirePoints(state.objects, w).map((p) => [round(p[0]), round(p[1])]);
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

define({
  name: 'line.add',
  doc: 'Draw a line. With tol > 0, a line whose ends land on an output and an input port becomes a connector. role "path" attaches code that reads the line.',
  args: { space: T.space, points: { type: 'array', description: '[[x, y], ...]; [x, y, z] inside a target' }, tol: T.num, role: { enum: ROLES.line }, closed: { type: 'boolean' }, style: T.style },
  required: ['points'],
  run(a) {
    const space = a.space ?? null;
    const o = { id: newId(), kind: 'line', role: 'ink', space, points: a.points.map((p) => p.slice(0, 3)), off: [0, 0] };
    if (a.closed) o.closed = true;
    if (a.style) o.style = { ...a.style };
    const b = a.tol > 0 && o.points.length > 1 ? bindFor(inSpace(space), o.points, a.tol) : null;
    if (b) bindInto(o, b);
    else if (a.role === 'path') { o.role = 'path'; o.code = PRESETS.path; o.params = {}; }
    state.objects.set(o.id, o);
    return o.id;
  },
});

define({
  name: 'shape.add',
  doc: 'Add a shape. role: "visual" (something to look at), "code" (a code container; give code, or a preset name), "target" (a render target with a 3D interior), "score" (a frame that plays the lines drawn in it; its code is a brush), "note" (text).',
  args: { space: T.space, rect: T.rect, shape: { enum: ['rect', 'ellipse'] }, role: { enum: ROLES.shape }, code: T.str, text: T.str, style: T.style, preset: { enum: [...Object.keys(PRESETS), ...Object.keys(BRUSHES)] } },
  required: ['rect'],
  run(a) {
    const o = { id: newId(), kind: 'shape', role: a.role ?? 'visual', shape: a.shape ?? 'rect', space: a.space ?? null, rect: { ...a.rect } };
    if (o.role === 'code') { o.code = a.code ?? PRESETS[a.preset] ?? PRESETS.blank; o.params = {}; }
    if (o.role === 'score') { o.code = a.code ?? BRUSHES[a.preset] ?? BRUSHES.glissando; o.params = {}; }
    if (o.role === 'note') o.text = a.text ?? '';
    if (a.style) o.style = { ...a.style };
    state.objects.set(o.id, o);
    return o.id;
  },
});

define({
  name: 'object.role',
  doc: 'Change what an object is. A line: "ink", "connector" (binds to the ports nearest its ends, within tol), "path". A shape: "visual", "target", "code", "score", "note".',
  args: { id: T.id, role: { enum: [...ROLES.line, ...ROLES.shape] }, tol: T.num },
  required: ['id', 'role'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || !ROLES[o.kind]?.includes(a.role)) return false;
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
    o.role = a.role;
    if (a.role === 'note') o.text ??= '';
    const fresh = { path: PRESETS.path, code: PRESETS.blank, score: BRUSHES.glissando }[a.role];
    if (fresh) { o.code = o.stash?.[a.role] ?? fresh; o.params ??= {}; } else delete o.code;
    prune(o);
    return true;
  },
});

define({
  name: 'object.code', doc: 'Set the code of a code container or a path. The header comments declare its ports and parameters.',
  args: { id: T.id, code: T.str }, required: ['id', 'code'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || !['code', 'path', 'score'].includes(o.role)) return false;
    o.code = a.code; o.params ??= {};
    parseBlanket(o.code);
    prune(o);
    return true;
  },
});

define({
  name: 'object.set', doc: 'Set a parameter of a code object.', args: { id: T.id, name: T.str, value: T.num }, required: ['id', 'name', 'value'],
  run(a) { const o = state.objects.get(a.id); if (o?.params) o.params[a.name] = a.value; },
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
  name: 'object.style', doc: 'Set how objects look. Only the given keys change; null puts a key back to its default.',
  args: { ids: T.ids, style: T.style }, required: ['ids', 'style'],
  run(a) {
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
  name: 'object.order', doc: 'Bring objects to the front or send them to the back of the drawing order.',
  args: { ids: T.ids, to: { enum: ['front', 'back'] } }, required: ['ids', 'to'],
  run(a) {
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
    for (const id of order) map.set(id, newId());
    const top = [];
    for (const id of order) {
      const c = structuredClone(state.objects.get(id));
      c.id = map.get(id);
      if (map.has(c.space)) c.space = map.get(c.space);
      else if (c.rect) { c.rect.cx += a.dx ?? 0; c.rect.cy += a.dy ?? 0; top.push(c.id); }
      else { if (!c.bind) top.push(c.id); c.off = [(c.off?.[0] ?? 0) + (a.dx ?? 0), (c.off?.[1] ?? 0) + (a.dy ?? 0)]; }
      if (c.bind) { c.bind.from.id = map.get(c.bind.from.id); c.bind.to.id = map.get(c.bind.to.id); }
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
  name: 'target.set', doc: 'Set how a render target is drawn into and seen. plane: the drawing plane ("view" faces the camera; "front", "top", "side"). az, el: the resting camera angle in radians.',
  args: { id: T.id, plane: { enum: ['view', 'front', 'top', 'side'] }, az: T.num, el: T.num }, required: ['id'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o || !isTarget(o)) return;
    if (a.plane) o.plane = a.plane;
    if (Number.isFinite(a.az)) o.az = a.az;
    if (Number.isFinite(a.el)) o.el = a.el;
  },
});

define({
  name: 'select.set', doc: 'Replace the selection.', args: { ids: T.ids }, required: ['ids'],
  run(a) { state.selection = new Set(a.ids.filter((id) => state.objects.has(id))); },
});

define({ name: 'space.clear', doc: 'Remove everything.', run: () => reset() });

// Run a command from inside another, without recording it separately.
export const exec = (name, args) => commands.get(name).run(args);

function reset() { state.objects.clear(); state.selection.clear(); state.n = 0; }

// ---- the take ---------------------------------------------------------------

export const take = { type: 'underspace-take', version: 1, clips: [], undone: [] };
const t0 = performance.now();
let batchId = 0, batchSeq = 0;

// call(name, args, by): the one way to do anything. `by` says who: 'human',
// 'assistant', an agent or model name.
export function call(name, args = {}, by = 'human') {
  const cmd = commands.get(name);
  if (!cmd) throw new Error(`unknown command: ${name}`);
  const result = cmd.run(args, by);
  if (cmd.record) {
    const clip = { t: +((performance.now() - t0) / 1000).toFixed(3), name, args: structuredClone(args), by };
    if (batchId) clip.batch = batchId;
    take.clips.push(clip);
    if (name !== 'select.set') take.undone.length = 0;
    changed();
  }
  return result;
}

// Everything called inside fn is one step for undo.
export function batch(fn) {
  if (batchId) return fn();
  batchId = Date.now() * 100 + (++batchSeq % 100);
  try { return fn(); } finally { batchId = 0; }
}

function changed() { state.version++; for (const fn of listeners) fn(); }

function rerun() {
  reset();
  for (const clip of take.clips) {
    try { commands.get(clip.name)?.run(structuredClone(clip.args), clip.by); } catch (e) { console.warn('take:', clip.name, e.message); }
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
