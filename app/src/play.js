// Paths, travelers and events (after IanniX, by way of Artist Model Studio).
//   path      any line: geometry with a length
//   traveler  a shape that moves along a line over time
//   event     a shape that reacts when a traveler enters it; its code says how
// One rule: a traveler entering an event fires it. Pure apart from the hooks.
//
// Any line or shape can be a traveler or an event, keeping its own shape: a
// shape event fires when a traveler enters it, a closed line when a traveler
// enters what it encloses, an open line when a traveler crosses it.
// A traveler on a line with joints (joints.js) runs through the network:
// at each junction it reaches, the junction's code chooses its way on.

import { along, smooth, rectOf } from './object.js';
import { measure, atS, tangentS, jointsOn, waysAt } from './joints.js';

// An event's code runs when a traveler enters it:
//   ev    { x, y (where on the path's bounds, 0..1, y up), u (how far along), speed, traveler, rider, count }
//         and what it can do to the traveler: reflect(), stop(), go(), split(), speed(k)
//   p     the declared parameters;  mem  an object that persists
//   note(midi, velocity, seconds) plays a note
export const EVENT = `// event
// out: gate count
// param: low 48
// param: high 84
// param: dur 0.3
note(p.low + ev.y * (p.high - p.low), 100, p.dur);`;

// How far along (0..1) a traveler is at time t. loop: 0 once, 1 loop, 2 there and back.
export function progress(t, { dur = 4, loop = 1, start = 0 } = {}) {
  const raw = t / Math.max(0.05, dur) + start;
  if (loop === 0) return Math.max(0, Math.min(1, raw));
  if (loop === 2) { const m = ((raw % 2) + 2) % 2; return m <= 1 ? m : 2 - m; }
  return ((raw % 1) + 1) % 1;
}

export function inside(o, r, x, y) {
  const dx = (x - r.cx) / (r.w / 2), dy = (y - r.cy) / (r.h / 2);
  return o.shape === 'ellipse' ? dx * dx + dy * dy <= 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

// The nearest place on a path to a point, as how far along it is (0..1).
export function nearestU(points, x, y, samples = 240) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i <= samples; i++) { const q = along(points, i / samples), d = Math.hypot(q[0] - x, q[1] - y); if (d < bestD) { bestD = d; best = i / samples; } }
  return best;
}

// Is (x, y) inside a closed flat curve? (even-odd)
function enclosed(path, x, y) {
  let c = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i], b = path[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// Does the step p -> q cross the flat curve?
function crosses(path, p, q) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den, w = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
    if (t > 1e-6 && t <= 1 + 1e-6 && w >= 0 && w <= 1) return true; // a step that starts on the curve has not crossed it
  }
  return false;
}
const isClosed = (o, path) => o.closed || (path.length > 3 && Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) < 1e-6);

// Event presets: what an event does when a traveler reaches it. Besides
// note(), its code can change the traveler: ev.reflect(), ev.stop(),
// ev.split() (a copy goes back the way it came), ev.speed(k), ev.go().
export const EVENTS = {
  note: EVENT,
  reflect: `// reflect
// out: gate count
// it sends the traveler back the way it came
ev.reflect();`,
  split: `// split
// out: gate count
// the traveler goes on, and a copy of it goes back
ev.split();`,
  stop: `// stop
// out: gate count
ev.stop();`,
  speed: `// speed
// out: gate count
// param: by 0.5
ev.speed(p.by);`,
  'note and reflect': `// note and reflect
// out: gate count
// param: low 48
// param: high 84
note(p.low + ev.y * (p.high - p.low), 100, 0.3);
ev.reflect();`,
};

// What a junction's code returned, as what the rider does:
// { go: [way, ...] } (more than one: it splits), { back: true } or { stop: true }.
function decide(r, ways) {
  const one = (x) => (Number.isInteger(x) ? ways[x] : x && ways.includes(x) ? x : x?.line ? ways.find((w) => w.line === x.line && (x.dir == null || w.dir === x.dir)) : null);
  if (r === 'stop' || r === false) return { stop: true };
  if (r === 'back' || r === 'reflect') return { back: true };
  if (Array.isArray(r)) { const go = r.map(one).filter(Boolean); return go.length ? { go } : { stop: true }; }
  const w = r == null ? ways[0] : one(r);
  return w ? { go: [w] } : ways.length ? { go: [ways[0]] } : { back: true };
}

