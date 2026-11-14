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
import { measure, atS, tangentS, jointsOn, waysAt, nearestOn } from './joints.js';

// An event's code runs when a traveler enters it:
//   ev    { x, y (where on the path's bounds, 0..1, y up), u (how far along), speed, traveler, rider, count }
//         and what it can do to the traveler: reflect(), stop(), go(), split(), speed(k)
//   p     the declared parameters;  mem  an object that persists
//   note(midi, velocity, seconds) plays a note; seconds 'gate': held while the traveler is
//         inside the event (a shape or a closed line), as IanniX's triggers do
//   pitch(v)  a place 0..1 as a note: across the timeline's range, on its scale
//   step(n, k)  k degrees of the scale up from note n;  snap(n)  the nearest note of the scale
//   rng()  a seeded random 0..1 (the same each time from the start);  cc(n, v, ch)  a MIDI controller
//   note(midi, vel, seconds, channel): channel 1..16 picks the instrument (the timeline's)
//   ev.type 'enter', 'cross' (an open line; ev.dir which way) or 'exit' (with the parameter exit 1);
//   ev.launch(line, dir) sets a new rider off on a line (its id or name).
//   The parameter lockout (seconds) keeps an event from firing again so soon.
export const EVENT = `// event
// out: gate count
// param: dur 0.3
// how high it was reached, as a note of the scale (set on the timeline)
note(pitch(ev.y), 100, p.dur);`;

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
// Where the step p -> q crosses the flat curve, and which way ([x, y, 1 | -1]: from its right to its left, or back), or null.
function crosses(path, p, q) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den, w = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
    if (t > 1e-6 && t <= 1 + 1e-6 && w >= 0 && w <= 1) return [p[0] + r[0] * t, p[1] + r[1] * t, den > 0 ? 1 : -1]; // a step that starts on the curve has not crossed it; which way it went
  }
  return null;
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
note(pitch(ev.y), 100, 0.3);
ev.reflect();`,
  gate: `// gate
// out: gate count
// the note sounds as long as the traveler is inside
note(pitch(ev.y), 100, 'gate');`,
  'fixed note': `// fixed note
// out: gate count
// param: midi 60
// param: vel 100
// param: dur 0.3
note(p.midi, p.vel, p.dur);`,
  'step up': `// step up
