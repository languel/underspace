// Joints: where curves meet, and what holds them there.
//
// After Sutherland's Sketchpad (by way of Alex Warth's reimplementation,
// github.com/alexwarth/sutherland), for curves in two and three dimensions,
// with the junctions of Midinous (by way of languel/midinojs) for travelers.
//
// A joint is an object:
//   { id, kind: 'joint', role: 'junction', space, at: [place, place, ...], pos, rect, fix?, code, params }
//   place  { id, u, slide? }: a point on a line, u how far along it (0..1, by
//          length along the curve as it is shown). With slide, u is free: the
//          place is anywhere on that line (a point held on a curve).
//   The places of a joint are held together: two lines welded where they
//   touch, or more meeting at one node. One place with `fix` is a pin, held
//   at `pos`. A joint is also a junction: when a traveler arrives, its code
//   says which way it goes on.
// A line may also keep rules of its own: `keep: { horv, length }` (its chord
// level or plumb; its chord this long).
//
// A curve keeps the shape it was drawn with. What moves when constraints are
// solved is each curve as a whole: carried, turned and scaled by the
// similarity that takes its two handles (its ends; for a closed curve, its
// start and the point farthest from it) to where they need to be, as a
// connector keeps its hand-drawn shape between two ports.
//
// Pure: no DOM, no state of its own. space.js calls settle() after each command.

import { smooth } from './object.js';

// What a junction does when a traveler arrives. Its code gets
//   ways  where the traveler can go on, straightest first:
//         { line, dir (1 forward, -1 back), turn (radians, left is +) }
//   ev    { traveler, rider, from, count, last (the last note this rider played), spb (seconds a beat) }
//   p  its parameters   mem  what it keeps
// and returns a way or its index; several (an array) to split the traveler;
// 'back' to send it back the way it came; 'stop' to stop signals and copies (a traveler placed
// by hand, a driver, carries on); 'end' to stop any traveler; nothing: straight on.
export const JUNCTIONS = {
  'round robin': `// round robin
// out: count
// each traveler that arrives takes the next way, in turn
mem.n = (mem.n ?? -1) + 1;
return mem.n % ways.length;`,
  chance: `// chance
// out: count
// param: straight 1
// param: left 1
// param: right 1
// param: back 0
// each way is taken in proportion to its weight
const kind = (w) => (Math.abs(w.turn) < 0.5 ? 'straight' : Math.abs(w.turn) > 2.6 ? 'back' : w.turn > 0 ? 'left' : 'right');
const weights = ways.map((w) => p[kind(w)]).concat(p.back);
let r = rng() * weights.reduce((a, b) => a + b, 0);
for (let i = 0; i < ways.length; i++) if ((r -= weights[i]) < 0) return i;
return p.back > 0 ? 'back' : 'stop';`,
  random: `// random
// out: count
return Math.floor(rng() * ways.length);`,
  straight: `// straight
// out: count
// straight on where it can, otherwise the gentlest turn
return 0;`,
  split: `// split
// out: count
// the traveler goes every way at once
return ways.map((w, i) => i);`,
  reflect: `// reflect
// out: count
return 'back';`,
  stop: `// stop
// out: count
// stops every traveler, drivers too ('stop' would stop only signals and copies)
return 'end';`,
  every: `// every
// out: count
// param: n 2
// straight on, but every nth traveler turns
return ev.count % p.n === 0 ? ways.length - 1 : 0;`,
};
export const JUNCTION = JUNCTIONS['round robin'];

export const isCurve = (o) => o?.kind === 'line' && !o.bind && o.role !== 'traveler' && o.points?.length > 1;
export const isJoint = (o) => o?.kind === 'joint';

// ---- curves -----------------------------------------------------------------

// The curve a line is shown as: what travelers follow and places sit on.
export function curveOf(o, pts) {
  if (o.style?.path === 'straight' || o.closed) return pts;
  return smooth(pts); // flat or 3D, a fixed six pieces a stretch: what travel and joints measure does not change with zoom
}

