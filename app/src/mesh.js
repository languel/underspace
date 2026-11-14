// Meshes: what Poly Build makes (after threegrease's Poly Build and PolyQuilt,
// src/tools/polytool.ts there), reduced to its core. A mesh lives in a render
// target: { kind: 'mesh', verts: [[x, y, z]], faces: [[i, j, k, ...]] }. A
// vertex shared by faces is one vertex (welded); a vertex no face uses is a
// loose point, the start of a face being built. Pure: no DOM.

// Every edge once, as [i, j] with i < j, and how many faces use it.
export function edgesOf(faces) {
  const m = new Map();
  for (const f of faces) for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length], key = a < b ? `${a},${b}` : `${b},${a}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m].map(([key, n]) => { const [a, b] = key.split(',').map(Number); return { a, b, faces: n }; });
}
// The edges on the rim: used by one face only (where a face can be added).
export const boundary = (faces) => edgesOf(faces).filter((e) => e.faces === 1);

// Vertices closer than tol become one; faces that collapse (a repeated vertex) lose it, and
// faces with fewer than three left go. -> { verts, faces, map } (map: old index -> new)
export function weld(verts, faces, tol = 1e-4) {
  const out = [], map = [];
  verts.forEach((v, i) => {
    const j = out.findIndex((w) => Math.hypot(w[0] - v[0], w[1] - v[1], (w[2] ?? 0) - (v[2] ?? 0)) <= tol);
    if (j >= 0) map[i] = j; else { map[i] = out.length; out.push(v.slice()); }
  });
  const fs = faces.map((f) => f.map((i) => map[i]).filter((i, k, a) => i !== a[(k + a.length - 1) % a.length])).filter((f) => new Set(f).size >= 3);
  return { verts: out, faces: fs, map };
}

// A quad grown from the edge a-b, its far side moved by d: two new vertices and the face.
// The face winds against the face the edge already has, so the two sit side by side.
export function extrude(verts, faces, a, b, d) {
  const v = verts.slice(), na = v.length, nb = na + 1;
  v.push([0, 1, 2].map((k) => (verts[a][k] ?? 0) + d[k]), [0, 1, 2].map((k) => (verts[b][k] ?? 0) + d[k]));
  const owner = faces.find((f) => f.some((x, k) => (x === a && f[(k + 1) % f.length] === b)));
  const quad = owner ? [b, a, na, nb] : [a, b, nb, na];
  return { verts: v, faces: [...faces, quad] };
}

// The centre of a face, and its normal (Newell's), for showing it and moving along it.
export function faceNormal(verts, f) {
  const n = [0, 0, 0];
  f.forEach((i, k) => { const a = verts[i], b = verts[f[(k + 1) % f.length]]; n[0] += (a[1] - b[1]) * ((a[2] ?? 0) + (b[2] ?? 0)); n[1] += ((a[2] ?? 0) - (b[2] ?? 0)) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); });
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}
