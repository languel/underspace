// quantize: put objects on the grid they lie in, in space, in time or in pitch. One command for
// the person (the context menu's Quantize ›), the palette and every agent.
//
// What the axes mean comes from where an object lies:
//   - in a score frame: across is time (the frame is `beats` long) and up is pitch (low..high, on
//     the score's scale, or the timeline's);
//   - in a grid frame, or on the canvas under the global grid: the lattice (cell / sub); time is
//     `beats` a cell along x when the grid times paths; pitch is `rows` scale degrees a cell up.
// what: "points" moves every control point of a line; "object" moves the whole object by how far
// its start (a line's first point, a shape's centre) is from where it should be, keeping its shape.
// Pure apart from the registry: the plan is worked out from the objects, then run as line.set and
// object.move inside this one command, so the take holds the quantize and replays it exactly.

import { state, define, exec, argTypes as T } from './space.js';
import { ptsOf, rectOf, blanketOf } from './object.js';
import { gridAt, snapPoint } from './grid.js';
import { degrees, scaleName, beatsOf } from './music.js';
import { SCALES as SCORE_SCALES, snapToScale } from './score.js';

const round = (v) => Math.round(v * 1e4) / 1e4;
const inRect = (r, p) => Math.abs(p[0] - r.cx) <= r.w / 2 + 1e-9 && Math.abs(p[1] - r.cy) <= r.h / 2 + 1e-9;

// The score frame holding p (the smallest), with its reading resolved.
function scoreAt(objects, space, p, music) {
  let best = null;
  for (const o of objects.values()) if (o.role === 'score' && o.kind === 'shape' && o.space === space && !o.hidden && inRect(o.rect, p) && (!best || o.rect.w * o.rect.h < best.rect.w * best.rect.h)) best = o;
  if (!best) return null;
  const p0 = {}; for (const q of blanketOf(best).params) p0[q.name] = best.params?.[q.name] ?? q.value;
  const scale = (p0.scale ?? -1) < 0 ? { steps: degrees(music.scale), root: music.root } : { steps: SCORE_SCALES[Math.round(p0.scale)] ?? null, root: 0 };
  return { frame: best, beats: Math.max(0.25, p0.beats ?? 8), low: p0.low > 0 ? p0.low : music.low, high: p0.high > 0 ? p0.high : music.high, ...scale };
}

// "1/16", "8n", "2 bars", "0.5": a length of time in beats. Numbers are beats.
function beatsFrom(v, music) {
  if (v == null || v === false) return 0;
  if (typeof v === 'number') return v > 0 ? v : 0;
  const s = String(v).trim(), frac = s.match(/^1\s*\/\s*(\d+)$/);
  if (frac) return 4 / Number(frac[1]); // a beat is a quarter note: 1/16 is a quarter of a beat
  const b = beatsOf(s, music);
  if (!(b > 0)) throw new Error(`time: "${v}" is not a length (give beats, or "1/16", "8n", "1 bar")`);
  return b;
}

// How one point moves. -> [x, y, ...rest]
function placer(objects, space, music, opts) {
  const time = beatsFrom(opts.time, music), pitch = opts.pitch;
  return (p) => {
    const sc = time || pitch ? scoreAt(objects, space, p, music) : null;
    if (sc) {
      const r = sc.frame.rect, left = r.cx - r.w / 2, bottom = r.cy - r.h / 2;
      let [x, y] = p;
      if (time) x = left + (Math.round((((x - left) / r.w) * sc.beats) / time) * time / sc.beats) * r.w;
      if (pitch) {
        const steps = pitch === true || pitch === 'scale' ? sc.steps : pitch === 'chromatic' ? SCORE_SCALES[1] : scaleName(pitch) ? degrees(scaleName(pitch)) : null;
        if (!steps) throw new Error(`pitch: "${pitch}" is not "scale", "chromatic" or a scale name`);
        const midi = sc.low + ((y - bottom) / r.h) * (sc.high - sc.low), m = Math.round(snapToScale(midi, steps, pitch === true || pitch === 'scale' ? sc.root : music.root) * 1e6) / 1e6;
        y = bottom + ((m - sc.low) / (sc.high - sc.low)) * r.h;
      }
      return [x, y, ...p.slice(2)];
    }
    const g = gridAt(objects, space, p, state.grid, (o) => { const q = {}; for (const b of blanketOf(o).params) q[b.name] = o.params?.[b.name] ?? b.value; return q; });
    if (time || pitch) {
      let [x, y] = p;
      if (time) { if (!(g.beats > 0)) throw new Error('time: this is not in a score frame, and its grid does not time paths (grid.set beats, or a grid frame with beats)'); const q = g.cell * (time / g.beats); x = g.origin[0] + Math.round((x - g.origin[0]) / q) * q; }
      if (pitch) { if (!(g.rows > 0)) throw new Error('pitch: this is not in a score frame, and its grid has no rows (grid.set rows, or a grid frame with rows)'); y = g.origin[1] + Math.round((y - g.origin[1]) / g.cell) * g.cell; }
      return [x, y, ...p.slice(2)];
    }
    const step = opts.step > 0 ? opts.step : g.cell / Math.max(1, g.sub);
    return opts.step > 0 ? [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step, ...p.slice(2)] : snapPoint(p, g);
  };
}

