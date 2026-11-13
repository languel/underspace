// The object: geometry, role, blanket, interior. Pure functions over records.
//
//   { id, space, kind, role, ... }
//
//   kind 'line'    points [[x, y] or [x, y, z], ...], off, closed?
//        role 'ink'        just a drawing
//             'connector'  bind { from: { id, port }, to: { id, port } }
//             'path'       code that reads its own geometry
//   kind 'shape'   rect { cx, cy, w, h }, shape 'rect' | 'ellipse'
//        role 'visual'     something to look at
//             'target'     a render target: its interior is a 3D space
//             'code'       a code container
//             'score'      a frame that reads the lines in it as sound; its code is a brush
//   kind 'group'   rect, inner (its interior frame), ports (the cut wires)
//
// Code objects (path, code) carry `code` and `params`; the blanket is declared
// in the code's header. Coordinates are local to the object's space (y up);
// `space` is the id of the group or target it lives in, or null for the canvas.

export const ROLES = { line: ['ink', 'connector', 'path'], shape: ['visual', 'target', 'code', 'score'] };
export const isLine = (o) => o.kind === 'line';
export const isTarget = (o) => o.kind === 'shape' && o.role === 'target';
export const hasCode = (o) => o.role === 'code' || o.role === 'path' || o.role === 'score';
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
  if (hasCode(o) && o.code != null) return parseBlanket(o.code);
  return null;
}

// A move or resize in progress is shown before it is committed as a command.
let drag = null;
export function setDrag(d) { drag = d; }
const dragOf = (o) => (drag && drag.ids.has(o.id) ? drag : null);

export function ptsOf(o) {
  const d = dragOf(o), ox = (o.off?.[0] ?? 0) + (d?.dx ?? 0), oy = (o.off?.[1] ?? 0) + (d?.dy ?? 0);
  // A line drawn inside a target carries a third coordinate.
  return o.points.map((p) => (p.length > 2 ? [p[0] + ox, p[1] + oy, p[2]] : [p[0] + ox, p[1] + oy]));
}

const LINE_PAD = 0.25;
export function rectOf(o) {
  const d = dragOf(o);
  if (o.rect) {
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