// out: gate count
// param: from 60
// param: by 1
// each time it fires, the next note up the scale, by an interval in degrees
mem.k = (mem.k ?? -1) + 1;
note(step(p.from, (mem.k * p.by) % 15), 100, 0.3);`,
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

// How fast the hand drew a line where a rider is: curve units a second, from the
// pen time of each point (a drawn line keeps them). null for a line drawn by code.
const paces = new WeakMap();
function drawnSpeed(line, m, s) {
  const pen = line.pen, pts = line.points;
  if (!pen || pen.length !== pts.length || pts.length < 2) return null;
  let c = paces.get(line);
  if (!c || c.pts !== pts) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] ?? 0) - (pts[i - 1][2] ?? 0)));
    const ms = Math.max(1, pen[pen.length - 1][0] - pen[0][0]);
    c = { pts, L, avg: L[L.length - 1] / (ms / 1000) };
    paces.set(line, c);
  }
  const { L, avg } = c, f = (s / (m.total || 1)) * L[L.length - 1];
  let i = 0;
  while (i < L.length - 2 && L[i + 1] < f) i++;
  const dt = (pen[i + 1][0] - pen[i][0]) / 1000, raw = dt > 0 ? (L[i + 1] - L[i]) / dt : avg;
  return Math.max(avg * 0.03, raw) * (m.total / (L[L.length - 1] || 1)); // a pause in the hand is slow, not a stop
}

const MAX_RIDERS = 64; // a traveler that splits is at most this many
// A seeded random (mulberry32): a performance plays the same each time from the start.
function seeded(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let paramsHook = () => ({});
const plain = { note() {}, cc() {}, pitch: (v) => 48 + v * 36, step: (n, k) => n + k, snap: (n) => n };
let hooksNow = plain;
export function createPlay() {
  const gates = new Map(); // a rider inside an event -> the notes it holds there
  const release = (key) => { for (const g of gates.get(key) ?? []) g.stop(); gates.delete(key); };
  let rng = seeded(1);
  const lastFire = new Map(); // event id -> transport time it last fired, for its lockout
  const latched = new Set(), firedAt = new Map(), counts = new Map(), mems = new Map(), handlers = new Map(), net = new Map();
  const hitAt = new Map(); // event or junction id -> when it last fired (ms), for the view to flash
  const compile = (key, args, code) => {
    let f = handlers.get(key);
    if (!f) { try { f = { run: new Function(...args, code) }; } catch (e) { f = { error: e.message }; } if (handlers.size > 200) handlers.clear(); handlers.set(key, f); }
    return f;
  };
  const handler = (code) => compile(code, ['ev', 'p', 'note', 'mem', 'pitch', 'step', 'snap', 'rng', 'cc'], code);
  const chooser = (code) => compile('junction\n' + code, ['ways', 'ev', 'p', 'mem', 'note', 'pitch', 'step', 'snap', 'rng', 'cc'], code);
  const memOf = (id) => { if (!mems.has(id)) mems.set(id, {}); return mems.get(id); };

  // One rider of a traveler moves on by `left` (a distance) along its lines.
  // At a joint, the joint's code chooses; the rider may turn, split, go back or stop.
  // Returns the trail it left: points, for events to test against; null where it jumped.
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
        else try { const h = hooksNow; r = f.run(ways, { traveler: o.id, rider: rider.n, from: rider.line, count: counts.get(j.id) }, paramsHook(j), memOf(j.id), h.note, h.pitch, h.step, h.snap, rng, h.cc); } catch (err) { errors.set(j.id, err.message); }
        const d = decide(r, ways);
        rider.skip = j.id;
        if (d.stop) { rider.stopped = true; break; }
        if (d.back) { rider.dir = -rider.dir; continue; }
        trail.push(null, atS(measureOf(d.go[0].line), d.go[0].u * measureOf(d.go[0].line).total));
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
      if (objects.get(rider.line)?.closed || (loop === 1 && !rider.spawned)) { rider.s = rider.dir > 0 ? 0 : m.total; trail.push(null, atS(m, rider.s)); } // round again: a jump, not a stretch travelled
      else if (loop === 2) rider.dir = -rider.dir;                                                                   // there and back
      else { rider.stopped = true; if (rider.spawned) rider.gone = true; }                                           // a copy that runs out goes
    }
    return trail;
  }
  const o_n = { n: 0 };

  return {
    hitAt,
    // let go of every held note (a pause), the travelers staying where they are
    quiet() { for (const k of [...gates.keys()]) release(k); latched.clear(); },
    reset() { for (const k of [...gates.keys()]) release(k); latched.clear(); firedAt.clear(); lastFire.clear(); counts.clear(); net.clear(); mems.clear(); rng = seeded(1); },
    // hooks: pointsOf(line) -> its points as shown, paramsOf(o) -> resolved parameters, note(midi, vel, dur)
    // -> { moved: id -> [x, y], ghosts: [{ of, pos }] (the riders a traveler split into), out, errors }
    // hooks also: spb (seconds a beat), grid (canvas units a grid cell), pitch, step, snap
    step(objects, t, playing, hooks) {
      paramsHook = hooks.paramsOf;
      hooksNow = { ...plain, ...hooks };
      const spb = hooks.spb ?? 0.5, grid = hooks.grid ?? 1;
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
        // At rest at the start (not playing, at 0), or sent back in time: it starts afresh.
        let st = net.get(o.id);
        if ((!playing && t === 0) || !st || t < st.t || st.on !== line.id) {
          const speed = p.speed > 0 ? (p.speed * grid) / spb : start.total / Math.max(0.05, (p.dur ?? 8) * spb);
          st = { on: line.id, t, riders: [{ n: ++o_n.n, line: line.id, s: Math.max(0, Math.min(1, p.start ?? 0)) * start.total, dir: 1, speed, base: speed, skip: null, stopped: false }] };
          net.set(o.id, st);
        }
        // it moves only from its own beat on (IanniX: each object's time is the transport's, from its start)
        const from = Math.max(st.t, (p.at ?? 0) * spb), dt = Math.max(0, t - from);
        st.t = t;
        const all = st.riders;
        for (let i = 0; i < all.length; i++) {
          const rider = all[i];
          const pace = p.drawn > 0 ? drawnSpeed(objects.get(rider.line), measureOf(rider.line), rider.s) : null;
          const left = playing && !rider.stopped ? rider.pending ?? (pace != null ? pace * p.drawn * (rider.speed / (rider.base ?? rider.speed)) : rider.speed) * dt : 0;
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
            const wasIn = latched.has(key), ep = hooks.paramsOf(e);
            if (e.kind === 'line') {
              const path = pathOf(e);
              if (isClosed(e, path)) { for (let k = 1; k < trail.length && !entered; k++) if (trail[k] && enclosed(path, trail[k][0], trail[k][1])) entered = trail[k]; now = enclosed(path, pos[0], pos[1]); }
              else {
                // a line crossed: where, exactly. After it has fired, it waits until the rider is clear of
                // that spot, so a rider sent back from it does not cross it again at once.
                const at = firedAt.get(key);
                if (at && Math.hypot(pos[0] - at[0], pos[1] - at[1]) > Math.max(1e-3, rider.speed * 0.05)) firedAt.delete(key);
                if (!firedAt.has(key)) for (let k = 1; k < trail.length && !entered; k++) if (trail[k - 1] && trail[k]) entered = crosses(path, trail[k - 1], trail[k]);
              }
            } else {
              const r = rectOf(e);
              for (let k = 1; k < trail.length && !entered; k++) if (trail[k] && inside(e, r, trail[k][0], trail[k][1])) entered = trail[k];
              now = inside(e, r, pos[0], pos[1]);
            }
            // a lockout (seconds): an event that has just fired waits that long before it fires again
            if (entered && ep.lockout > 0 && t - (lastFire.get(e.id) ?? -1e9) < ep.lockout) entered = null;
            const leaving = !now && wasIn && !entered && ep.exit > 0 ? pos : null; // exit 1: it also fires on the way out
            const fireAt = entered && !wasIn ? entered : leaving;
            if (fireAt) {
              counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
              hitAt.set(e.id, performance.now());
              lastFire.set(e.id, t);
              const f = handler(e.code ?? EVENT);
              if (f.error) errors.set(e.id, f.error);
              else {
                if (e.kind === 'line' && !isClosed(e, pathOf(e))) firedAt.set(key, entered);
                // What the event can do to the rider that reached it. Turned back, stopped or split,
                // the rider is put back where it reached the event, not left a step beyond it.
                const back = () => { const mm = measureOf(rider.line); if (mm) rider.s = nearestOn(mm, fireAt) * mm.total; };
                const ev = {
                  type: leaving ? 'exit' : e.kind === 'line' && !isClosed(e, pathOf(e)) ? 'cross' : 'enter', dir: fireAt[2] ?? 0,
                  x: x1 > x0 ? (fireAt[0] - x0) / (x1 - x0) : 0.5, y: y1 > y0 ? (fireAt[1] - y0) / (y1 - y0) : 0.5, u, speed: rider.speed, traveler: o.id, rider: rider.n, count: counts.get(e.id), t,
                  // a new rider on a line (its id or its name), from its start (dir -1: from its end)
                  launch(on, dir = 1) {
                    const l = objects.get(on) ?? [...objects.values()].find((x) => x.name === on && x.kind === 'line'), mm = l && measureOf(l.id);
                    if (!mm || all.length >= MAX_RIDERS) return false;
                    all.push({ n: ++o_n.n, line: l.id, s: dir < 0 ? mm.total : 0, dir: dir < 0 ? -1 : 1, speed: rider.speed, base: rider.base, skip: null, stopped: false, spawned: true });
                    return true;
                  },
                  reflect() { back(); rider.dir = -rider.dir; rider.skip = null; },
                  stop() { back(); rider.stopped = true; },
                  go() { rider.stopped = false; },
                  speed(k) { if (Number.isFinite(k) && k > 0) rider.speed *= k; },
                  split() {
                    if (all.length >= MAX_RIDERS) return;
                    back();
                    const copy = { ...rider, n: ++o_n.n, dir: -rider.dir, spawned: true, skip: null };
                    all.push(copy);
                    firedAt.set(o.id + '#' + copy.n + '|' + e.id, fireAt); // the copy starts on the event: it has already been there
                  },
                };
                // 'gate': a note held until the rider leaves; where there is no inside (an open line), a short one
              const region = e.kind !== 'line' || isClosed(e, pathOf(e));
              const note = (m, v = 100, d = 0.3, ch = 1) => {
                if (d !== 'gate') return hooksNow.note(m, v, d, ch);
                if (!region || !hooksNow.hold || leaving) return hooksNow.note(m, v, 0.3, ch);
                if (!gates.has(key)) gates.set(key, []);
                gates.get(key).push(hooksNow.hold(m, v, ch));
              };
              try { f.run(ev, ep, note, memOf(e.id), hooksNow.pitch, hooksNow.step, hooksNow.snap, rng, hooksNow.cc); } catch (err) { errors.set(e.id, err.message); }
              }
            }
            // latched until it leaves: an event does not fire again while the traveler stays inside
            if (now) { latched.add(key); gate.set(e.id, 1); } else { latched.delete(key); if (gates.has(key) && !(entered && !wasIn)) release(key); }
          }
        }
        st.riders = all.filter((r, i) => i === 0 || !r.gone);
      }
      for (const e of events) out.set(e.id, { gate: gate.get(e.id) ?? 0, count: counts.get(e.id) ?? 0 });
      return { moved, ghosts, out, errors };
    },
  };
}
// Play the drawing offline, from the start to `to` seconds, and keep the notes it
// makes ([{ sec, midi, vel, len (s), ch }]); the same performance as playing it
// live, since everything that chooses is seeded. hooks as for step (note and hold are taken over).
export function renderNotes(objects, to, hooks, dt = 1 / 120) {
  const play = createPlay(), out = [];
  let now = 0;
  const h = { ...hooks, note: (midi, vel = 100, len = 0.3, ch = 1) => { if (Number.isFinite(midi)) out.push({ sec: now, midi, vel, len, ch }); },
    hold: (midi, vel = 100, ch = 1) => { const at = now; return { stop() { if (Number.isFinite(midi)) out.push({ sec: at, midi, vel, len: Math.max(0.02, now - at), ch }); } }; } };
  for (now = 0; now <= to + 1e-9; now += dt) play.step(objects, now, true, h);
  play.reset(); // what is still held ends at the end
  return out.sort((a, b) => a.sec - b.sec);
}
export { smooth };
