// Sim: anything drawn can be physical, as it can be a score, a visual or a sound.
//
// After Algodoo (draw a thing and it falls; pin it, hinge it, put a motor on the hinge), built from
// the ground up. What an object is in the simulation is one more facet of it:
//
//   o.phys = { is, ...parameters }
//     body    it moves: it falls, collides, turns        density friction bounce
//     fixed   it stays: ground, walls, ramps             friction bounce
//             (a traveler made fixed is carried along its line by the score, and pushes)
//     rope    a line whose points are free: it hangs     density friction shake
//             (a wire made a rope hangs between its two ports and is shaken by what passes through it)
//     hinge   a point: what is under it turns about it   motor (turns a beat) torque
//             (one thing: held to the world there; two: held together there)
//     weld    a point: the two things under it are one
//     spring  a line: what is under its two ends is pulled together   stiff damp rest
//
// Time is the transport's, in beats, not seconds: the world ticks TPB times a beat (48, so every
// division the music quantizes to falls on a tick), gravity is canvas units a beat squared, a motor
// turns so many times a beat. A scene is therefore the same at any tempo, and a bounce that lands
// on the beat lands on it at every tempo.
//
// The world is a function of the drawing and the tick: the drawing is where everything is at tick
// 0, and tick n is always reached by the same arithmetic in the same order (add, multiply, divide,
// square root: nothing a machine may round its own way). So time can be travelled as space is:
// forward by stepping, back or far ahead by a checkpoint and stepping from there; and changing the
// drawing changes its whole future, at once. What comes from outside while it runs (a force from
// an object's code, a traveler carrying something, a signal in a wire) is kept by tick, as a
// recording, so a replay is the same.
//
// How it meets the rest:
//   an event (role 'event') is fired by a body reaching it, as by a traveler: the same code, so
//     note(pitch(ev.y), ev.vel) sounds a hit by where and how hard (ev.hit: its speed);
//   the code of a physical object reads how it moves (geom.body: x y vx vy speed spin hit) and what
//     it returns as fx, fy (and spin) pushes it: the blanket is still the only way in or out;
//   the Q setting holds each hit until the next beat division.
//
// The engine below is pure (no DOM, no state of the app): createWorld(scene).to(tick).

import { state, define, argTypes as T } from './space.js';
import { outline, isTarget, isWire, hasCode, qrot as rot, carried } from './object.js';
import { curveOf } from './joints.js';
import { wirePoints, fit } from './bind.js';

export const TPB = 48;  // ticks a beat
const SUB = 4;          // steps a tick
const ITER = 2;         // passes over the constraints a step
const KEEP = 12;        // a checkpoint every so many ticks
const QUIET = 6;        // ticks two things must be apart before touching again is a new hit

export const DEFAULT_SIM = { gravity: [0, -16], drag: 0.05, skin: 0.04 };
// What each kind is, and the parameters it has unless the object says otherwise.
export const PHYS = {
  body: { density: 1, friction: 0.5, bounce: 0.3 },
  fixed: { friction: 0.5, bounce: 0.3 },
  rope: { density: 1, friction: 0.5, shake: 1 },
  hinge: { motor: 0, torque: 400 },
  weld: {},
  spring: { stiff: 60, damp: 2, rest: 1 },
};
export const physOf = (o) => (o?.phys?.is && PHYS[o.phys.is] ? { ...PHYS[o.phys.is], ...o.phys } : null);
export const worldOf = (s = state) => ({ ...DEFAULT_SIM, ...(s.sim ?? {}) });

// ---- vectors (always three numbers; a flat space keeps z at 0) ------------------------------