const v3 = (p) => [p[0], p[1], p[2] ?? 0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// A path measured: its points (3D), how far along each is, its length.
export function measure(path) {
  const p = path.map(v3), cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + len(sub(p[i], p[i - 1])));
  return { p, cum, total: cum[cum.length - 1] };
}
// The point at distance s along a measured path.
export function atS(m, s) {
  const { p, cum, total } = m;
  if (p.length < 2 || !(total > 0)) return p[0].slice();
  s = Math.max(0, Math.min(total, s));
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
  const span = cum[lo] - cum[lo - 1], f = span ? (s - cum[lo - 1]) / span : 0;
  return add(p[lo - 1], mul(sub(p[lo], p[lo - 1]), f));
}
export const atU = (m, u) => atS(m, u * m.total);
// The direction of travel at s (unit, 3D).
export function tangentS(m, s) {
  const e = Math.max(1e-4, m.total * 1e-3), d = sub(atS(m, s + e), atS(m, s - e)), l = len(d);
  return l ? mul(d, 1 / l) : [1, 0, 0];
}
// How far along (0..1) the point of a measured path nearest q is.
export function nearestOn(m, q) {
  q = v3(q);
  let best = 0, bestD = Infinity;
  for (let i = 1; i < m.p.length; i++) {
    const a = m.p[i - 1], d = sub(m.p[i], a), l2 = dot(d, d), k = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), d) / l2)) : 0;
    const dd = len(sub(q, add(a, mul(d, k))));
    if (dd < bestD) { bestD = dd; best = m.cum[i - 1] + k * (m.cum[i] - m.cum[i - 1]); }
  }
  return m.total > 0 ? best / m.total : 0;
}

