// Edit operations on points: what the points tool does to the points that
// are picked, the same for a line on the canvas, a stroke in a target and a
// mesh's corners. After threegrease (src/tools/editops.ts, polyops.ts),
// reduced to the ones that read as drawing: add points between, cut, join,
// take away, merge, fill. Pure: points in, points out.
//
// A line is { points, pen? } (pen: one [ms, pressure] per point, or absent);
// a mesh is { verts, faces }. `idx` is the picked indices.

import { stretches } from './object.js';

const lerp = (a, b, t) => a.map((v, k) => v + ((b[k] ?? v) - v) * t);
const penOK = (points, pen) => (pen && pen.length === points.length ? pen : null);

// A point added between every two picked points that are next to each other (on the curve when
// the line is smooth). -> { points, pen, picked } (picked: the old picks and the new points), or null.
export function subdivide(points, pen, idx, { closed = false, curved = true } = {}) {
  const on = new Set(idx), n = points.length, out = [], outPen = [], picked = [];
  pen = penOK(points, pen);
  const mids = curved && n > 2 ? stretches(points, 2) : null;
  let added = 0;
  for (let i = 0; i < n; i++) {
    if (on.has(i)) picked.push(out.length);
    out.push(points[i]); if (pen) outPen.push(pen[i]);
    const j = i + 1 < n ? i + 1 : closed ? 0 : -1;
    if (j < 0 || !on.has(i) || !on.has(j)) continue;
    const m = mids?.[i]?.[1];
    picked.push(out.length);
    out.push(m ? [...m, ...points[i].slice(m.length)] : lerp(points[i], points[j], 0.5));
    if (pen) outPen.push(lerp(pen[i], pen[j], 0.5));
    added++;
  }
  return added ? { points: out, pen: pen ? outPen : null, picked } : null;
}

// The line cut at its picked points: each piece ends on one and the next begins on it. A closed
// line is opened at the first. -> [{ points, pen }] (one piece: only opened), or null.
export function cut(points, pen, idx, { closed = false } = {}) {
  pen = penOK(points, pen);
  let at = [...new Set(idx)].sort((a, b) => a - b);
  if (!at.length) return null;
  if (closed) { // turn it so it starts at the first picked point, and ends there too
    const k = at[0], turn = (list) => [...list.slice(k), ...list.slice(0, k), list[k]];
    points = turn(points); pen = pen && turn(pen);
    at = at.slice(1).map((i) => i - k);
  } else at = at.filter((i) => i > 0 && i < points.length - 1);
  if (!at.length && !closed) return null;
  const out = [];
  let from = 0;
  for (const i of [...at, points.length - 1]) {
    out.push({ points: points.slice(from, i + 1).map((p) => p.slice()), pen: pen ? pen.slice(from, i + 1) : null });
    from = i;
  }
  return out;
}

// Two open lines made one, joined at the picked end of each. -> { points, pen } or null
// (null when a picked point is not an end).
export function join(a, ia, b, ib) {
  const end = (l, i) => (i === 0 ? 'first' : i === l.points.length - 1 ? 'last' : null), ea = end(a, ia), eb = end(b, ib);
  if (!ea || !eb) return null;
  const pa = penOK(a.points, a.pen), pb = penOK(b.points, b.pen), both = pa && pb;
  const A = ea === 'last' ? a.points : [...a.points].reverse(), B = eb === 'first' ? b.points : [...b.points].reverse();
  const PA = both && (ea === 'last' ? pa : [...pa].reverse()), PB = both && (eb === 'first' ? pb : [...pb].reverse());
  const same = Math.hypot(...A[A.length - 1].map((v, k) => v - (B[0][k] ?? 0))) < 1e-6; // the ends sit together: one point
  return { points: [...A, ...B.slice(same ? 1 : 0)], pen: both ? [...PA, ...PB.slice(same ? 1 : 0)] : null };
}

// ---- meshes -----------------------------------------------------------------

