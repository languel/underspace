// Paths, travelers and events (after IanniX, by way of Artist Model Studio).
//   path      any line: geometry with a length
//   traveler  a shape that moves along a line over time
//   event     a shape that reacts when a traveler enters it; its code says how
// One rule: a traveler entering an event fires it. Pure apart from the hooks.

import { along, smooth, rectOf } from './object.js';

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

export function createPlay() {
  const lastU = new Map(), latched = new Set(), counts = new Map(), mems = new Map(), handlers = new Map();
  const hitAt = new Map(); // event id -> when it last fired (ms), for the view to flash
  const handler = (code) => {
    let f = handlers.get(code);
    if (!f) { try { f = { run: new Function('ev', 'p', 'note', 'mem', code) }; } catch (e) { f = { error: e.message }; } if (handlers.size > 200) handlers.clear(); handlers.set(code, f); }
    return f;
  };

  return {
    hitAt,
    reset() { lastU.clear(); latched.clear(); counts.clear(); },
    // hooks: pointsOf(line) -> its points as shown, paramsOf(o) -> resolved parameters, note(midi, vel, dur)
    // -> { moved: id -> [x, y], out: id -> outputs, errors: id -> message }
    step(objects, t, playing, hooks) {
      const moved = new Map(), out = new Map(), errors = new Map(), gate = new Map();
      const events = [...objects.values()].filter((o) => o.role === 'event' && !o.hidden);
      for (const o of objects.values()) {
        if (o.role !== 'traveler') continue;
        const line = objects.get(o.on);
        if (!line?.points) continue;
        const pts = hooks.pointsOf(line), p = hooks.paramsOf(o);
        const u = playing ? progress(t, p) : Math.max(0, Math.min(1, p.start));
        const pos = along(pts, u);
        moved.set(o.id, pos); out.set(o.id, { x: pos[0], y: pos[1], u });
        const before = lastU.get(o.id) ?? u;
        lastU.set(o.id, u);
        if (!playing) continue;
        // Swept: test the stretch travelled since the last step, not just where it is now,
        // so a fast traveler cannot jump a thin event. A loop's wrap is not a stretch.
        const wrapped = p.loop === 1 && Math.abs(u - before) > 0.5, from = wrapped ? u : before;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        const steps = Math.max(1, Math.min(48, Math.ceil(Math.abs(u - from) * 400)));
        for (const e of events) {
          if (e.space !== line.space) continue;
          const key = o.id + '|' + e.id, r = rectOf(e);
          let entered = null;
          for (let k = 1; k <= steps && !entered; k++) { const q = along(pts, from + (u - from) * k / steps); if (inside(e, r, q[0], q[1])) entered = q; }
          const now = inside(e, r, pos[0], pos[1]);
          if (entered && !latched.has(key)) {
            counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
            hitAt.set(e.id, performance.now());
            const f = handler(e.code ?? EVENT);
            if (f.error) errors.set(e.id, f.error);
            else {
              if (!mems.has(e.id)) mems.set(e.id, {});
              const ev = { type: 'enter', x: x1 > x0 ? (entered[0] - x0) / (x1 - x0) : 0.5, y: y1 > y0 ? (entered[1] - y0) / (y1 - y0) : 0.5, u, speed: Math.abs(u - from), traveler: o.id };
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