const V = (p) => [p[0], p[1], p[2] ?? 0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const irot = (q, v) => rot([-q[0], -q[1], -q[2], q[3]], v);
// q turned on by the small rotation d (a vector: its axis, its length the angle)
function turn(q, d) {
  const x = q[0] + 0.5 * (d[0] * q[3] + d[1] * q[2] - d[2] * q[1]), y = q[1] + 0.5 * (d[1] * q[3] + d[2] * q[0] - d[0] * q[2]);
  const z = q[2] + 0.5 * (d[2] * q[3] + d[0] * q[1] - d[1] * q[0]), w = q[3] - 0.5 * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  return [x / n, y / n, z / n, w / n];
}
// the nearest point of the stretch a-b to p: [point, how far along 0..1]
function nearest(p, a, b) {
  const d = sub(b, a), l2 = dot(d, d), t = l2 > 1e-18 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return [lerp(a, b, t), t];
}

// ---- a drawn outline as the points that collide ----------------------------------------------

// The corners of a run of points (Ramer-Douglas-Peucker, flat or not): indices.
function corners(p, tol) {
  const keep = new Uint8Array(p.length), stack = [[0, p.length - 1]];
  keep[0] = keep[p.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, most = tol;
    for (let i = a + 1; i < b; i++) { const d = len(sub(p[i], nearest(p[i], p[a], p[b])[0])); if (d > most) { most = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
// Its corners, and between them a point at least every `step` (0: corners only).
export function sample(points, closed, step, tol = 0.02) {
  let p = points.map(V);
  if (closed && p.length > 2 && len(sub(p[0], p[p.length - 1])) < 1e-9) p = p.slice(0, -1);
  if (p.length < 2) return p;
  let c = corners(closed ? [...p, p[0]] : p, tol);
  if (closed) c = c.slice(0, -1);
  if (!(step > 0)) return c;
  const out = [], n = closed ? c.length : c.length - 1;
  for (let i = 0; i < n; i++) {
    const a = c[i], b = c[(i + 1) % c.length], k = Math.max(1, Math.ceil(len(sub(b, a)) / step - 1e-9));
    for (let j = 0; j < k; j++) out.push(lerp(a, b, j / k));
  }
  if (!closed) out.push(c[c.length - 1]);
  return out;
}
// A run of points again, n stretches of equal length (a rope's).
function even(points, n) {
  const p = points.map(V), cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + len(sub(p[i], p[i - 1])));
  const total = cum[cum.length - 1], out = [];
  for (let k = 0, i = 1; k <= n; k++) {
    const s = (total * k) / n;
    while (i < p.length - 1 && cum[i] < s) i++;
    const span = cum[i] - cum[i - 1];
    out.push(lerp(p[i - 1], p[i], span > 0 ? (s - cum[i - 1]) / span : 0));
  }
  return out;
}
const lengthOf = (p, closed) => { let l = 0; for (let i = 1; i < p.length; i++) l += len(sub(p[i], p[i - 1])); return closed && p.length > 1 ? l + len(sub(p[0], p[p.length - 1])) : l; };
const areaOf = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a / 2); };
// Is the flat point p inside the closed run W[start .. start + n)?
function within(W, start, n, p) {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = W[start + i], b = W[start + j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// ---- the world ---------------------------------------------------------------------------

// scene: { gravity: [x, y, z], drag, skin,
//   bodies: [{ id, is: 'body' | 'fixed' | 'rope', parts: [{ pts, closed, r? }], flat, space, sensor?, driven?,
//              density, friction, bounce }],
//   joints: [{ id, is: 'hinge' | 'spring', a: body id | null, b: body id | null, at (hinge) or pa, pb (spring),
//              motor, torque, stiff, damp, rest }] }
// -> { tick, to(tick, inputs) -> events, poses(), outs(), ends(jointId), forget(fromTick) }
//   inputs(tick) -> { force: { id: [x, y, z] }, spin: { id: n }, drive: { id: [x, y, z] }, shake: { id: n } } or nothing
//   an event: { tick, type: 'hit' | 'enter', a, b, at: [x, y, z], speed }
export function createWorld(scene) {
  const g = V(scene.gravity ?? DEFAULT_SIM.gravity), drag = scene.drag ?? DEFAULT_SIM.drag, skin = scene.skin ?? DEFAULT_SIM.skin;
  const h = 1 / (TPB * SUB), gl = len(g);
  const bodies = [], byId = new Map();

  for (const s of scene.bodies) {
    const b = { id: s.id, rope: s.is === 'rope', fixed: s.is === 'fixed', sensor: !!s.sensor, driven: !!s.driven, flat: s.flat !== false, space: s.space ?? null,
      friction: s.friction ?? 0.5, bounce: s.bounce ?? 0.3, W: [], rad: [], segs: [], loops: [], hit: 0, force: null };
    if (b.rope) {
      const src = s.parts[0].pts, total = lengthOf(src.map(V), false), n = Math.max(2, Math.min(40, Math.round(total / 0.3)));
      b.W = even(src, n); b.rest = [];
      const m = Math.max(1e-3, ((s.density ?? 1) * total * 0.2) / (n + 1));
      b.wp = b.W.map(() => 1 / m); b.Vp = b.W.map(() => [0, 0, 0]); b.Pp = b.W.map((p) => p.slice());
      for (let i = 0; i < n; i++) { b.rest.push(len(sub(b.W[i + 1], b.W[i]))); b.segs.push([i, i + 1, skin]); }
      b.rad = b.W.map(() => skin);
      b.loops.push({ start: 0, n: n + 1, solid: false });
    } else {
      // a rigid body: its points in its own frame, about its centre of mass
      const pts = [], mass = [];
      for (const part of s.parts) {
        const src = part.pts.map(V), r = skin + (part.r ?? 0);
        const total = lengthOf(src, part.closed), step = b.fixed ? 0 : Math.max(0.08, Math.min(0.5, total / 12));
        const p = src.length > 1 ? sample(src, part.closed, step) : src, solid = !!part.closed && b.flat && p.length > 2;
        const m = Math.max(1e-3, (s.density ?? 1) * (p.length === 1 ? 3.1416 * r * r : solid ? areaOf(p) : total * 0.2));
        const start = pts.length;
        b.loops.push({ start, n: p.length, solid });
        p.forEach((q, i) => { pts.push(q); mass.push(m / p.length); b.rad.push(r); if (p.length === 1) b.segs.push([start, start, r]); else if (i < p.length - 1 || part.closed) b.segs.push([start + i, start + ((i + 1) % p.length), r]); });
      }
      let M = 0, c = [0, 0, 0];
      pts.forEach((p, i) => { M += mass[i]; c = add(c, mul(p, mass[i])); });
      c = mul(c, 1 / M);
      b.L = pts.map((p) => sub(p, c));
      let I = 0;
      b.L.forEach((l, i) => { I += mass[i] * dot(l, l); });
      b.loops.forEach((lp) => { if (lp.n === 1) I += 0.5 * mass[lp.start] * b.rad[lp.start] * b.rad[lp.start]; }); // a disc
      I = Math.max(1e-6, I * (b.loops.some((lp) => lp.solid) ? 0.5 : 1) * (b.flat ? 1 : 2 / 3));
      b.x0 = c; b.x = c.slice(); b.q = [0, 0, 0, 1]; b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.xp = c.slice(); b.qp = [0, 0, 0, 1];
      b.invM = b.fixed ? 0 : 1 / M; b.invI = b.fixed ? 0 : 1 / I;
      b.W = pts.map((p) => p.slice());
      b.reach = Math.max(0, ...b.L.map(len));
    }
    b.n = bodies.length;
    bodies.push(b); byId.set(b.id, b);
  }
  const refresh = (b) => { if (!b.rope) for (let i = 0; i < b.L.length; i++) b.W[i] = add(b.x, rot(b.q, b.L[i])); };

  // A place on a body: on a rigid one, a point in its own frame; on a rope, between two of its points.
  const placeOn = (b, p) => {
    if (!b.rope) return { b, l: irot(b.q, sub(p, b.x)) };
    let best = 0, bd = Infinity;
    b.W.forEach((q, i) => { const d = len(sub(q, p)); if (d < bd) { bd = d; best = i; } });
    return { b, i: best, j: best, t: 0 };
  };
  const posOf = (e) => (e.b.rope ? lerp(e.b.W[e.i], e.b.W[e.j], e.t) : add(e.b.x, rot(e.b.q, e.l)));
  const wasAt = (e) => (e.b.rope ? lerp(e.b.Pp[e.i], e.b.Pp[e.j], e.t) : add(e.b.xp, rot(e.b.qp, e.l)));
  // how readily the place gives way along n (0: not at all)
  const wOf = (e, n, p) => {
    const b = e.b;
    if (b.rope) return b.wp[e.i] * (1 - e.t) * (1 - e.t) + b.wp[e.j] * e.t * e.t;
    if (!b.invM) return 0;
    const c = cross(sub(p, b.x), n);
    return b.invM + b.invI * dot(c, c);
  };
  // move the place by d (weighed by how readily it gives way)
  const push = (e, d, p) => {
    const b = e.b;
    if (b.rope) { b.W[e.i] = add(b.W[e.i], mul(d, b.wp[e.i] * (1 - e.t))); if (e.t) b.W[e.j] = add(b.W[e.j], mul(d, b.wp[e.j] * e.t)); return; }
    if (!b.invM) return;
    const r = sub(p, b.x);
    b.x = add(b.x, mul(d, b.invM));
    b.q = turn(b.q, mul(cross(r, d), b.invI));
  };
  // change its speed by d
  const kick = (e, d, p) => {
    const b = e.b;
    if (b.rope) { b.Vp[e.i] = add(b.Vp[e.i], mul(d, b.wp[e.i] * (1 - e.t))); if (e.t) b.Vp[e.j] = add(b.Vp[e.j], mul(d, b.wp[e.j] * e.t)); return; }
    if (!b.invM) return;
    b.v = add(b.v, mul(d, b.invM));
    b.w = add(b.w, mul(cross(sub(p, b.x), d), b.invI));
  };
  const velOf = (e, p) => (e.b.rope ? lerp(e.b.Vp[e.i], e.b.Vp[e.j], e.t) : add(e.b.v, cross(e.b.w, sub(p, e.b.x))));

  // joints, and the pairs they hold together (which do not collide)
  const joints = [], held = new Set(), pair = (a, b) => (a.n < b.n ? a.n * 65536 + b.n : b.n * 65536 + a.n);
  for (const j of scene.joints ?? []) {
    const A = j.a != null ? byId.get(j.a) : null, B = j.b != null ? byId.get(j.b) : null;
    if (!A && !B) continue;
    const pa = V(j.pa ?? j.at), pb = V(j.pb ?? j.at);
    const J = { id: j.id, spring: j.is === 'spring', a: A ? placeOn(A, pa) : null, b: B ? placeOn(B, pb) : null, pa, pb, motor: j.motor ?? 0, torque: j.torque ?? 400,
      stiff: j.stiff ?? 60, damp: j.damp ?? 2, rest: len(sub(pb, pa)) * (j.rest ?? 1) };
    if (A && B && !J.spring) held.add(pair(A, B));
    joints.push(J);
  }
  const endOf = (e, fixed) => (e ? posOf(e) : fixed);

  let tick = 0;
  const touch = new Map(); // a pair of bodies -> the tick they last touched
  const marks = new Map([[0, snap()]]);

  function snap() {
    const out = [];
    for (const b of bodies) {
      if (b.rope) { for (const p of b.W) out.push(p[0], p[1], p[2]); for (const v of b.Vp) out.push(v[0], v[1], v[2]); } else out.push(...b.x, ...b.q, ...b.v, ...b.w);
      out.push(b.hit);
    }
    return { s: Float64Array.from(out), touch: [...touch] };
  }
  function restore(k) {
    const { s, touch: t } = marks.get(k);
    let i = 0;
    const take = (n) => { const v = Array.from(s.subarray(i, i + n)); i += n; return v; };
    for (const b of bodies) {
      if (b.rope) { b.W = b.W.map(() => take(3)); b.Vp = b.Vp.map(() => take(3)); } else { b.x = take(3); b.q = take(4); b.v = take(3); b.w = take(3); refresh(b); }
      b.hit = s[i++];
    }
    touch.clear(); for (const [key, v] of t) touch.set(key, v);
    tick = k;
  }

  // One tick: SUB steps of h beats. inp: what comes from outside during it.
  function step(inp, events) {
    for (const b of bodies) {
      b.hit = 0;
      b.force = inp?.force?.[b.id] ?? null; b.twist = inp?.spin?.[b.id] ?? 0; b.shake = inp?.shake?.[b.id] ?? 0;
      // carried from outside (a traveler): it goes there over the tick, at a speed the things it meets feel
      if (b.driven && !b.rope) { const to = inp?.drive?.[b.id]; b.v = to ? mul(sub(add(b.x0, V(to)), b.x), TPB) : [0, 0, 0]; }
    }
    // what may touch this tick: boxes that overlap, grown by how far things can go in it
    const boxes = bodies.map((b) => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      b.W.forEach((p, i) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - b.rad[i]); hi[k] = Math.max(hi[k], p[k] + b.rad[i]); } });
      const v = b.rope ? Math.max(...b.Vp.map(len)) : len(b.v) + len(b.w) * b.reach, m = (v + gl / TPB) / TPB + 0.1;
      return { lo: lo.map((x) => x - m), hi: hi.map((x) => x + m) };
    });
    const pairs = [];
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i], B = bodies[j], a = boxes[i], c = boxes[j];
      const still = (x) => x.fixed || x.sensor;
      if (A.space !== B.space || (still(A) && still(B)) || (A.sensor && B.sensor) || held.has(pair(A, B))) continue;
      if (a.lo[0] > c.hi[0] || c.lo[0] > a.hi[0] || a.lo[1] > c.hi[1] || c.lo[1] > a.hi[1] || a.lo[2] > c.hi[2] || c.lo[2] > a.hi[2]) continue;
      pairs.push([A, B]);
    }
    const hits = new Map();

    for (let s = 0; s < SUB; s++) {
      // what pushes: gravity, a force from outside, springs; then everything moves on
      const slow = Math.max(0, 1 - drag * h);
      for (const b of bodies) {
        if (b.rope) {
          b.W.forEach((p, i) => {
            b.Pp[i] = p;
            if (!b.wp[i]) return;
            let v = add(b.Vp[i], mul(g, h));
            // a signal in a wire shakes it, across the way it runs
            if (b.shake && i > 0 && i < b.W.length - 1) { const d = sub(b.W[i + 1], b.W[i - 1]), l = len(d); if (l > 1e-9) v = add(v, mul([-d[1] / l, d[0] / l, 0], b.shake * h)); }
            b.Vp[i] = mul(v, slow);
          });
        } else if (b.invM) {
          b.v = mul(add(b.v, mul(b.force ? add(g, V(b.force)) : g, h)), slow);
          b.w = mul(b.twist ? add(b.w, [0, 0, b.twist * h]) : b.w, slow);
        }
      }
      for (const J of joints) {
        if (!J.spring) continue;
        const pa = endOf(J.a, J.pa), pb = endOf(J.b, J.pb), d = sub(pb, pa), l = len(d);
        if (l < 1e-9) continue;
        const n = mul(d, 1 / l), va = J.a ? velOf(J.a, pa) : [0, 0, 0], vb = J.b ? velOf(J.b, pb) : [0, 0, 0];
        const f = (J.stiff * (l - J.rest) + J.damp * dot(sub(vb, va), n)) * h;
        if (J.a) kick(J.a, mul(n, f), pa);
        if (J.b) kick(J.b, mul(n, -f), pb);
      }
      for (const b of bodies) {
        if (b.rope) { b.W = b.W.map((p, i) => (b.wp[i] ? add(p, mul(b.Vp[i], h)) : p)); continue; }
        b.xp = b.x; b.qp = b.q;
        if (!b.invM && !b.driven) continue;
        b.x = add(b.x, mul(b.v, h));
        b.q = turn(b.q, mul(b.w, h));
        refresh(b);
      }

      // where things touch
      const runs = [];
      for (const [A, B] of pairs) { const run = []; scan(A, B, run); scan(B, A, run); if (run.length) runs.push(run); }

      for (let it = 0; it < ITER; it++) {
        for (const J of joints) {
          if (J.spring) continue;
          const pa = endOf(J.a, J.pa), pb = endOf(J.b, J.pb), d = sub(pb, pa), l = len(d);
          if (l < 1e-12) continue;
          const n = mul(d, 1 / l), wa = J.a ? wOf(J.a, n, pa) : 0, wb = J.b ? wOf(J.b, n, pb) : 0;
          if (wa + wb <= 0) continue;
          const lam = l / (wa + wb);
          if (J.a) push(J.a, mul(n, lam), pa);
          if (J.b) push(J.b, mul(n, -lam), pb);
        }
        for (const b of bodies) {
          if (!b.rope) continue;
          // from one end and then from the other, so neither end gives more than the other
          for (let pass = 0; pass < 4; pass++) for (let n = 0; n < b.rest.length; n++) {
            const i = pass % 2 ? b.rest.length - 1 - n : n, d = sub(b.W[i + 1], b.W[i]), l = len(d), w = b.wp[i] + b.wp[i + 1];
            if (l < 1e-12 || w <= 0) continue;
            const k = (l - b.rest[i]) / (l * w);
            b.W[i] = add(b.W[i], mul(d, k * b.wp[i])); b.W[i + 1] = add(b.W[i + 1], mul(d, -k * b.wp[i + 1]));
          }
        }
        // the touches of two things are answered together, each for its share: a box that lands flat
        // is not turned by whichever corner comes first in the list
        for (const run of runs) {
          const todo = [];
          for (const c of run) {
            const pa = posOf(c.a), pb = posOf(c.b), depth = c.R - dot(sub(pa, pb), c.n);
            if (depth <= 0) continue;
            const was = hits.get(c.key);
            if (!was || -c.vn > was.speed) hits.set(c.key, { a: c.a.b, b: c.b.b, at: pb, speed: Math.max(0, -c.vn) });
            if (c.sensor) continue;
            const w = wOf(c.a, c.n, pa) + wOf(c.b, c.n, pb);
            if (w > 0) todo.push([c, depth / w, pa, pb, depth]);
          }
          const k = share(todo, 4);
          for (const [c, lam, pa, pb] of todo) { const f = lam * k; push(c.a, mul(c.n, f), pa); push(c.b, mul(c.n, -f), pb); c.lam += f; }
          // it does not slide while what holds it is within what friction can bear
          const hold = [];
          let need = 0, can = 0;
          for (const [c] of todo) {
            can += c.mu * c.lam;
            const qa = posOf(c.a), qb = posOf(c.b), d = sub(sub(qa, wasAt(c.a)), sub(qb, wasAt(c.b))), dt = sub(d, mul(c.n, dot(d, c.n))), lt = len(dt);
            if (lt < 1e-12) continue;
            const t = mul(dt, 1 / lt), wt = wOf(c.a, t, qa) + wOf(c.b, t, qb);
            if (wt > 0) { hold.push([c, t, lt / wt, qa, qb]); need += lt / wt; }
          }
          if (hold.length && need / hold.length < can) for (const [c, t, lam, qa, qb] of hold) { const f = lam / hold.length; push(c.a, mul(t, -f), qa); push(c.b, mul(t, f), qb); }
        }
      }

      // the speeds that took everything where it now is
      for (const b of bodies) {
        if (b.rope) { b.Vp = b.W.map((p, i) => mul(sub(p, b.Pp[i]), 1 / h)); continue; }
        if (!b.invM) continue;
        b.v = mul(sub(b.x, b.xp), 1 / h);
        const p = b.qp, q = b.q; // q times the inverse of p: the turn made in this step
        const dx = p[3] * q[0] - q[3] * p[0] - (q[1] * p[2] - q[2] * p[1]), dy = p[3] * q[1] - q[3] * p[1] - (q[2] * p[0] - q[0] * p[2]);
        const dz = p[3] * q[2] - q[3] * p[2] - (q[0] * p[1] - q[1] * p[0]), dw = q[3] * p[3] + q[0] * p[0] + q[1] * p[1] + q[2] * p[2];
        b.w = mul([dx, dy, dz], (dw < 0 ? -2 : 2) / h);
      }
      // sliding is slowed, and what struck bounces back
      for (const run of runs) {
        const act = run.filter((c) => !c.sensor && c.lam > 0);
        if (!act.length) continue;
        const k = 1 / act.length, slide = [];
        for (const c of act) {
          const pa = posOf(c.a), pb = posOf(c.b), v = sub(velOf(c.a, pa), velOf(c.b, pb)), vt = sub(v, mul(c.n, dot(v, c.n))), lt = len(vt);
          if (lt < 1e-9) continue;
          const t = mul(vt, 1 / lt), wt = wOf(c.a, t, pa) + wOf(c.b, t, pb);
          if (wt > 0) slide.push([c, t, Math.min((c.mu * c.lam) / h, (lt / wt) * k), pa, pb]);
        }
        for (const [c, t, f, pa, pb] of slide) { kick(c.a, mul(t, -f), pa); kick(c.b, mul(t, f), pb); }
        const back = [];
        for (const c of act) {
          const pa = posOf(c.a), pb = posOf(c.b), vn = dot(sub(velOf(c.a, pa), velOf(c.b, pb)), c.n);
          const want = -c.vn > Math.max(4 * gl * h, 0.3) ? -c.e * c.vn : 0, w = wOf(c.a, c.n, pa) + wOf(c.b, c.n, pb);
          if (vn < want && w > 0) back.push([c, (want - vn) / w, pa, pb, want - vn]);
        }
        const kb = share(back, 4);
        for (const [c, f, pa, pb] of back) { kick(c.a, mul(c.n, f * kb), pa); kick(c.b, mul(c.n, -f * kb), pb); }
      }
      // a motor turns what it holds: the second about the first, or the one about the world
      for (const J of joints) {
        if (J.spring || !J.motor) continue;
        const A = J.a?.b, B = J.b?.b, one = B && !B.rope ? B : A, other = one === B ? A : null;
        if (!one || one.rope || !one.invI) continue;
        const wo = other && !other.rope ? other.invI : 0, rel = one.w[2] - (wo ? other.w[2] : 0);
        const f = Math.max(-J.torque * h, Math.min(J.torque * h, (J.motor * 6.283185307179586 - rel) / (one.invI + wo)));
        one.w = [one.w[0], one.w[1], one.w[2] + f * one.invI];
        if (wo) other.w = [other.w[0], other.w[1], other.w[2] - f * wo];
      }
    }

    tick++;
    for (const [key, hit] of hits) {
      const last = touch.get(key);
      touch.set(key, tick);
      if (last != null && tick - last <= QUIET) continue;
      const sensor = hit.a.sensor || hit.b.sensor;
      hit.a.hit = Math.max(hit.a.hit, hit.speed); hit.b.hit = Math.max(hit.b.hit, hit.speed);
      events?.push({ tick, type: sensor ? 'enter' : 'hit', a: hit.a.id, b: hit.b.id, at: hit.at, speed: hit.speed });
    }
    for (const [key, last] of touch) if (tick - last > QUIET) touch.delete(key);
    if (tick % KEEP === 0) marks.set(tick, snap());
    // a long run keeps fewer checkpoints of what is long past
    if (marks.size > 1600) for (const key of [...marks.keys()]) if (key && key < tick - 600 && key % (KEEP * 16)) marks.delete(key);
  }

  // Several touches of two things, each with the push that would answer it alone ([c, push, pa, pb, ..., want at
  // index `at`]): given all at once they answer too much, since each also moves the others. How much of
  // each to give, so that together they answer best (least squares along what they would do together).
  function share(list, at) {
    if (list.length < 2) return 1;
    const sides = list.map(([c, , pa, pb]) => [[c.a.b, sub(pa, c.a.b.x ?? pa), c.n], [c.b.b, sub(pb, c.b.b.x ?? pb), mul(c.n, -1)]].filter(([X]) => !X.rope && X.invM).map(([X, r, d]) => [X, d, cross(r, d)]));
    let top = 0, bottom = 0;
    for (let j = 0; j < list.length; j++) {
      let got = 0;
      for (let i = 0; i < list.length; i++) {
        let w = 0;
        if (i === j && !sides[i].length) w = list[i][at] / list[i][1]; // ropes: each touch on its own
        for (const [X, d, rd] of sides[i]) for (const [Y, e, re] of sides[j]) if (X === Y) w += X.invM * dot(d, e) + X.invI * dot(rd, re);
        got += list[i][1] * w;
      }
      top += list[j][at] * got; bottom += got * got;
    }
    return bottom > 1e-18 ? Math.max(0, Math.min(1, top / bottom)) : 1 / list.length;
  }

  // The points of A that are in or against B.
  function scan(A, B, out) {
    const sensor = A.sensor || B.sensor, mu = Math.sqrt(A.friction * B.friction), e = Math.max(A.bounce, B.bounce);
    for (let i = 0; i < A.W.length; i++) {
      const p = A.W[i], ra = A.rad[i];
      let best = null, gap = Infinity;
      for (const sg of B.segs) {
        const [c, t] = nearest(p, B.W[sg[0]], B.W[sg[1]]), d = len(sub(p, c));
        if (d - sg[2] < gap) { gap = d - sg[2]; best = { c, t, d, sg }; }
      }
      if (!best) continue;
      let inside = null;
      if (B.flat) for (const lp of B.loops) if (lp.solid && within(B.W, lp.start, lp.n, p)) { inside = lp; break; }
      if (inside) {
        // inside it: out by the nearest way, through the edge of the run it is inside
        best = null; gap = Infinity;
        for (const sg of B.segs) {
          if (sg[0] < inside.start || sg[0] >= inside.start + inside.n) continue;
          const [c, t] = nearest(p, B.W[sg[0]], B.W[sg[1]]), d = len(sub(p, c));
          if (d < gap) { gap = d; best = { c, t, d, sg }; }
        }
      } else if (gap - ra > 0) continue;
      if (!best || best.d < 1e-9) continue;
      const n = mul(sub(p, best.c), (inside ? -1 : 1) / best.d), rim = A.rope ? 0 : ra - skin, R = ra + best.sg[2] - rim;
      // a round thing touches at its rim, so what rubs there turns it
      const a = A.rope ? { b: A, i, j: i, t: 0 } : { b: A, l: rim > 0 ? add(A.L[i], irot(A.q, mul(n, -rim))) : A.L[i] };
      const b = B.rope ? { b: B, i: best.sg[0], j: best.sg[1], t: best.t } : { b: B, l: irot(B.q, sub(best.c, B.x)) };
      out.push({ a, b, n, R, mu, e, sensor, key: pair(A, B), lam: 0, vn: dot(sub(velOf(a, p), velOf(b, best.c)), n) });
    }
  }

  return {
    get tick() { return tick; },
    bodies: bodies.map((b) => b.id),
    // Bring the world to a tick. What happened on the way is returned (nothing, when it went back).
    to(target, inputs) {
      target = Math.max(0, Math.round(target));
      let k = -1;
      for (const key of marks.keys()) if (key <= target && key > k) k = key;
      if (target < tick || k > tick) restore(k);
      const events = [];
      while (tick < target) step(inputs?.(tick), events);
      return events;
    },
    // what is kept from this tick on is no longer true (what came from outside changed)
    forget(from) { for (const key of [...marks.keys()]) if (key > from) marks.delete(key); },
    // where everything is: id -> { x0, x, q } (a rigid body: its centre at rest, now, and how it is turned) or { pts } (a rope)
    poses() {
      const out = new Map();
      for (const b of bodies) out.set(b.id, b.rope ? { pts: b.W.map((p) => p.slice()) } : { x0: b.x0, x: b.x.slice(), q: b.q.slice() });
      return out;
    },
    // how each moves: id -> { x, y, z, vx, vy, vz, speed, spin (turns a beat), hit (how hard it was last struck this tick) }
    outs() {
      const out = new Map();
      for (const b of bodies) {
        const m = b.rope ? b.W.length >> 1 : -1, x = b.rope ? b.W[m] : b.x, v = b.rope ? b.Vp[m] : b.v;
        out.set(b.id, { x: x[0], y: x[1], z: x[2], vx: v[0], vy: v[1], vz: v[2], speed: len(v), spin: b.rope ? 0 : b.w[2] / 6.283185307179586, hit: b.hit });
      }
      return out;
    },
    // the two ends of a joint, now
    ends(id) { const J = joints.find((j) => j.id === id); return J ? [endOf(J.a, J.pa), endOf(J.b, J.pb)] : null; },
  };
}

