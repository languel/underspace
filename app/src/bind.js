// Binding: a drawn line whose ends land on ports becomes a wire, and stays
// one. What is shown is a cable: a spline that leaves and arrives along the
// ports' normals (cable). The drawn points are kept as drawn, and come back
// when the wire is unbound, carried by the similarity (move, turn, scale)
// that puts the first point on the source port and the last on the target.

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

// A cable between two ports: a cubic spline that leaves the source port along its normal (ports
// out are on the right edge, so to the right) and arrives at the target port along its normal
// (ports in are on the left edge, so from the left). The handles are as long as the ports are
// far apart, and longer when the target lies behind the source, so the cable loops round
// instead of cutting through its own objects. -> n + 1 points
export function cable(a, b, n = 24) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  if (d < 1e-9) return [[a[0], a[1]], [b[0], b[1]]];
  const h = Math.max(Math.abs(dx) * 0.5, Math.min(d, Math.abs(dy)) * 0.3) + (dx < 0 ? Math.min(-dx, d) * 0.35 + Math.min(Math.abs(dy), d) * 0.2 : 0);
  const c1 = [a[0] + h, a[1]], c2 = [b[0] - h, b[1]], out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    out.push([k0 * a[0] + k1 * c1[0] + k2 * c2[0] + k3 * b[0], k0 * a[1] + k1 * c1[1] + k2 * c2[1] + k3 * b[1]]);
  }
  return out;
}

// Where a wire is now: a cable from its source port to its target port. Falls back to the
// drawing when a port has gone. The drawn points are kept (drawnWire): a wire that is unbound
// is the line that was drawn again.
export function wirePoints(objects, w) {
  const src = objects.get(w.bind.from.id), dst = objects.get(w.bind.to.id);
  const a = src && portPos(src, 'outs', w.bind.from.port), b = dst && portPos(dst, 'ins', w.bind.to.port);
  return a && b ? cable(a, b) : ptsOf(w);
}
// The line as it was drawn, carried to where its ports are now.
export function drawnWire(objects, w) {
  const src = objects.get(w.bind.from.id), dst = objects.get(w.bind.to.id);
  const a = src && portPos(src, 'outs', w.bind.from.port), b = dst && portPos(dst, 'ins', w.bind.to.port);
  return a && b ? fit(w.points, a, b) : ptsOf(w);
}