// Drop repeated points and points on straight runs (as the Snap › tidy action does). -> indices kept
function tidy(pts) {
  let keep = pts.map((_, i) => i).filter((i, n, a) => n === 0 || pts[i][0] !== pts[a[n - 1]][0] || pts[i][1] !== pts[a[n - 1]][1]);
  keep = keep.filter((i, n) => { if (n === 0 || n === keep.length - 1) return true; const a = pts[keep[n - 1]], b = pts[i], c = pts[keep[n + 1]]; return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-9; });
  return keep.length < 2 ? [0, pts.length - 1] : keep;
}

// The plan: [{ name, args }] that quantize the objects, and what was left alone and why.
export function quantizePlan(objects, ids, opts = {}, music = state.music) {
  const calls = [], skipped = [];
  for (const id of ids) {
    const o = objects.get(id);
    if (!o) continue;
    if (o.bind || o.locked || o.kind === 'joint' || o.role === 'traveler') { skipped.push(`${id}: ${o.bind ? 'a connector' : o.locked ? 'locked' : o.kind === 'joint' ? 'a joint (it follows its lines)' : 'a traveler (it follows its line)'}`); continue; }
    const space = o.space ?? null, place = placer(objects, space, music, opts);
    if (o.kind === 'line' && !o.code && (opts.what ?? 'points') === 'points') {
      const pts = ptsOf(o);
      if ((pts[0]?.length ?? 2) > 2 && (opts.time || opts.pitch)) { skipped.push(`${id}: a line in 3D has no time or pitch`); continue; }
      let at = pts.map((p) => place(p).map(round));
      let keep = at.map((_, i) => i);
      if (opts.tidy) { keep = tidy(at); at = keep.map((i) => at[i]); }
      if (at.every((p, i) => p[0] === pts[keep[i]][0] && p[1] === pts[keep[i]][1])) continue;
      calls.push({ name: 'line.set', args: { id, points: at, ...(o.pen?.length === pts.length ? { pen: keep.map((i) => o.pen[i]) } : {}) } });
      continue;
    }
    // the whole object, by its start: a line's first point, a shape's or a point's centre
    const r = o.kind === 'line' ? null : rectOf(o), from = o.kind === 'line' ? ptsOf(o)[0] : [r.cx, r.cy];
    if (!from) continue;
    const to = place(from), dx = round(to[0] - from[0]), dy = round(to[1] - from[1]);
    if (dx || dy) calls.push({ name: 'object.move', args: { ids: [id], dx, dy } });
  }
  return { calls, skipped };
}

define({
  name: 'quantize',
  doc: 'Put objects on the grid they lie in. ids: the objects (the selection when left out). With nothing else, every control point of a line goes to the nearest grid point, and a shape or a point moves so its centre does (the grid frame it lies in, else the global grid: grid.set). time: a length ("1/16", "8n", "1 bar", or beats) to snap to along time: in a score frame, across is time; elsewhere the grid must time paths (its beats). pitch: "scale" (the score\'s or the timeline\'s), "chromatic" or a scale name: in a score frame, up is pitch; elsewhere the grid must have rows. what: "points" (each control point, the default for lines) or "object" (the whole object moves by how far its start is off, keeping its shape: a note that starts on the beat). step: a lattice of your own, in canvas units, instead of the grid. tidy: also drop repeated points and points on straight runs. Returns how many objects moved and what was left alone.',
  args: { ids: T.ids, time: { type: ['string', 'number'] }, pitch: { type: ['string', 'boolean'] }, what: { enum: ['points', 'object'] }, step: T.num, tidy: { type: 'boolean' } },
  run(a) {
    const ids = a.ids?.length ? a.ids : [...state.selection];
    if (!ids.length) throw new Error('nothing to quantize: give ids, or select something');
    a.ids = ids; // the take records which, so a replay does not depend on the selection
    const { calls, skipped } = quantizePlan(state.objects, ids, a);
    for (const c of calls) exec(c.name, c.args);
    return { moved: calls.length, ...(skipped.length ? { skipped } : {}) };
  },
  hold: (a) => a.ids ?? [],
});