// ---- the drawing as a scene --------------------------------------------------------------

const KINDS = { body: ['line', 'shape', 'point', 'mesh'], fixed: ['line', 'shape', 'point', 'mesh'], rope: ['line'], hinge: ['point'], weld: ['point'], spring: ['line'] };
const restPts = (o) => o.points.map((p) => [p[0] + (o.off?.[0] ?? 0), p[1] + (o.off?.[1] ?? 0), ...p.slice(2)]);
const centreOf = (o) => {
  if (o.rect) return [o.rect.cx, o.rect.cy, o.z ?? 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of restPts(o)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return [(x0 + x1) / 2, (y0 + y1) / 2, 0];
};

// objects -> { scene (for createWorld), owner: object id -> body id, carry: id -> body id (what a hinge or
// a weld rides on), springs: [{ id, pts }], driven: [{ id, body, at }], wires: [{ id, from }], bounds: space -> [x0, y0, x1, y1] }
// hooks.pointsOf(line): its points as it is shown (default: its smooth curve).
export function sceneOf(objects, hooks = {}, world = worldOf()) {
  const pointsOf = hooks.pointsOf ?? ((o) => curveOf(o, restPts(o)));
  const flat = (space) => !isTarget(objects.get(space) ?? {});
  const partsOf = (o) => {
    if (o.kind === 'line') { const pts = isWire(o) ? wirePoints(objects, o) : pointsOf(o); return [{ pts, closed: !!o.closed || (pts.length > 3 && len(sub(V(pts[0]), V(pts[pts.length - 1]))) < 1e-6) }]; }
    // a circle is a true one (a centre and a radius): it bounces and rolls evenly
    if (o.kind === 'shape' && o.shape === 'ellipse' && Math.abs(o.rect.w - o.rect.h) < 0.02 * o.rect.w) return [{ pts: [[o.rect.cx, o.rect.cy, o.z ?? 0]], closed: false, r: o.rect.w / 2 }];
    if (o.kind === 'shape') return [{ pts: outline(o.rect, o.shape).slice(0, -1), closed: true }];
    if (o.kind === 'point') return [{ pts: [[o.rect.cx, o.rect.cy, o.z ?? 0]], closed: false, r: o.rect.w / 2 }];
    if (o.kind === 'mesh') return o.faces.map((f) => ({ pts: f.map((i) => o.verts[i]), closed: true }));
    return [];
  };
  // what collides: the bodies, the ground, the ropes; and the events, which are felt and not solid
  const solid = [], parts = new Map();
  for (const o of objects.values()) {
    if (o.hidden) continue;
    const is = o.phys?.is;
    if ((is === 'body' || is === 'fixed' || is === 'rope') && KINDS[is].includes(o.kind)) { solid.push(o); parts.set(o.id, partsOf(o)); }
  }
  if (!solid.length) return null;
  const spaces = new Set(solid.map((o) => o.space ?? null));
  // what is under a point: the solid things whose outline it is in or on, lowest first
  const under = (p, space, not, tol = 0.3) => solid.filter((o) => o.id !== not && (o.space ?? null) === (space ?? null) && parts.get(o.id).some((part) => {
    const pts = part.pts.map(V), q = V(p);
    if (part.closed && flat(space) && pts.length > 2 && within(pts, 0, pts.length, q)) return true;
    if (pts.length === 1) return len(sub(pts[0], q)) <= tol + (part.r ?? 0);
    for (let i = 0; i < pts.length - (part.closed ? 0 : 1); i++) if (len(sub(q, nearest(q, pts[i], pts[(i + 1) % pts.length])[0])) <= tol) return true;
    return false;
  }));

  // welds first: what they hold is one body
  const root = new Map(solid.map((o) => [o.id, o.id])), find = (id) => { while (root.get(id) !== id) id = root.get(id); return id; };
  const carry = new Map(), grounded = new Set();
  const marks = [...objects.values()].filter((o) => !o.hidden && o.kind === 'point' && (o.phys?.is === 'hinge' || o.phys?.is === 'weld'));
  const heldBy = (o) => under([o.rect.cx, o.rect.cy, o.z ?? 0], o.space, o.id, Math.max(0.3, o.rect.w / 2)).filter((x) => x.phys.is !== 'rope' || o.phys.is === 'hinge').slice(-2);
  for (const o of marks) {
    if (o.phys.is !== 'weld') continue;
    const two = heldBy(o).filter((x) => x.phys.is !== 'rope');
    if (two.length === 2) root.set(find(two[1].id), find(two[0].id)); else if (two.length === 1) grounded.add(two[0].id);
    if (two.length) carry.set(o.id, two[0].id);
  }
  const bodies = [], owner = new Map(), byRoot = new Map(), driven = [], wires = [];
  for (const o of solid) {
    const r = find(o.id), p = physOf(o);
    let b = byRoot.get(r);
    if (!b) {
      b = { id: r, is: p.is, parts: [], flat: flat(o.space), space: o.space ?? null, density: p.density, friction: p.friction, bounce: p.bounce };
      byRoot.set(r, b); bodies.push(b);
    }
    if (p.is === 'fixed' || grounded.has(o.id)) b.is = b.is === 'rope' ? 'rope' : 'fixed';
    b.parts.push(...parts.get(o.id));
    owner.set(o.id, r);
    // carried by the score: a traveler that is physical goes where its line takes it
    if (o.role === 'traveler' && p.is !== 'rope') { b.is = 'fixed'; b.driven = true; driven.push({ id: o.id, body: r, at: centreOf(o) }); }
  }
  // events that are not solid are felt: a body reaching one fires it
  for (const o of objects.values()) {
    if (o.hidden || o.role !== 'event' || owner.has(o.id) || !spaces.has(o.space ?? null) || !KINDS.fixed.includes(o.kind)) continue;
    bodies.push({ id: o.id, is: 'fixed', sensor: true, parts: partsOf(o), flat: flat(o.space), space: o.space ?? null });
  }

  const joints = [], springs = [];
  for (const o of marks) {
    if (o.phys.is !== 'hinge') continue;
    const two = heldBy(o).map((x) => owner.get(x.id)).filter((id, i, all) => all.indexOf(id) === i), p = physOf(o);
    if (!two.length) continue;
    joints.push({ id: o.id, is: 'hinge', a: two[0], b: two[1] ?? null, at: [o.rect.cx, o.rect.cy, o.z ?? 0], motor: p.motor, torque: p.torque });
    carry.set(o.id, two[0]);
  }
  for (const o of objects.values()) {
    if (o.hidden) continue;
    // a joint of the drawing (joints.js) between physical lines holds them there; a pin, or one line alone, to the world
    if (o.kind === 'joint' && o.at?.some((q) => owner.has(q.id))) {
      const ids = o.at.map((q) => owner.get(q.id)).filter((id, i, all) => id != null && all.indexOf(id) === i), at = V(o.pos ?? [o.rect?.cx ?? 0, o.rect?.cy ?? 0]);
      if (o.fix || ids.length === 1) joints.push({ id: o.id, is: 'hinge', a: ids[0], b: null, at });
      for (let i = 1; i < ids.length; i++) joints.push({ id: o.id + (i > 1 ? '.' + i : ''), is: 'hinge', a: ids[i - 1], b: ids[i], at });
    }
    if (o.kind === 'line' && o.phys?.is === 'spring' && !o.bind) {
      const pts = restPts(o), pa = pts[0], pb = pts[pts.length - 1], p = physOf(o);
      const a = under(pa, o.space, o.id).filter((x) => x.phys.is !== 'rope').pop(), b = under(pb, o.space, o.id).filter((x) => x.phys.is !== 'rope').pop();
      if (!a && !b) continue;
      joints.push({ id: o.id, is: 'spring', a: a ? owner.get(a.id) : null, b: b ? owner.get(b.id) : null, pa, pb, stiff: p.stiff, damp: p.damp, rest: p.rest });
      springs.push({ id: o.id, pts });
    }
    // a wire that is a rope hangs between its ports: each end held to what the port is on, or to the world there
    if (isWire(o) && o.phys?.is === 'rope' && owner.has(o.id)) {
      const pts = parts.get(o.id)[0].pts;
      joints.push({ id: o.id + '.from', is: 'hinge', a: o.id, b: owner.get(o.bind.from.id) ?? null, at: pts[0] }, { id: o.id + '.to', is: 'hinge', a: o.id, b: owner.get(o.bind.to.id) ?? null, at: pts[pts.length - 1] });
      wires.push({ id: o.id, from: o.bind.from, shake: physOf(o).shake });
    }
  }
  // how far the physical things of each space reach: where in it something was struck (ev.x, ev.y)
  const bounds = new Map();
  for (const b of bodies) {
    const r = bounds.get(b.space) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (const part of b.parts) for (const p of part.pts) { r[0] = Math.min(r[0], p[0]); r[1] = Math.min(r[1], p[1]); r[2] = Math.max(r[2], p[0]); r[3] = Math.max(r[3], p[1]); }
    bounds.set(b.space, r);
  }
  return { scene: { gravity: world.gravity, drag: world.drag, skin: world.skin, bodies, joints }, owner, carry, springs, driven, wires, bounds };
}

// Where the objects are at a tick: id -> a pose (object.js: setPosed), from a world and the scene it was made from.
function posesOf(world, sc) {
  const of = world.poses(), out = new Map();
  for (const [id, body] of sc.owner) out.set(id, of.get(body));
  for (const [id, body] of sc.carry) out.set(id, of.get(body));
  for (const s of sc.springs) { const e = world.ends(s.id); if (e) out.set(s.id, { pts: fit(s.pts, e[0], e[1]) }); }
  return out;
}

// ---- the simulation of the drawing that is open (main.js steps it once a frame) ----------------

export function createSim() {
  let world = null, sc = null, version = -1, last = 0, logged = -1;
  const log = new Map(), waiting = [];
  return {
    // hooks: pointsOf, moved (where travelers are: id -> [x, y]), output(id, port) (what an object's code returned),
    //        fire(event object, ev), quant (beats: hits wait for the next division; 0: they sound at once)
    // -> { poses, outs (object id -> how it moves), tick } or null when nothing is physical
    frame(objects, ver, beat, playing, hooks) {
      if (ver !== version) {
        version = ver;
        sc = sceneOf(objects, hooks);
        world = sc ? createWorld(sc.scene) : null;
      }
      if (!world) return null;
      const tick = Math.max(0, Math.floor(beat * TPB + 1e-6));
      if (!playing && tick === 0) { log.clear(); logged = -1; waiting.length = 0; }
      // what comes from outside is taken as it is now, tick by tick, and kept: the past is as it was
      const live = playing && tick >= last && tick - last <= TPB;
      const inputs = (k) => {
        if (k <= logged || !live) return log.get(k);
        logged = k;
        const inp = {};
        for (const d of sc.driven) { const at = hooks.moved?.get(d.id); if (at) (inp.drive ??= {})[d.body] = [at[0] - d.at[0], at[1] - d.at[1], (at[2] ?? 0) - d.at[2]]; }
        for (const [id, body] of sc.owner) {
          const o = objects.get(id);
          if (!o || !hasCode(o) || o.role === 'event') continue;
          const fx = +hooks.output?.(id, 'fx') || 0, fy = +hooks.output?.(id, 'fy') || 0, spin = +hooks.output?.(id, 'spin') || 0;
          if (fx || fy) (inp.force ??= {})[body] = [fx, fy, 0];
          if (spin) (inp.spin ??= {})[body] = spin;
        }
        for (const w of sc.wires) { const v = +hooks.output?.(w.from.id, w.from.port) || 0; if (v) (inp.shake ??= {})[w.id] = v * w.shake * 60; }
        if (Object.keys(inp).length) log.set(k, inp);
        return log.get(k);
      };
      if (!live) { logged = Math.max(logged, tick); waiting.length = 0; }
      const events = world.to(tick, inputs);
      last = tick;
      if (live && hooks.fire) {
        const q = Math.round((hooks.quant ?? 0) * TPB);
        for (const e of events) waiting.push({ ...e, due: q > 0 ? Math.ceil(e.tick / q) * q : e.tick });
        for (let i = 0; i < waiting.length; i++) {
          const e = waiting[i];
          if (e.due > tick) continue;
          waiting.splice(i--, 1);
          if (e.type === 'hit' && e.speed < 0.5) continue;
          for (const [id, other] of [[e.a, e.b], [e.b, e.a]]) {
            // a welded thing answers for all it is made of: any event among them fires
            for (const o of objects.values()) {
              if (o.role !== 'event' || (o.id !== id && sc.owner.get(o.id) !== id)) continue;
              const r = sc.bounds.get(o.space ?? null) ?? [0, 0, 1, 1];
              hooks.fire(o, { type: e.type, x: r[2] > r[0] ? (e.at[0] - r[0]) / (r[2] - r[0]) : 0.5, y: r[3] > r[1] ? (e.at[1] - r[1]) / (r[3] - r[1]) : 0.5, hit: e.speed, vel: Math.max(1, Math.min(127, Math.round(24 + e.speed * 6))), body: other, at: e.at.slice(0, 2) });
            }
          }
        }
      }
      const of = world.outs(), outs = new Map();
      for (const [id, body] of sc.owner) outs.set(id, of.get(body));
      return { poses: tick > 0 ? posesOf(world, sc) : null, outs, tick };
    },
  };
}

// The drawing run on its own, with nothing from outside, to a beat: where everything is, and what
// struck what on the way. The same every time.
export function runTo(objects, beat, hooks = {}) {
  const sc = sceneOf(objects, hooks);
  if (!sc) return null;
  const world = createWorld(sc.scene), events = world.to(Math.round(beat * TPB));
  return { world, sc, events, poses: posesOf(world, sc) };
}

// ---- commands ----------------------------------------------------------------------------

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const NUMS = ['density', 'friction', 'bounce', 'shake', 'motor', 'torque', 'stiff', 'damp', 'rest'];

define({
  name: 'object.phys',
  doc: 'Make objects physical, or not. is: "body" (it falls, collides and turns), "fixed" (it stays: ground, walls; a traveler made fixed is carried along its line and pushes), "rope" (a line that hangs; a wire made a rope hangs between its ports and is shaken by what passes through it), "hinge" (a point: one thing under it is held to the world there and turns about it, two are held together), "weld" (a point: the two things under it are one), "spring" (a line: what is under its two ends is pulled together); null: not physical. Its parameters, each optional: density, friction (0 ice, 1 rubber), bounce (0..1) for a body, fixed or rope; shake for a rope; motor (turns a beat, 0 free) and torque for a hinge; stiff, damp and rest (its length at rest, as a part of its drawn length) for a spring. Leave `is` out to change parameters only. Nothing moves until the transport plays or is moved from 0; the drawing is where everything starts. An event that a body reaches fires, as for a traveler (ev.hit how hard, ev.vel as a velocity, ev.x ev.y where). The code of a physical object gets geom.body { x, y, vx, vy, speed, spin, hit } and what it returns as fx, fy, spin pushes it. sim.read says where things will be.',
  args: { ids: T.ids, is: { enum: [...Object.keys(PHYS), null] }, ...Object.fromEntries(NUMS.map((k) => [k, T.num])) }, required: ['ids'],
  run(a) {
    let n = 0;
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o) continue;
      if (a.is === null) { delete o.phys; n++; continue; }
      const is = a.is ?? o.phys?.is;
      if (!is) throw new Error(`${id} is not physical yet: say what it is (is: ${Object.keys(PHYS).join(', ')})`);
      if (!KINDS[is].includes(o.kind) || (is === 'rope' && o.closed) || o.kind === 'group') throw new Error(`${id} is a ${o.kind}: a ${is} is a ${KINDS[is].join(' or ')}` + (is === 'hinge' || is === 'weld' ? ' (point.add puts one, over what it should hold)' : ''));
      const p = { is, ...(o.phys?.is === is ? o.phys : {}) };
      for (const k of NUMS) if (k in PHYS[is] && Number.isFinite(a[k])) p[k] = k === 'bounce' ? Math.max(0, Math.min(1, a[k])) : k === 'motor' || k === 'shake' ? a[k] : Math.max(0, a[k]);
      o.phys = p; n++;
    }
    return n;
  },
  hold: (a) => a.ids ?? [],
});

