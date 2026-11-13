// Collapse folds objects into one group whose blanket is the wires that were
// cut; expand reverses it. Wires wholly inside go in with the objects.

import { rectOf } from './object.js';

const PAD = 0.3, SHRINK = 0.4, MIN_W = 2, MIN_H = 1.4;

export function collapse(objects, ids, gid) {
  const members = ids.map((id) => objects.get(id)).filter((o) => o && !o.bind);
  if (!members.length) return null;
  const space = members[0].space;
  if (members.some((o) => o.space !== space)) throw new Error('collapse: the objects are in different spaces');
  const inside = new Set(members.map((o) => o.id));

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of members) {
    const r = rectOf(o);
    x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2);
    y0 = Math.min(y0, r.cy - r.h / 2); y1 = Math.max(y1, r.cy + r.h / 2);
  }
  const inner = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
  const g = {
    id: gid, kind: 'group', space, inner,
    rect: { cx: inner.cx, cy: inner.cy, w: Math.max(MIN_W, inner.w * SHRINK), h: Math.max(MIN_H, inner.h * SHRINK) },
    ports: { ins: [], outs: [] },
  };
  // One port per inner port that a cut wire reached, named after it.
  const port = (side, ref) => {
    let p = g.ports[side].find((q) => q.inner.id === ref.id && q.inner.port === ref.port);
    if (!p) {
      let name = ref.port, n = 2;
      while (g.ports[side].some((q) => q.name === name)) name = ref.port + n++;
      p = { name, inner: { id: ref.id, port: ref.port } };
      g.ports[side].push(p);
    }
    return p.name;
  };
  for (const w of objects.values()) {
    if (!w.bind || w.space !== space) continue;
    const a = inside.has(w.bind.from.id), b = inside.has(w.bind.to.id);
    if (a && b) w.space = gid;
    else if (a) w.bind.from = { id: gid, port: port('outs', w.bind.from) };
    else if (b) w.bind.to = { id: gid, port: port('ins', w.bind.to) };
  }
  for (const o of members) o.space = gid;
  objects.set(gid, g);
  return g;
}

// The contents come back at their own size, centred where the group was.
export function expand(objects, gid) {
  const g = objects.get(gid);
  if (!g || g.kind !== 'group') return false;
  const dx = g.rect.cx - g.inner.cx, dy = g.rect.cy - g.inner.cy;
  for (const o of objects.values()) {
    if (o.space === gid) {
      o.space = g.space;
      if (o.rect) { o.rect.cx += dx; o.rect.cy += dy; }
      else if (o.points) o.off = [(o.off?.[0] ?? 0) + dx, (o.off?.[1] ?? 0) + dy];
    }
    if (!o.bind) continue;
    for (const [end, side] of [['from', 'outs'], ['to', 'ins']]) {
      if (o.bind[end].id !== gid) continue;
      const p = g.ports[side].find((q) => q.name === o.bind[end].port);
      if (p) o.bind[end] = { id: p.inner.id, port: p.inner.port };
    }
  }
  objects.delete(gid);
  return true;
}
