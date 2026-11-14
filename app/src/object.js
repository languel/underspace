// The object: geometry, role, blanket, interior. Pure functions over records.
//
//   { id, space, kind, role, ... }
//
//   kind 'line'    points [[x, y] or [x, y, z], ...], off, closed?,
//                  pen? [[ms, pressure], ...] the hand that drew each point
//        role 'ink'        just a drawing
//             'connector'  bind { from: { id, port }, to: { id, port } }
//             'path'       code that reads its own geometry
//   kind 'shape'   rect { cx, cy, w, h }, shape 'rect' | 'ellipse'
//        role 'visual'     something to look at
//             'target'     a render target: its interior is a 3D space
//             'code'       a code container
//             'score'      a frame that reads the lines in it as sound; its code is a brush
//             'note'       text on the canvas (`text`)
//             'event'      a region that fires when a traveler enters; its code says what happens
//             'traveler'   moves along the line `on` (see play.js)
//   kind 'group'   rect, inner (its interior frame), ports (the cut wires)
//   kind 'joint'   where lines meet: at [{ id, u, slide? }, ...], pos, rect (see joints.js)
//        role 'junction'   its code says which way a traveler goes on
// A line can also be an 'event' (crossing it, or entering what it encloses,
// fires it) or a 'traveler' (it moves along the line `on`, keeping its shape).
//
// Any object may carry `name`, `style` { stroke, fill, width, opacity, path }
// (path 'straight' draws a line through its points as they are; otherwise
// it is drawn as a smooth curve),
// `hidden` and `locked`, and `brush` { id, params }: an ink brush that draws
// it (ink/brushes.js) instead of a plain line.
// Code objects (path, code) carry `code` and `params`; the blanket is declared
// in the code's header. Coordinates are local to the object's space (y up);
// `space` is the id of the group or target it lives in, or null for the canvas.

export const ROLES = { joint: ['junction'], line: ['ink', 'connector', 'path', 'event', 'traveler'], shape: ['visual', 'target', 'code', 'score', 'note', 'event', 'traveler'] };
export const isLine = (o) => o.kind === 'line';
export const isTarget = (o) => o.kind === 'shape' && o.role === 'target';
export const hasCode = (o) => o.role === 'code' || o.role === 'path' || o.role === 'score' || o.role === 'event' || o.role === 'junction';
// A traveler has no code of its own; this declares its ports and parameters.
// loop: 0 once, 1 loop, 2 there and back. start: where on the line it begins (0..1).
// dur: beats for the whole line (at the music context's tempo); at: the beat it sets off on;
// speed: grid cells a beat (Midinous: distance is time), 0 to use dur instead;
// drawn: above 0, it goes at the pace the hand drew the line (1 as drawn, 2 twice as fast).
export const TRAVELER = '// traveler\n// out: x y u\n// param: dur 8\n// param: loop 1\n// param: start 0\n// param: at 0\n// param: speed 0\n// param: drawn 0';
export const isWire = (o) => o.role === 'connector' && !!o.bind;

const parsed = new Map();

// The blanket of a code object is read from its header comments:
//   // osc            first plain comment: the name
//   // in: a b
//   // out: y
//   // param: hz 0.25
export function parseBlanket(code) {
  let b = parsed.get(code);
  if (b) return b;
  b = { name: '', ins: [], outs: [], params: [] };
  for (const line of code.split('\n')) {
    const c = line.match(/^\s*\/\/\s*(.*)$/);
    if (!c) { if (line.trim()) break; continue; }
    const m = c[1].match(/^(in|out|param)\s*:\s*(.*)$/);
    if (!m) { if (!b.name) b.name = c[1].trim(); continue; }
    // names only; anything else on the line (a note in brackets) is ignored
    const words = m[2].trim().split(/[\s,=]+/).filter((w) => /^[A-Za-z_$][\w$]*$|^-?[\d.]+$/.test(w));
    if (m[1] === 'in') b.ins.push(...words);
    else if (m[1] === 'out') b.outs.push(...words);
    else if (words[0]) b.params.push({ name: words[0], value: Number(words[1]) || 0 });
  }
  if (parsed.size > 500) parsed.clear();
  parsed.set(code, b);
  return b;
}

export const TARGET_INS = ['spin', 'tilt'];

// null when the object has no blanket (ink, a visual, an unbound connector).
export function blanketOf(o) {
  if (isTarget(o)) return { name: 'target', ins: TARGET_INS, outs: [], params: [] };
  if (o.kind === 'group') return { name: o.name || 'group', ins: o.ports.ins.map((p) => p.name), outs: o.ports.outs.map((p) => p.name), params: [] };
  if (o.role === 'traveler') return parseBlanket(TRAVELER);
  if (hasCode(o) && o.code != null) return parseBlanket(o.code);
  return null;
}

// A move or resize in progress is shown before it is committed as a command.
let drag = null;
export function setDrag(d) { drag = d; }
const dragOf = (o) => (drag && drag.ids.has(o.id) ? drag : null);

// A sculpt stroke in progress: id -> { points, pen }, shown until it is committed.
let live = null;
export function setLive(map) { live = map; }
export const penOf = (o) => live?.get(o.id)?.pen ?? o.pen;