define({
  name: 'sim.set',
  doc: 'Set the world everything physical is in. gravity: [x, y] in canvas units a beat squared (the default [0, -16]: a thing falls 8 units in its first beat, 2 in half a beat; [0, 0]: none). drag: how much of its speed a thing loses a beat to the air (0.05). skin: how thick an outline is where it collides (0.04). null puts one back. Time is in beats: the same scene at any tempo.',
  args: { gravity: { type: ['array', 'null'], items: { type: 'number' } }, drag: { type: ['number', 'null'] }, skin: { type: ['number', 'null'] } },
  run(a) {
    const s = { ...(state.sim ?? {}) };
    if ('gravity' in a) { if (a.gravity == null) delete s.gravity; else if (a.gravity.length >= 2 && a.gravity.every(Number.isFinite)) s.gravity = a.gravity.slice(0, 3); else throw new Error('gravity: [x, y] in numbers'); }
    for (const k of ['drag', 'skin']) if (k in a) { if (a[k] == null) delete s[k]; else if (a[k] >= 0) s[k] = k === 'skin' ? Math.max(0.005, a[k]) : a[k]; else throw new Error(`${k}: 0 or more`); }
    state.sim = s;
    return worldOf();
  },
});

define({
  name: 'sim.keep',
  doc: 'Make a moment of the simulation the drawing: everything physical is put where it is at `beat` (lines and meshes carried and turned, ropes as they hang, shapes moved to where they are, turned by quarter turns only), and that is where it now starts from. What came from outside while it played (forces from code, travelers) is not counted.',
  args: { beat: T.num }, required: ['beat'],
  run(a) {
    const r = runTo(state.objects, Math.max(0, a.beat));
    if (!r) return 0;
    let n = 0;
    for (const [id, ps] of r.poses) {
      const o = state.objects.get(id);
      if (!o || !ps || o.bind) continue;
      if (o.points) {
        const flat = o.points[0].length < 3, pts = ps.pts ?? restPts(o).map((p) => carried(ps, V(p)));
        if (pts.length !== o.points.length) delete o.pen;
        o.points = pts.map((p) => (flat ? [r4(p[0]), r4(p[1])] : p.map(r4))); o.off = [0, 0];
      } else if (o.verts && ps.q) o.verts = o.verts.map((p) => carried(ps, p).map(r4));
      else if (o.rect && ps.q) {
        const c = carried(ps, [o.rect.cx, o.rect.cy, o.z ?? 0]), quarter = Math.abs(2 * ps.q[2] * ps.q[3]) > 0.7071;
        o.rect = { cx: r4(c[0]), cy: r4(c[1]), w: quarter ? o.rect.h : o.rect.w, h: quarter ? o.rect.w : o.rect.h };
      }
      n++;
    }
    return n;
  },
});

