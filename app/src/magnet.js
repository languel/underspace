// The magnet: where a point being placed in 3D lands. After threegrease
// (src/tools/snapping.ts, snapWorldPoint): one mode at a time, picked on the
// screen so it works the same at every zoom, falling back to the drawing
// plane when nothing is near.
//   point   the nearest point of a stroke (its control points)
//   edge    anywhere along a stroke (its curve as drawn): a point rides it
//   middle  the middle of the nearest stretch of a stroke
//   perp    the foot of the perpendicular from where the move began, on the nearest stretch
//   grid    a lattice in the drawing plane, in the plane's own basis (it moves a point only within the plane)
//   auto    a point, else a stroke, else the plane as it is
// Pure: the caller gives what is on screen.

export const MAGNETS = ['off', 'auto', 'point', 'edge', 'middle', 'perp', 'grid'];
export const MAGNET_TITLE = { off: 'Off', auto: 'Points, then strokes', point: 'Stroke points', edge: 'Along strokes', middle: 'Middles of stretches', perp: 'Perpendicular to a stroke', grid: 'Grid in the drawing plane' };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => [0, 1, 2].map((k) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t);

// mode, pointer [x, y] (screen), onPlane: the pointer on the drawing plane (3D), or null;
// strokes: [{ points (control points, 3D), curve (as drawn, 3D) }]; toScreen(p3) -> [x, y] | null;
// plane: { origin, u, v } (the drawing plane's basis) and cell (its lattice) for grid;
// from: where the move began (3D), for perp; radius: how near on screen (px).
// -> { point: [x, y, z], kind } | null (null: nothing to snap to, and no plane)
export function magnet({ mode, pointer, onPlane, strokes = [], toScreen, plane, cell = 0.5, from, radius = 14 }) {
  const free = onPlane ? { point: onPlane, kind: 'free' } : null;
  if (!mode || mode === 'off') return free;
  const d2 = (q) => (q ? Math.hypot(q[0] - pointer[0], q[1] - pointer[1]) : Infinity);
  if (mode === 'point' || mode === 'auto') {
    let best = null, bd = radius;
    for (const s of strokes) for (const p of s.points) { const d = d2(toScreen(p)); if (d < bd) { bd = d; best = p; } }
    if (best) return { point: [best[0], best[1], best[2] ?? 0], kind: 'point' };
    if (mode === 'point') return free;
  }
  if (mode === 'edge' || mode === 'middle' || mode === 'perp' || mode === 'auto') {
    let best = null, bd = radius;
    for (const s of strokes) {
      const c = s.curve, sc = c.map(toScreen);
      for (let i = 1; i < c.length; i++) {
        const a = sc[i - 1], b = sc[i];
        if (!a || !b) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((pointer[0] - a[0]) * dx + (pointer[1] - a[1]) * dy) / l2)) : 0;
        const d = Math.hypot(a[0] + dx * t - pointer[0], a[1] + dy * t - pointer[1]);
        if (d < bd) { bd = d; best = { a: c[i - 1], b: c[i], t }; }
      }
    }
    if (best) {
      if (mode === 'middle') return { point: lerp(best.a, best.b, 0.5), kind: 'middle' };
      if (mode === 'perp' && from) {
        const ab = sub(best.b, best.a), l2 = dot(ab, ab), t = l2 ? Math.max(0, Math.min(1, dot(sub(from, best.a), ab) / l2)) : 0;
        return { point: lerp(best.a, best.b, t), kind: 'perp' };
      }
      return { point: lerp(best.a, best.b, best.t), kind: 'edge' };
    }
    if (mode !== 'auto') return free;
    return free;
  }
  if (mode === 'grid' && onPlane && plane) return { point: onLattice(onPlane, plane, cell), kind: 'grid' };
  return free;
}

// A point of the drawing plane moved to its lattice: rounded in the plane's own two directions,
// so it stays in the plane (a tilted plane gets a tilted lattice).
export function onLattice(p, { origin = [0, 0, 0], u, v }, cell) {
  const q = sub(p, origin), a = Math.round(dot(q, u) / cell) * cell, b = Math.round(dot(q, v) / cell) * cell, off = sub(q, [0, 0, 0]);
  // what of p lies across the plane is kept (it is on the plane, so this is near nothing)
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], c = dot(off, n);
  return [0, 1, 2].map((k) => origin[k] + u[k] * a + v[k] * b + n[k] * c);
}