export function ptsOf(o) {
  const now = live?.get(o.id);
  if (now) return now.points;
  // A line that travels is shown where playing has carried it, keeping its own shape.
  const go = o.role === 'traveler' ? moved?.get(o.id) : null;
  if (go) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of o.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const dx = go[0] - (x0 + x1) / 2, dy = go[1] - (y0 + y1) / 2;
    return o.points.map((p) => [p[0] + dx, p[1] + dy, ...p.slice(2)]);
  }
  const d = dragOf(o), ox = (o.off?.[0] ?? 0) + (d?.dx ?? 0), oy = (o.off?.[1] ?? 0) + (d?.dy ?? 0);
  // A line drawn inside a target carries a third coordinate.
  return o.points.map((p) => (p.length > 2 ? [p[0] + ox, p[1] + oy, p[2]] : [p[0] + ox, p[1] + oy]));
}

const LINE_PAD = 0.25;
// Where playing has carried a traveler: id -> [x, y].
let moved = null;
export function setMoved(map) { moved = map; }

export function rectOf(o) {
  const d = dragOf(o), at = moved?.get(o.id);
  if (at && !d) return { cx: at[0], cy: at[1], w: o.rect.w, h: o.rect.h };
  if (o.rect) {
    if (d?.rects?.has(o.id)) return d.rects.get(o.id); // a transform in progress: one rectangle each
    if (d?.rect) return d.rect;
    return { cx: o.rect.cx + (d?.dx ?? 0), cy: o.rect.cy + (d?.dy ?? 0), w: o.rect.w, h: o.rect.h };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ptsOf(o)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + LINE_PAD * 2, h: y1 - y0 + LINE_PAD * 2 };
}

// The outline of a shape, as a closed run of points.
export function outline(r, shape = 'rect') {
  if (shape === 'ellipse') {
    return Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return [r.cx + Math.cos(a) * r.w / 2, r.cy + Math.sin(a) * r.h / 2]; });
  }
  const x0 = r.cx - r.w / 2, x1 = r.cx + r.w / 2, y0 = r.cy - r.h / 2, y1 = r.cy + r.h / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

// Inputs sit on the left edge, outputs on the right, spread evenly.
export function portPos(o, side, name) {
  const b = blanketOf(o);
  if (!b) return null;
  const i = b[side].indexOf(name);
  if (i < 0) return null;
  const r = rectOf(o), f = (i + 1) / (b[side].length + 1);
  return [side === 'ins' ? r.cx - r.w / 2 : r.cx + r.w / 2, r.cy + r.h / 2 - r.h * f];
}

// Map a group's interior into its rectangle: parent = [ox, oy] + local * k.
export function innerXf(g) {
  const r = rectOf(g), k = 0.86 * Math.min(r.w / g.inner.w, r.h / g.inner.h);
  return { k, ox: r.cx - g.inner.cx * k, oy: r.cy - g.inner.cy * k };
}

// A smooth curve through the points (centripetal Catmull-Rom), for showing a
// line; the points themselves are never changed.
export function smooth(points, steps = 6) {
  const n = points.length;
  if (n < 3) return points;
  const closed = Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]) < 1e-9;
  const at = (i) => (closed ? points[((i % (n - 1)) + (n - 1)) % (n - 1)] : points[Math.max(0, Math.min(n - 1, i))]);
  const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let s = 0; s < steps; s++) {
      const t = t1 + (t2 - t1) * (s / steps), q = [];
      for (let k = 0; k < 2; k++) {
        const a1 = p0[k] * (t1 - t) / t1 + p1[k] * t / t1;
        const a2 = p1[k] * (t2 - t) / (t2 - t1) + p2[k] * (t - t1) / (t2 - t1);
        const a3 = p2[k] * (t3 - t) / (t3 - t2) + p3[k] * (t - t2) / (t3 - t2);
        const b1 = a1 * (t2 - t) / t2 + a2 * t / t2;
        const b2 = a2 * (t3 - t) / (t3 - t1) + a3 * (t - t1) / (t3 - t1);
        q.push(b1 * (t2 - t) / (t2 - t1) + b2 * (t - t1) / (t2 - t1));
      }
      out.push(q);
    }
  }
  out.push(points[n - 1].slice(0, 2));
  return out;
}

// Fewer points, same shape (Ramer-Douglas-Peucker): drops what lies within
// `tol` of the line between its neighbours.
export const simplify = (points, tol) => simplifyIndex(points, tol).map((i) => points[i]);
// The same, as the indices of the points that stay.
export function simplifyIndex(points, tol) {
  if (points.length < 3 || !(tol > 0)) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop(), pa = points[a], pb = points[b], dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy);
    let far = -1, most = tol;
    // ends that meet (a closed stroke): distance from that point, not from a line through it
    for (let i = a + 1; i < b; i++) { const d = len > 1e-9 ? Math.abs((points[i][0] - pa[0]) * dy - (points[i][1] - pa[1]) * dx) / len : Math.hypot(points[i][0] - pa[0], points[i][1] - pa[1]); if (d > most) { most = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.map((_, i) => i).filter((i) => keep[i]);
}

// A point u (0..1) along a path, by arc length.
export function along(points, u) {
  if (points.length < 2) return points[0] ?? [0, 0];
  const lens = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const at = Math.max(0, Math.min(1, u)) * lens[lens.length - 1];
  let i = 1;
  while (i < lens.length - 1 && lens[i] < at) i++;
  const span = lens[i] - lens[i - 1], f = span ? (at - lens[i - 1]) / span : 0;
  return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f];
}