define({
  name: 'sim.read',
  doc: 'Where the physical things are at a beat, and what struck what on the way there: the simulation run on its own from the drawing, the same every time. -> { beat, things: [{ id, x, y, turn (degrees), vx, vy, hit }], hits: [{ beat, a, b, speed, x, y, type: "hit" or "enter" (an event that is not solid) }] (the last 40) }. ids: only these.',
  args: { beat: T.num, ids: T.ids }, required: ['beat'], record: false,
  run(a) {
    const r = runTo(state.objects, Math.max(0, a.beat));
    if (!r) return { beat: a.beat, things: [], hits: [] };
    const outs = r.world.outs(), of = r.world.poses(), r2 = (v) => Math.round(v * 100) / 100, things = [];
    for (const [id, body] of r.sc.owner) {
      if (a.ids && !a.ids.includes(id)) continue;
      const o = outs.get(body), q = of.get(body).q;
      things.push({ id, x: r2(o.x), y: r2(o.y), ...(q ? { turn: r2((2 * Math.atan2(q[2], q[3]) * 180) / Math.PI) } : {}), vx: r2(o.vx), vy: r2(o.vy) });
    }
    return { beat: a.beat, things, hits: r.events.filter((e) => e.type === 'enter' || e.speed >= 0.5).slice(-40).map((e) => ({ beat: r2(e.tick / TPB), type: e.type, a: e.a, b: e.b, speed: r2(e.speed), x: r2(e.at[0]), y: r2(e.at[1]) })) };
  },
});
