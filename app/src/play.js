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
//   ev    { x, y (where on the path's bounds, 0..1, y up), u (how far along), speed, traveler }
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
    if (t > 0 && t <= 1 && w >= 0 && w <= 1) return true;
  }
  return false;
}
const isClosed = (o, path) => o.closed || (path.length > 3 && Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) < 1e-6);

let paramsHook = () => ({});
export function createPlay() {
  const lastU = new Map(), latched = new Set(), counts = new Map(), mems = new Map(), handlers = new Map(), net = new Map();
  const hitAt = new Map(); // event id -> when it last fired (ms), for the view to flash
  const handler = (code) => {
    let f = handlers.get(code);
    if (!f) { try { f = { run: new Function('ev', 'p', 'note', 'mem', code) }; } catch (e) { f = { error: e.message }; } if (handlers.size > 200) handlers.clear(); handlers.set(code, f); }
    return f;
  };
  const chooser = (code) => {
    const key = 'junction\n' + code;
    let f = handlers.get(key);
    if (!f) { try { f = { run: new Function('ways', 'ev', 'p', 'mem', code) }; } catch (e) { f = { error: e.message }; } handlers.set(key, f); }
    return f;
  };

  return {
    hitAt,
    reset() { lastU.clear(); latched.clear(); counts.clear(); net.clear(); },
    // A traveler in a network: it keeps its own place (line, distance, direction)
    // and moves on by its speed; at a junction the junction's code picks the way.
    network(o, line, t, playing, p, objects, measureOf, out, errors) {
      let st = net.get(o.id);
      const start = measureOf(line.id);
      if (!start) return { pos: [0, 0], u: 0, trail: [] };
      if (!playing || !st || t < st.t) { st = { line: line.id, s: Math.max(0, Math.min(1, p.start ?? 0)) * start.total, dir: 1, t, speed: start.total / Math.max(0.05, p.dur ?? 4), skip: null, stopped: false }; net.set(o.id, st); }
      let m = measureOf(st.line) ?? start;
      if (!measureOf(st.line)) { st.line = line.id; st.s = 0; }
      const trail = [atS(m, st.s)];
      let left = playing && !st.stopped ? st.speed * Math.min(0.25, t - st.t) : 0;
      st.t = t;
      for (let hop = 0; hop < 12 && left > 1e-9; hop++) {
        m = measureOf(st.line);
        const s1 = st.s + st.dir * left;
        // the next joint ahead on this stretch
        let next = null;
        for (const { j, u } of jointsOn(objects, st.line)) {
          const sj = u * m.total, ahead = (sj - st.s) * st.dir;
          if (j.id !== st.skip && ahead >= 0 && ahead <= left && (!next || ahead < next.ahead)) next = { j, sj, ahead };
        }
        const walk = (to) => { const n = Math.max(1, Math.ceil(Math.abs(to - st.s) / (m.total / 200 || 1))); for (let k = 1; k <= n; k++) trail.push(atS(m, st.s + (to - st.s) * k / n)); };
        if (next) {
          walk(next.sj); left -= next.ahead; st.s = next.sj;
          const heading = tangentS(m, st.s).map((v) => v * st.dir), ways = waysAt(next.j, st.line, st.dir, heading, measureOf);
          let way = ways[0];
          const f = chooser(next.j.code ?? '');
          if (f.error) errors.set(next.j.id, f.error);
          else if (ways.length) {
            if (!mems.has(next.j.id)) mems.set(next.j.id, {});
            try {
              const r = f.run(ways, { traveler: o.id, from: st.line, count: (counts.get(next.j.id) ?? 0) + 1 }, paramsHook(next.j), mems.get(next.j.id));
              if (Number.isInteger(r) && ways[r]) way = ways[r]; else if (r && ways.includes(r)) way = r; else if (r?.line) way = ways.find((w) => w.line === r.line && (r.dir == null || w.dir === r.dir)) ?? way;
            } catch (err) { errors.set(next.j.id, err.message); }
          }
          counts.set(next.j.id, (counts.get(next.j.id) ?? 0) + 1);
          hitAt.set(next.j.id, performance.now());
          out.set(next.j.id, { count: counts.get(next.j.id) });
          if (!way) { st.dir = -st.dir; st.skip = next.j.id; continue; } // a dead end: back the way it came
          st.line = way.line; st.dir = way.dir; st.s = way.u * measureOf(way.line).total; st.skip = next.j.id;
          continue;
        }
        if (s1 >= 0 && s1 <= m.total) { walk(s1); st.s = s1; left = 0; break; }
        // past an end with no joint there
        const end = st.dir > 0 ? m.total : 0;
        walk(end); left -= Math.abs(end - st.s); st.s = end; st.skip = null;
        const l = objects.get(st.line);
        if (l?.closed || (p.loop ?? 1) === 1) st.s = st.dir > 0 ? 0 : m.total; // round again
        else if (p.loop === 2) st.dir = -st.dir;                               // there and back
        else { st.stopped = true; left = 0; }
      }
      const pos = atS(m, st.s);
      return { pos, u: m.total ? st.s / m.total : 0, trail };
    },
    // hooks: pointsOf(line) -> its points as shown, paramsOf(o) -> resolved parameters, note(midi, vel, dur)
    // -> { moved: id -> [x, y], out: id -> outputs, errors: id -> message }
    step(objects, t, playing, hooks) {
      paramsHook = hooks.paramsOf;
      const moved = new Map(), out = new Map(), errors = new Map(), gate = new Map();
      const events = [...objects.values()].filter((o) => o.role === 'event' && !o.hidden);
      const measures = new Map(), measureOf = (id) => {
        if (!measures.has(id)) { const l = objects.get(id); measures.set(id, l?.points?.length > 1 && !l.bind && l.role !== 'traveler' ? measure(hooks.pointsOf(l)) : null); }
        return measures.get(id);
      };
      const shownOf = new Map(), pathOf = (l) => { if (!shownOf.has(l.id)) shownOf.set(l.id, hooks.pointsOf(l)); return shownOf.get(l.id); };
      for (const o of objects.values()) {
        if (o.role !== 'traveler') continue;
        const line = objects.get(o.on);
        if (!line?.points) continue;
        const p = hooks.paramsOf(o);
        let pos, u, trail;
        if (jointsOn(objects, line.id).length) ({ pos, u, trail } = this.network(o, line, t, playing, p, objects, measureOf, out, errors));
        else {
          const pts = pathOf(line);
          u = playing ? progress(t, p) : Math.max(0, Math.min(1, p.start));
          pos = along(pts, u);
          const before = lastU.get(o.id) ?? u;
          // Swept: the stretch travelled since the last step, not just where it is now,
          // so a fast traveler cannot jump a thin event. A loop's wrap is not a stretch.
          const from = p.loop === 1 && Math.abs(u - before) > 0.5 ? u : before, steps = Math.max(1, Math.min(48, Math.ceil(Math.abs(u - from) * 400)));
          trail = [];
          for (let k = 0; k <= steps; k++) trail.push(along(pts, from + (u - from) * k / steps));
        }
        lastU.set(o.id, u);
        moved.set(o.id, [pos[0], pos[1]]); out.set(o.id, { x: pos[0], y: pos[1], u });
        if (!playing) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of pathOf(line)) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        for (const e of events) {
          if (e.space !== line.space || e.id === line.id) continue;
          const key = o.id + '|' + e.id;
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
              if (!mems.has(e.id)) mems.set(e.id, {});
              const ev = { type: 'enter', x: x1 > x0 ? (entered[0] - x0) / (x1 - x0) : 0.5, y: y1 > y0 ? (entered[1] - y0) / (y1 - y0) : 0.5, u, speed: Math.hypot(trail[trail.length - 1][0] - trail[0][0], trail[trail.length - 1][1] - trail[0][1]), traveler: o.id };
              try { f.run(ev, hooks.paramsOf(e), hooks.note, mems.get(e.id)); } catch (err) { errors.set(e.id, err.message); }
            }
          }
          // latched until it leaves: an event does not fire again while the traveler stays inside
          if (now) { latched.add(key); gate.set(e.id, 1); } else latched.delete(key);
        }
      }
      for (const e of events) out.set(e.id, { gate: gate.get(e.id) ?? 0, count: counts.get(e.id) ?? 0 });
      return { moved, out, errors };
    },
  };
}
export { smooth };