const reindex = (verts, faces, keep) => {
  const map = new Map();
  const vs = [];
  verts.forEach((v, i) => { if (keep(i)) { map.set(i, vs.length); vs.push(v); } });
  return { verts: vs, faces: faces.map((f) => f.map((i) => map.get(i))), map };
};
// Corners taken away, with every face that used one.
export function removeVerts(verts, faces, idx) {
  const gone = new Set(idx);
  return reindex(verts, faces.filter((f) => !f.some((i) => gone.has(i))), (i) => !gone.has(i));
}
// Corners taken away, the faces keeping the corners they have left (a face left with two goes).
export function dissolveVerts(verts, faces, idx) {
  const gone = new Set(idx);
  return reindex(verts, faces.map((f) => f.filter((i) => !gone.has(i))).filter((f) => f.length >= 3), (i) => !gone.has(i));
}
// A corner added in the middle of every edge whose two ends are picked. -> { verts, faces, picked } or null
export function subdivideEdges(verts, faces, idx) {
  const on = new Set(idx), vs = verts.map((v) => v.slice()), mid = new Map(), picked = [...on];
  const fs = faces.map((f) => {
    const out = [];
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      out.push(a);
      if (!on.has(a) || !on.has(b)) return;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mid.has(key)) { mid.set(key, vs.length); picked.push(vs.length); vs.push(lerp(verts[a], verts[b], 0.5)); }
      out.push(mid.get(key));
    });
    return out;
  });
  return mid.size ? { verts: vs, faces: fs, picked } : null;
}
// The picked corners become one, at their middle. -> { verts, faces, picked: [the one] } or null
export function mergeVerts(verts, faces, idx) {
  const at = [...new Set(idx)].sort((a, b) => a - b);
  if (at.length < 2) return null;
  const c = [0, 1, 2].map((k) => at.reduce((t, i) => t + (verts[i][k] ?? 0), 0) / at.length), first = at[0], rest = new Set(at.slice(1));
  const moved = verts.map((v, i) => (i === first ? c : v));
  const fs = faces.map((f) => f.map((i) => (rest.has(i) ? first : i)).filter((i, k, a) => i !== a[(k + a.length - 1) % a.length])).filter((f) => new Set(f).size >= 3);
  const r = reindex(moved, fs, (i) => !rest.has(i));
  return { verts: r.verts, faces: r.faces, picked: [r.map.get(first)] };
}
// A face through the picked corners, in the order that goes round their middle. -> { faces } or null
// (null: fewer than three, or that face is there already).
export function fill(verts, faces, idx) {
  const at = [...new Set(idx)];
  if (at.length < 3) return null;
  const P = at.map((i) => [0, 1, 2].map((k) => verts[i][k] ?? 0)), c = [0, 1, 2].map((k) => P.reduce((t, p) => t + p[k], 0) / P.length);
  // the plane they lie nearest: its normal from the corners taken in pairs around the middle
  const n = [0, 0, 0];
  P.forEach((p, i) => { const q = P[(i + 1) % P.length], a = p.map((v, k) => v - c[k]), b = q.map((v, k) => v - c[k]); n[0] += a[1] * b[2] - a[2] * b[1]; n[1] += a[2] * b[0] - a[0] * b[2]; n[2] += a[0] * b[1] - a[1] * b[0]; });
  let nl = Math.hypot(...n);
  if (nl < 1e-9) { // the pairs cancel (corners picked in a crossing order): the normal of the first three
    const a = P[1].map((v, k) => v - P[0][k]), b = P[2].map((v, k) => v - P[0][k]);
    n[0] = a[1] * b[2] - a[2] * b[1]; n[1] = a[2] * b[0] - a[0] * b[2]; n[2] = a[0] * b[1] - a[1] * b[0]; nl = Math.hypot(...n);
    if (nl < 1e-9) return null;
  }
  const N = n.map((v) => v / nl), u0 = P[0].map((v, k) => v - c[k]), ul = Math.hypot(...u0) || 1, U = u0.map((v) => v / ul);
  const V = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
  const ang = P.map((p) => { const d = p.map((v, k) => v - c[k]); return Math.atan2(d[0] * V[0] + d[1] * V[1] + d[2] * V[2], d[0] * U[0] + d[1] * U[1] + d[2] * U[2]); });
  const face = at.map((i, k) => [i, ang[k]]).sort((a, b) => a[1] - b[1]).map(([i]) => i), key = (f) => [...f].sort((a, b) => a - b).join();
  if (faces.some((f) => key(f) === key(face))) return null;
  return { faces: [...faces, face] };
}