// Where two flat curves cross: [{ ua, ub, at }], u how far along each.
export function crossings(pa, pb) {
  const ma = measure(pa), mb = measure(pb), out = [];
  for (let i = 1; i < pa.length; i++) {
    const a0 = pa[i - 1], a1 = pa[i];
    for (let j = 1; j < pb.length; j++) {
      const b0 = pb[j - 1], b1 = pb[j], r = [a1[0] - a0[0], a1[1] - a0[1]], s = [b1[0] - b0[0], b1[1] - b0[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) continue;
      const qp = [b0[0] - a0[0], b0[1] - a0[1]], t = (qp[0] * s[1] - qp[1] * s[0]) / den, w = (qp[0] * r[1] - qp[1] * r[0]) / den;
      if (t < 0 || t > 1 || w < 0 || w > 1) continue;
      const ua = (ma.cum[i - 1] + t * (ma.cum[i] - ma.cum[i - 1])) / (ma.total || 1), ub = (mb.cum[j - 1] + w * (mb.cum[j] - mb.cum[j - 1])) / (mb.total || 1);
      if (out.some((c) => Math.abs(c.ua - ua) < 1e-6 && Math.abs(c.ub - ub) < 1e-6)) continue;
      out.push({ ua, ub, at: [a0[0] + r[0] * t, a0[1] + r[1] * t] });
    }
  }
  return out;
}

// The same in three dimensions, where curves seldom cross exactly: where two come within tol
// of each other (the nearest places of each pair of stretches; one crossing for each near pass).
export function crossings3d(pa, pb, tol = 0.05) {
  const ma = measure(pa), mb = measure(pb), out = [];
  for (let i = 1; i < pa.length; i++) {
    const a0 = v3(pa[i - 1]), d1 = sub(v3(pa[i]), a0);
    for (let j = 1; j < pb.length; j++) {
      const b0 = v3(pb[j - 1]), d2 = sub(v3(pb[j]), b0), r = sub(a0, b0);
      const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
      let t = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      let w = e > 1e-12 ? Math.max(0, Math.min(1, (b * t + f) / e)) : 0;
      t = a > 1e-12 ? Math.max(0, Math.min(1, (b * w - c) / a)) : 0;
      const p = add(a0, mul(d1, t)), q = add(b0, mul(d2, w)), d = len(sub(p, q));
      if (d > tol) continue;
      const ua = (ma.cum[i - 1] + t * (ma.cum[i] - ma.cum[i - 1])) / (ma.total || 1), ub = (mb.cum[j - 1] + w * (mb.cum[j] - mb.cum[j - 1])) / (mb.total || 1);
      const near = out.find((x) => len(sub(x.at, p)) < tol * 2);
      if (near) { if (d < near.d) Object.assign(near, { ua, ub, at: p, d }); continue; }
      out.push({ ua, ub, at: p, d });
    }
  }
  return out;
}

// ---- the similarity that carries a curve ------------------------------------

// The rotation taking unit a to unit b, applied to p (Rodrigues; the least turn).
function turn(a, b, p) {
  const c = dot(a, b);
  if (c > 1 - 1e-12) return p;
  if (c < -1 + 1e-12) { // half a turn, about any axis across a
    const k = Math.abs(a[2]) < 0.9 ? cross(a, [0, 0, 1]) : cross(a, [1, 0, 0]), n = mul(k, 1 / len(k));
    return sub(mul(n, 2 * dot(n, p)), p);
  }
  const k = cross(a, b);
  return add(add(p, cross(k, p)), mul(cross(k, cross(k, p)), 1 / (1 + c)));
}
// p' = A2 + s * R * (p - A), taking A to A2 and B to B2.
function carry(A, B, A2, B2) {
  const d1 = sub(B, A), d2 = sub(B2, A2), l1 = len(d1), l2 = len(d2);
  if (!(l1 > 1e-9) || !(l2 > 1e-9)) { const t = sub(A2, A); return { to: (p) => add(p, t), back: (p) => sub(p, t) }; }
  const a = mul(d1, 1 / l1), b = mul(d2, 1 / l2), s = l2 / l1;
  return { to: (p) => add(A2, mul(turn(a, b, sub(p, A)), s)), back: (p) => add(A, mul(turn(b, a, sub(p, A2)), 1 / s)) };
}

// A line as it rests when solving begins: its points, its curve, its two handles.
function restOf(o, pts) {
  const raw = pts.map(v3), m = measure(curveOf(o, pts));
  let iB = raw.length - 1;
  if (len(sub(raw[iB], raw[0])) < 1e-6 * (m.total || 1)) { // ends that meet: the point farthest from the start
    let far = 0;
    raw.forEach((p, i) => { const d = len(sub(p, raw[0])); if (d > far) { far = d; iB = i; } });
  }
  return { o, dim: pts[0].length > 2 ? 3 : 2, raw, m, A: raw[0], B: raw[iB] };
}

// ---- solving ------------------------------------------------------------------

const TOL = 1e-3; // a constraint this close is kept (canvas units)

// The target of a held joint: where it was put.
const posOf = (j, rectOf = (o) => o.rect) => { const r = rectOf(j); return r ? [r.cx, r.cy, j.pos?.[2] ?? 0] : v3(j.pos ?? [0, 0, 0]); };

// solve(objects, { hold, pts, rect }) -> { points: id -> new points, joints: id -> { pos, us } }
//   hold  ids that were just moved: they stay where they are, and the rest gives way
//   pts   o -> its points as they are now (offsets applied); rect o -> its rectangle now
// Pure: the objects are not changed.
export function solve(objects, { hold = new Set(), pts = (o) => o.points, rect } = {}) {
  const rests = new Map();
  const R = (id) => {
    if (!rests.has(id)) { const o = objects.get(id); rests.set(id, isCurve(o) ? restOf(o, pts(o)) : null); }
    return rests.get(id);
  };
  // the constraints, each over the lines it touches
  const cons = [], jointPlaces = [];
  for (const j of objects.values()) {
    if (!isJoint(j)) continue;
    const places = (j.at ?? []).filter((q) => R(q.id) && objects.get(q.id).space === j.space).map((q, k) => ({ q, k, r: R(q.id) }));
    jointPlaces.push({ j, places });
    if (!places.length) continue;
    if (hold.has(j.id) || j.fix) { const target = posOf(j, rect); for (const pl of places) cons.push({ type: 'at', pl, target, ids: [pl.q.id] }); continue; }
    // the place that does not slide is where the others meet
    const anchor = places.find((pl) => !pl.q.slide) ?? places[0];
    for (const pl of places) if (pl !== anchor && pl.q.id !== anchor.q.id) cons.push({ type: 'join', a: anchor, b: pl, ids: [anchor.q.id, pl.q.id] });
  }
  for (const o of objects.values()) {
    if (!isCurve(o) || !o.keep) continue;
    const r = R(o.id), c = sub(r.B, r.A);
    if (o.keep.horv) cons.push({ type: 'horv', r, axis: Math.abs(c[0]) < Math.abs(c[1]) ? 0 : 1, ids: [o.id] });
    if (o.keep.length > 0) cons.push({ type: 'length', r, L: o.keep.length, ids: [o.id] });
  }

  // lines joined by constraints solve together
  const up = new Map(), find = (a) => { while (up.get(a) !== a) { up.set(a, up.get(up.get(a))); a = up.get(a); } return a; };
  for (const c of cons) for (const id of c.ids) if (!up.has(id)) up.set(id, id);
  for (const c of cons) for (let i = 1; i < c.ids.length; i++) up.set(find(c.ids[i]), find(c.ids[0]));
  const groups = new Map();
  for (const c of cons) { const g = find(c.ids[0]); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }

  const ends = new Map(); // id -> [A2, B2] for lines that moved
  const us = new Map();   // a sliding place -> its new u
  for (const group of groups.values()) {
    const free = [...new Set(group.flatMap((c) => c.ids))].filter((id) => !hold.has(id));
    const x0 = [];
    for (const id of free) { const r = R(id); x0.push(...r.A.slice(0, r.dim), ...r.B.slice(0, r.dim)); }
    const slot = new Map();
    let n = 0;
    for (const id of free) { slot.set(id, n); n += R(id).dim * 2; }
    // each line's similarity for a given x
    const carriers = (x) => {
      const out = new Map();
      for (const c of group) for (const id of c.ids) {
        if (out.has(id)) continue;
        const r = R(id), i = slot.get(id);
        if (i == null) { out.set(id, carry(r.A, r.B, r.A, r.B)); continue; }
        const A2 = v3(x.slice(i, i + r.dim)), B2 = v3(x.slice(i + r.dim, i + 2 * r.dim));
        out.set(id, carry(r.A, r.B, A2, B2));
      }
      return out;
    };
    const placeAt = (S, pl, near) => {
      const sim = S.get(pl.q.id), m = pl.r.m;
      if (pl.q.slide && near) { const u = nearestOn(m, sim.back(near)); us.set(pl.q, u); return sim.to(atU(m, u)); }
      return sim.to(atU(m, pl.q.u));
    };
    const residual = (x, w) => {
      const S = carriers(x), r = [];
      for (const c of group) {
        if (c.type === 'join') { const a = placeAt(S, c.a), b = placeAt(S, c.b, a); r.push(...sub(a, b)); }
        else if (c.type === 'at') r.push(...sub(placeAt(S, c.pl, c.target), c.target));
        else {
          const s = S.get(c.r.o.id), A = s.to(c.r.A), B = s.to(c.r.B), d = sub(B, A);
          r.push(c.type === 'horv' ? d[c.axis] : len(d) - c.L);
        }
      }
      for (let i = 0; i < x.length; i++) r.push(w * (x[i] - x0[i]));
      return r;
    };
    const worst = (x) => { const r = residual(x, 0); let m = 0; for (let i = 0; i < r.length - x.length; i++) m = Math.max(m, Math.abs(r[i])); return m; };
    if (!n || worst(x0) < TOL) continue;
    const x = lm((x) => residual(x, 1e-3), x0);
    worst(x); // leaves each sliding place at its last u
    for (const id of free) { const r = R(id), i = slot.get(id); ends.set(id, [v3(x.slice(i, i + r.dim)), v3(x.slice(i + r.dim, i + 2 * r.dim))]); }
  }

  const points = new Map();
  const simOf = (id) => { const r = R(id), e = ends.get(id); return e ? carry(r.A, r.B, e[0], e[1]) : null; };
  for (const id of ends.keys()) {
    const r = R(id), s = simOf(id), p0 = pts(r.o);
    points.set(id, r.raw.map((p, i) => [...s.to(p).slice(0, r.dim), ...p0[i].slice(r.dim)]));
  }
  // every joint goes to where its places now are
  const joints = new Map();
  for (const { j, places } of jointPlaces) {
    const usNow = places.map((pl) => us.get(pl.q) ?? pl.q.u);
    if (!places.length) continue;
    const pl = places[0], s = simOf(pl.q.id) ?? carry(pl.r.A, pl.r.B, pl.r.A, pl.r.B);
    const at = hold.has(j.id) || j.fix ? posOf(j, rect) : s.to(atU(pl.r.m, usNow[0]));
    joints.set(j.id, { pos: at.slice(0, pl.r.dim), us: (j.at ?? []).map((q) => us.get(q) ?? q.u) });
  }
  return { points, joints };
}

// Levenberg-Marquardt on a residual function, with numerical derivatives.
function lm(f, x0, iterations = 60) {
  let x = x0.slice(), r = f(x), cost = dot2(r), mu = 1e-3;
  const n = x.length;
  for (let it = 0; it < iterations && cost > 1e-14; it++) {
    const J = [];
    for (let i = 0; i < n; i++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[i])), xi = x[i];
      x[i] = xi + h; const ri = f(x); x[i] = xi;
      J.push(ri.map((v, k) => (v - r[k]) / h));
    }
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, k) => { let s = 0; for (let m = 0; m < r.length; m++) s += J[i][m] * J[k][m]; return s; }));
    const g = Array.from({ length: n }, (_, i) => { let s = 0; for (let m = 0; m < r.length; m++) s += J[i][m] * r[m]; return -s; });
    let improved = false;
    while (mu < 1e10) {
      const M = A.map((row, i) => row.map((v, k) => (i === k ? v * (1 + mu) + 1e-12 : v)));
      const d = gauss(M, g.slice());
      if (!d) { mu *= 10; continue; }
      const xn = x.map((v, i) => v + d[i]), rn = f(xn), cn = dot2(rn);
      if (cn < cost) { x = xn; r = rn; cost = cn; mu = Math.max(1e-9, mu * 0.3); improved = true; break; }
      mu *= 10;
    }
    if (!improved) break;
  }
  return x;
}
const dot2 = (r) => { let s = 0; for (const v of r) s += v * v; return s; };
function gauss(M, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-18) return null;
    [M[c], M[p]] = [M[p], M[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let i = c + 1; i < n; i++) { const f = M[i][c] / M[c][c]; if (!f) continue; for (let k = c; k < n; k++) M[i][k] -= f * M[c][k]; b[i] -= f * b[c]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
// Solve, and write the result into the objects. space.js calls this after every command.
export function settle(objects, hold, pts) {
  if (![...objects.values()].some((o) => isJoint(o) || o.keep)) return;
  const { points, joints } = solve(objects, { hold, pts });
  for (const [id, p] of points) { const o = objects.get(id); o.points = p.map((q) => q.map(r4)); o.off = [0, 0]; }
  for (const [id, { pos, us }] of joints) {
    const j = objects.get(id);
    j.pos = pos.map(r4);
    j.rect = { cx: j.pos[0], cy: j.pos[1], w: 0, h: 0 };
    us.forEach((u, k) => { if (j.at[k]) j.at[k].u = r4(Math.max(0, Math.min(1, u))); });
  }
}

// ---- junctions, for travelers ----------------------------------------------------

// The joints on a line, with where each sits on it: [{ j, u }].
export function jointsOn(objects, id) {
  const out = [];
  for (const j of objects.values()) if (isJoint(j)) for (const q of j.at ?? []) if (q.id === id) out.push({ j, u: q.u });
  return out;
}

// Where a traveler can go from joint j, arriving on line `from` going `dir`
// with heading `t` (unit). measureOf(id) -> the measured curve of a line.
// Straightest first; turning back the way it came only when there is nothing else.
export function waysAt(j, from, dir, t, measureOf) {
  const out = [];
  for (const q of j.at ?? []) {
    const m = measureOf(q.id);
    if (!m) continue;
    for (const d of [1, -1]) {
      if ((d > 0 && q.u >= 1 - 1e-6) || (d < 0 && q.u <= 1e-6)) continue; // no way on past an end
      if (q.id === from && d === -dir) continue;
      const h = mul(tangentS(m, q.u * m.total), d), c = dot(t, h), side = t[0] * h[1] - t[1] * h[0];
      out.push({ line: q.id, u: q.u, dir: d, turn: Math.atan2(side, c) });
    }
  }
  out.sort((a, b) => Math.abs(a.turn) - Math.abs(b.turn));
  return out;
}
