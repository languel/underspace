// Binding: a drawn line whose ends land on ports becomes a wire, and stays
// one. The drawn points are kept as drawn; what is shown is those points
// carried by the similarity (move, turn, scale) that puts the first point on
// the source port and the last on the target port.

import { blanketOf, portPos, ptsOf } from './object.js';

export function fit(points, a, b) {
  const p0 = points[0], p1 = points[points.length - 1];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) return points.map((p) => [p[0] - p0[0] + a[0], p[1] - p0[1] + a[1]]);
  // (b - a) / (p1 - p0) as a complex number
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const re = (ex * dx + ey * dy) / d2, im = (ey * dx - ex * dy) / d2;
  return points.map((p) => {
    const x = p[0] - p0[0], y = p[1] - p0[1];
    return [a[0] + x * re - y * im, a[1] + x * im + y * re];
  });
}

export function nearestPort(objects, pt, side, tol) {
  let best = null;
  for (const o of objects) {
    const b = blanketOf(o);
    if (!b) continue;
    for (const name of b[side]) {
      const q = portPos(o, side, name), d = Math.hypot(q[0] - pt[0], q[1] - pt[1]);
      if (d <= tol && (!best || d < best.d)) best = { id: o.id, port: name, d };
    }
  }
  return best;
}

// The binding for a freshly drawn line, or null. A line drawn from an input
// back to an output is accepted too and reversed.
export function bindFor(objects, points, tol) {
  const p0 = points[0], p1 = points[points.length - 1];
  let from = nearestPort(objects, p0, 'outs', tol), to = nearestPort(objects, p1, 'ins', tol), pts = points;
  if (!(from && to)) {
    from = nearestPort(objects, p1, 'outs', tol); to = nearestPort(objects, p0, 'ins', tol);
    pts = [...points].reverse();
  }
  if (!from || !to || from.id === to.id) return null;
  return { bind: { from: { id: from.id, port: from.port }, to: { id: to.id, port: to.port } }, points: pts };
}

// Where a wire is now. Falls back to the drawing when a port has gone.
export function wirePoints(objects, w) {
  const src = objects.get(w.bind.from.id), dst = objects.get(w.bind.to.id);
  const a = src && portPos(src, 'outs', w.bind.from.port), b = dst && portPos(dst, 'ins', w.bind.to.port);
  return a && b ? fit(w.points, a, b) : ptsOf(w);
}