const MAX_RIDERS = 64; // a traveler that splits is at most this many
let paramsHook = () => ({});
export function createPlay() {
  const latched = new Set(), counts = new Map(), mems = new Map(), handlers = new Map(), net = new Map();
  const hitAt = new Map(); // event or junction id -> when it last fired (ms), for the view to flash
  const compile = (key, args, code) => {
    let f = handlers.get(key);
    if (!f) { try { f = { run: new Function(...args, code) }; } catch (e) { f = { error: e.message }; } if (handlers.size > 200) handlers.clear(); handlers.set(key, f); }
    return f;
  };
  const handler = (code) => compile(code, ['ev', 'p', 'note', 'mem'], code);
  const chooser = (code) => compile('junction\n' + code, ['ways', 'ev', 'p', 'mem'], code);
  const memOf = (id) => { if (!mems.has(id)) mems.set(id, {}); return mems.get(id); };

  // One rider of a traveler moves on by `left` (a distance) along its lines.
  // At a joint, the joint's code chooses; the rider may turn, split, go back or stop.
  // Returns the trail it left: points, for events to test against.
  function ride(o, rider, all, left, p, objects, measureOf, out, errors) {
    let m = measureOf(rider.line);
    const trail = m ? [atS(m, rider.s)] : [];
    for (let hop = 0; hop < 16 && left > 1e-9 && m && !rider.stopped; hop++) {
      const s1 = rider.s + rider.dir * left;
      let next = null; // the next joint ahead on this stretch
      for (const { j, u } of jointsOn(objects, rider.line)) {
        const sj = u * m.total, ahead = (sj - rider.s) * rider.dir;
        if (j.id !== rider.skip && ahead >= 0 && ahead <= left && (!next || ahead < next.ahead)) next = { j, sj, ahead };
      }
      const walk = (to) => { const n = Math.max(1, Math.ceil(Math.abs(to - rider.s) / (m.total / 200 || 1))); for (let k = 1; k <= n; k++) trail.push(atS(m, rider.s + (to - rider.s) * k / n)); };
      if (next) {
        walk(next.sj); left -= next.ahead; rider.s = next.sj;
        const j = next.j, heading = tangentS(m, rider.s).map((v) => v * rider.dir), ways = waysAt(j, rider.line, rider.dir, heading, measureOf);
        counts.set(j.id, (counts.get(j.id) ?? 0) + 1);
        hitAt.set(j.id, performance.now());
        out.set(j.id, { count: counts.get(j.id) });
        let r;
        const f = chooser(j.code ?? '');
        if (f.error) errors.set(j.id, f.error);
        else try { r = f.run(ways, { traveler: o.id, rider: rider.n, from: rider.line, count: counts.get(j.id) }, paramsHook(j), memOf(j.id)); } catch (err) { errors.set(j.id, err.message); }
        const d = decide(r, ways);
        rider.skip = j.id;
        if (d.stop) { rider.stopped = true; break; }
        if (d.back) { rider.dir = -rider.dir; continue; }
        d.go.slice(1).forEach((w) => { if (all.length < MAX_RIDERS) all.push({ ...rider, n: ++o_n.n, line: w.line, dir: w.dir, s: w.u * measureOf(w.line).total, spawned: true, pending: left }); });
        const w = d.go[0];
        rider.line = w.line; rider.dir = w.dir; m = measureOf(w.line); rider.s = w.u * m.total;
        continue;
      }
      if (s1 >= 0 && s1 <= m.total) { walk(s1); rider.s = s1; break; }
      // past an end with no joint there
      const end = rider.dir > 0 ? m.total : 0;
      walk(end); left -= Math.abs(end - rider.s); rider.s = end; rider.skip = null;
      const loop = p.loop ?? 1;
      if (objects.get(rider.line)?.closed || (loop === 1 && !rider.spawned)) rider.s = rider.dir > 0 ? 0 : m.total; // round again
      else if (loop === 2) rider.dir = -rider.dir;                                                                   // there and back
      else { rider.stopped = true; if (rider.spawned) rider.gone = true; }                                           // a copy that runs out goes
    }
    return trail;
  }
  const o_n = { n: 0 };

  return {
    hitAt,
    reset() { latched.clear(); counts.clear(); net.clear(); },
    // hooks: pointsOf(line) -> its points as shown, paramsOf(o) -> resolved parameters, note(midi, vel, dur)
    // -> { moved: id -> [x, y], ghosts: [{ of, pos }] (the riders a traveler split into), out, errors }
    step(objects, t, playing, hooks) {
      paramsHook = hooks.paramsOf;
      const moved = new Map(), out = new Map(), errors = new Map(), gate = new Map(), ghosts = [];
      const events = [...objects.values()].filter((o) => o.role === 'event' && !o.hidden);
      const measures = new Map(), measureOf = (id) => {
        if (!measures.has(id)) { const l = objects.get(id); measures.set(id, l?.points?.length > 1 && !l.bind && l.role !== 'traveler' ? measure(hooks.pointsOf(l)) : null); }
        return measures.get(id);
      };
      const shownOf = new Map(), pathOf = (l) => { if (!shownOf.has(l.id)) shownOf.set(l.id, hooks.pointsOf(l)); return shownOf.get(l.id); };
      for (const o of objects.values()) {
        if (o.role !== 'traveler') continue;
        const line = objects.get(o.on), start = line && measureOf(line.id);
        if (!start) continue;
        const p = hooks.paramsOf(o);
        // A traveler keeps its riders (one, until it splits): each a line, a distance along it, a direction.
        let st = net.get(o.id);
        if (!playing || !st || t < st.t || st.on !== line.id) {
          st = { on: line.id, t, riders: [{ n: ++o_n.n, line: line.id, s: Math.max(0, Math.min(1, p.start ?? 0)) * start.total, dir: 1, speed: start.total / Math.max(0.05, p.dur ?? 4), skip: null, stopped: false }] };
          net.set(o.id, st);
        }
        const dt = Math.max(0, t - st.t);
        st.t = t;
        const all = st.riders;
        for (let i = 0; i < all.length; i++) {
          const rider = all[i];
          const left = playing && !rider.stopped ? rider.pending ?? rider.speed * dt : 0;
          delete rider.pending;
          const trail = ride(o, rider, all, left, p, objects, measureOf, out, errors);
          if (!trail.length) continue;
          const m = measureOf(rider.line), pos = atS(m, rider.s), u = m.total ? rider.s / m.total : 0;
          if (i === 0) { moved.set(o.id, [pos[0], pos[1]]); out.set(o.id, { x: pos[0], y: pos[1], u }); } else if (!rider.gone) ghosts.push({ of: o.id, pos: [pos[0], pos[1]] });
          if (!playing) continue;
          const lineNow = objects.get(rider.line);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const q of pathOf(lineNow)) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
          for (const e of events) {
            if (e.space !== lineNow.space || e.id === rider.line) continue;
            const key = o.id + '#' + rider.n + '|' + e.id;
            let entered = null, now = false;
            if (e.kind === 'line') {
              const path = pathOf(e);
              if (isClosed(e, path)) { for (let k = 1; k < trail.length && !entered; k++) if (enclosed(path, trail[k][0], trail[k][1])) entered = trail[k]; now = enclosed(path, pos[0], pos[1]); }
              else { for (let k = 1; k < trail.length && !entered; k++) if (crosses(path, trail[k - 1], trail[k])) entered = trail[k]; latched.delete(key); }
            } else {
              const r = rectOf(e);
              for (let k = 1; k < trail.length && !entered; k++) if (inside(e, r, trail[k][0], trail[k][1])) entered = trail[k];
              now = inside(e, r, pos[0], pos[1]);
            }
            if (entered && !latched.has(key)) {
              counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
              hitAt.set(e.id, performance.now());
              const f = handler(e.code ?? EVENT);
              if (f.error) errors.set(e.id, f.error);
              else {
                // what the event can do to the rider that reached it
                const ev = {
                  type: 'enter', x: x1 > x0 ? (entered[0] - x0) / (x1 - x0) : 0.5, y: y1 > y0 ? (entered[1] - y0) / (y1 - y0) : 0.5, u, speed: rider.speed, traveler: o.id, rider: rider.n, count: counts.get(e.id),
                  reflect() { rider.dir = -rider.dir; rider.skip = null; },
                  stop() { rider.stopped = true; },
                  go() { rider.stopped = false; },
                  speed(k) { if (Number.isFinite(k) && k > 0) rider.speed *= k; },
                  split() { if (all.length < MAX_RIDERS) all.push({ ...rider, n: ++o_n.n, dir: -rider.dir, spawned: true, skip: null }); },
                };
                try { f.run(ev, hooks.paramsOf(e), hooks.note, memOf(e.id)); } catch (err) { errors.set(e.id, err.message); }
              }
            }
            // latched until it leaves: an event does not fire again while the traveler stays inside
            if (now) { latched.add(key); gate.set(e.id, 1); } else latched.delete(key);
          }
        }
        st.riders = all.filter((r, i) => i === 0 || !r.gone);
      }
      for (const e of events) out.set(e.id, { gate: gate.get(e.id) ?? 0, count: counts.get(e.id) ?? 0 });
      return { moved, ghosts, out, errors };
    },
  };
}
export { smooth };
