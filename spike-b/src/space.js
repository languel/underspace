// State, commands and the take. Every change goes through call(), which
// records it; undo is the take replayed without its last change.

import { parseBlanket, blanketOf } from './object.js';
import { bindFor, wirePoints } from './bind.js';
import { collapse, expand } from './collapse.js';

export const state = {
  objects: new Map(),   // id -> object, see object.js
  selection: new Set(),
  n: 0,                 // ids are counted, so a replay gives the same ids
  version: 0,
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const commands = new Map();
const define = (name, doc, run) => commands.set(name, { name, doc, run });
const newId = () => 'o' + (++state.n);
const inSpace = (space) => [...state.objects.values()].filter((o) => o.space === space);
const round = (v) => Math.round(v * 1e4) / 1e4;

// A wire that loses a port becomes a plain mark, where it was.
function unbind(w) {
  w.points = wirePoints(state.objects, w).map((p) => [round(p[0]), round(p[1])]);
  w.off = [0, 0];
  delete w.bind;
}

define('mark.add', 'Draw a mark. If its ends land on an output and an input port (within tol) it becomes a wire. args: { space, points: [[x, y], ...] ([x, y, z] inside a scene), tol }', (a) => {
  const space = a.space ?? null;
  const o = { id: newId(), kind: 'mark', space, points: a.points.map((p) => p.slice(0, 3)), off: [0, 0] };
  const b = a.tol > 0 && o.points.length > 1 ? bindFor(inSpace(space), o.points, a.tol) : null;
  if (b) {
    for (const w of inSpace(space)) if (w.bind && w.bind.to.id === b.bind.to.id && w.bind.to.port === b.bind.to.port) unbind(w);
    o.points = b.points; o.bind = b.bind;
  }
  state.objects.set(o.id, o);
  return o.id;
});

define('box.add', 'Add a box with code. args: { space, rect: { cx, cy, w, h }, code }', (a) => {
  const o = { id: newId(), kind: 'box', space: a.space ?? null, rect: { ...a.rect }, code: a.code, params: {} };
  state.objects.set(o.id, o);
  return o.id;
});

define('scene.add', 'Add a scene: an object whose interior is a 3D space. args: { space, rect }', (a) => {
  const o = { id: newId(), kind: 'scene', space: a.space ?? null, rect: { ...a.rect } };
  state.objects.set(o.id, o);
  return o.id;
});

define('object.code', 'Set an object\'s code. Attaches code to a plain mark. args: { id, code }', (a) => {
  const o = state.objects.get(a.id);
  if (!o || o.bind || (o.kind !== 'box' && o.kind !== 'mark')) return;
  o.code = a.code; o.params ??= {};
  const b = parseBlanket(o.code);
  for (const w of [...state.objects.values()]) {
    if (!w.bind) continue;
    if ((w.bind.from.id === o.id && !b.outs.includes(w.bind.from.port)) || (w.bind.to.id === o.id && !b.ins.includes(w.bind.to.port))) unbind(w);
  }
});

define('object.set', 'Set a parameter. args: { id, name, value }', (a) => {
  const o = state.objects.get(a.id);
  if (o?.params) o.params[a.name] = a.value;
});

define('object.move', 'Move objects within their space. args: { ids, dx, dy }', (a) => {
  for (const id of a.ids) {
    const o = state.objects.get(id);
    if (!o || o.bind) continue;
    if (o.rect) { o.rect.cx += a.dx; o.rect.cy += a.dy; }
    else o.off = [o.off[0] + a.dx, o.off[1] + a.dy];
  }
});

define('object.remove', 'Remove objects and what is inside them. args: { ids }', (a) => {
  const gone = new Set();
  const take = (id) => { if (gone.has(id) || !state.objects.has(id)) return; gone.add(id); for (const o of state.objects.values()) if (o.space === id) take(o.id); };
  a.ids.forEach(take);
  for (const w of state.objects.values()) {
    if (w.bind && !gone.has(w.id) && (gone.has(w.bind.from.id) || gone.has(w.bind.to.id))) unbind(w);
  }
  for (const id of gone) { state.objects.delete(id); state.selection.delete(id); }
});

define('group.collapse', 'Fold objects into one group; the wires that are cut become its ports. args: { ids }', (a) => {
  const g = collapse(state.objects, a.ids, 'o' + (state.n + 1));
  if (!g) return null;
  state.n++;
  state.selection = new Set([g.id]);
  return g.id;
});

define('group.expand', 'Open a group back into its contents. args: { id }', (a) => {
  const inside = inSpace(a.id).filter((o) => !o.bind).map((o) => o.id);
  if (expand(state.objects, a.id)) state.selection = new Set(inside);
});

define('select.set', 'Replace the selection. args: { ids }', (a) => {
  state.selection = new Set(a.ids.filter((id) => state.objects.has(id)));
});

define('space.clear', 'Remove everything.', () => reset());

function reset() { state.objects.clear(); state.selection.clear(); state.n = 0; }

// ---- the take ---------------------------------------------------------------

export const take = { type: 'underspace-take', version: 0, spike: 'b', clips: [] };
const t0 = performance.now();

// call(name, args, by): the one way to change anything.
export function call(name, args = {}, by = 'human') {
  const cmd = commands.get(name);
  if (!cmd) throw new Error(`unknown command: ${name}`);
  const result = cmd.run(args);
  take.clips.push({ t: +((performance.now() - t0) / 1000).toFixed(3), name, args: structuredClone(args), by });
  changed();
  return result;
}

function changed() { state.version++; for (const fn of listeners) fn(); }

function rerun() {
  reset();
  for (const clip of take.clips) {
    try { commands.get(clip.name)?.run(structuredClone(clip.args)); } catch (e) { console.warn('take:', clip.name, e.message); }
  }
  changed();
}

// Drops the last change (and any selection changes after it) and replays.
export function undo() {
  let clip;
  do { clip = take.clips.pop(); } while (clip && clip.name === 'select.set');
  rerun();
}

export function loadTake(json) {
  if (json?.type !== 'underspace-take' || !Array.isArray(json.clips)) throw new Error('not an underspace take');
  take.clips = json.clips;
  rerun();
}

export const listCommands = () => [...commands.values()].map(({ name, doc }) => ({ name, doc }));
export { blanketOf };
