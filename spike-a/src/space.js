// The space: marks, selection, reading, brush. Every change goes through a
// command, and every command is recorded in the take. Nothing mutates state
// any other way, so the take is a complete record of the session.

import { defaultReading } from './reading.js';
import { PRESETS } from './brushes.js';

export const state = {
  marks: new Map(),        // id -> { id, plane, points: [[x,y,z,t,p], ...] }
  selection: new Set(),
  reading: defaultReading(),
  brush: { preset: 'glissando', source: PRESETS.glissando },
  bpm: 90,
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what, detail) => { for (const fn of listeners) fn(what, detail); };

// ---- commands ---------------------------------------------------------------

const commands = new Map();
function define(name, doc, run) { commands.set(name, { name, doc, run }); }

define('mark.add', 'Add a mark. args: { id?, plane, points: [[x,y,z,t,p], ...] }', (a) => {
  const id = a.id ?? newId();
  const mark = { id, plane: a.plane ?? 'front', points: a.points.map((p) => p.slice(0, 5)) };
  state.marks.set(id, mark);
  emit('marks', { added: mark });
  return id;
});
define('mark.remove', 'Remove marks. args: { ids }', (a) => {
  for (const id of a.ids) { state.marks.delete(id); state.selection.delete(id); }
  emit('marks', { removed: a.ids });
});
define('select.set', 'Replace the selection. args: { ids }', (a) => {
  state.selection = new Set(a.ids.filter((id) => state.marks.has(id)));
  emit('selection');
});
define('reading.set', 'Change the reading. args: any of { time, pitch, beats, low, high, quant, grid, scale, root }', (a) => {
  Object.assign(state.reading, a);
  emit('reading');
});
define('brush.set', 'Replace the brush code. args: { source, preset? }', (a) => {
  state.brush = { preset: a.preset ?? 'custom', source: a.source };
  emit('brush');
});
define('context.set', 'Change shared musical context. args: { bpm }', (a) => {
  if (a.bpm) state.bpm = a.bpm;
  emit('context');
});
define('space.clear', 'Remove every mark.', () => {
  state.marks.clear(); state.selection.clear();
  emit('marks', { cleared: true }); emit('selection');
});
// Transport commands are defined by main.js (they need audio); they are
// registered through the same door so that they are recorded too.
export function defineCommand(name, doc, run) { define(name, doc, run); }

let seq = 0;
export const newId = () => 'm' + Date.now().toString(36) + (seq++).toString(36);

// ---- the take ---------------------------------------------------------------

export const take = newTake();
function newTake() {
  return { type: 'underspace-take', version: 0, created: new Date().toISOString(), clips: [] };
}
let takeStart = performance.now();
let recording = true;
export const now = () => (performance.now() - takeStart) / 1000;

// call(name, args, by): the one way to change anything.
// `by` says who did it: 'human', 'agent', or a model id.
export function call(name, args = {}, by = 'human') {
  const cmd = commands.get(name);
  if (!cmd) throw new Error(`unknown command: ${name}`);
  const result = cmd.run(args);
  if (recording) {
    const clip = { t: +now().toFixed(3), name, args: structuredClone(args), by };
    if (name === 'mark.add' && !args.id) clip.args.id = result;
    take.clips.push(clip);
    emit('take', clip);
  }
  return result;
}

export const listCommands = () => [...commands.values()].map(({ name, doc }) => ({ name, doc }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Replay a take from an empty space. `hooks.reveal(mark, seconds)` lets the
// view draw a stroke progressively; `hooks.stop()` silences audio first.
let replayToken = 0;
export async function replay(source = take, { speed = 1, maxGap = 1.2, hooks = {} } = {}) {
  const token = ++replayToken;
  const clips = structuredClone(source.clips);
  recording = false;
  try {
    hooks.stop?.();
    commands.get('space.clear').run({});
    Object.assign(state.reading, defaultReading());
    state.brush = { preset: 'glissando', source: PRESETS.glissando };
    state.bpm = 90;
    emit('reading'); emit('brush'); emit('context');
    let prev = 0;
    for (const clip of clips) {
      const gap = Math.min(maxGap, Math.max(0, clip.t - prev)) / speed;
      prev = clip.t;
      if (gap > 0.01) await sleep(gap * 1000);
      if (token !== replayToken) return false;
      const cmd = commands.get(clip.name);
      if (!cmd) continue;
      cmd.run(clip.args);
      if (clip.name === 'mark.add' && hooks.reveal) {
        const pts = clip.args.points;
        const drawn = Math.min(2, Math.max(0.08, pts[pts.length - 1][3] - pts[0][3])) / speed;
        await hooks.reveal(clip.args.id, drawn);
        prev += drawn * speed;
      }
    }
    return true;
  } finally {
    if (token === replayToken) recording = true;
  }
}
export const cancelReplay = () => { replayToken++; recording = true; };

export function loadTake(json) {
  if (json?.type !== 'underspace-take' || !Array.isArray(json.clips)) throw new Error('not an underspace take');
  take.clips = json.clips; take.created = json.created ?? take.created;
  takeStart = performance.now() - (json.clips.at(-1)?.t ?? 0) * 1000;
  emit('take');
}
