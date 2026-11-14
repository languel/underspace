// Runs the code objects once a frame. A wire carries last frame's value, so
// order does not matter and loops are allowed (one frame of delay per wire).

import { parseBlanket, ptsOf, along, hasCode } from './object.js';
import { sketchKind } from './sketch.js';

const compiled = new Map();
function compile(code) {
  let f = compiled.get(code);
  if (f) return f;
  try { f = { run: new Function('inp', 'p', 't', 'geom', 'mem', 'along', code) }; }
  catch (e) { f = { error: e.message }; }
  if (compiled.size > 500) compiled.clear();
  compiled.set(code, f);
  return f;
}

export function createRunner() {
  let values = new Map();
  const mems = new Map();
  // A sketch runs in its own frame and reports its outputs and errors here.
  const external = new Map(), externalErrors = new Map();

  step.report = (id, msg) => { if (msg.out) external.set(id, msg.out); if (msg.error) externalErrors.set(id, msg.error); };
  step.restart = (id) => { external.delete(id); externalErrors.delete(id); };
  return step;

  function step(objects, t) {
    // A port on a group stands for a port on something inside it.
    const leaf = (ref, side) => {
      let o = objects.get(ref.id), port = ref.port;
      for (let guard = 0; o && o.kind === 'group' && guard < 32; guard++) {
        const p = o.ports[side].find((q) => q.name === port);
        if (!p) return null;
        port = p.inner.port; o = objects.get(p.inner.id);
      }
      return o ? { id: o.id, port } : null;
    };
    const links = new Map(); // 'id.port' of an input -> the output feeding it
    for (const w of objects.values()) {
      if (!w.bind) continue;
      const a = leaf(w.bind.from, 'outs'), b = leaf(w.bind.to, 'ins');
      if (a && b) links.set(b.id + '.' + b.port, a);
    }
    const read = (id, port) => {
      const s = links.get(id + '.' + port), v = s && values.get(s.id)?.[s.port];
      return Number.isFinite(v) || Array.isArray(v) ? v : 0;
    };

    const next = new Map(), errors = new Map(), cursors = new Map(), shown = new Map();
    for (const o of objects.values()) {
      // Travelers, events and junctions are moved and fired by the play engine, which reports here.
      if (o.role === 'traveler' || o.role === 'event' || o.role === 'junction' || o.role === 'grid') { next.set(o.id, external.get(o.id) ?? {}); if (externalErrors.get(o.id)) errors.set(o.id, externalErrors.get(o.id)); continue; }
      if (!hasCode(o) || o.code == null) continue;
      if (o.role === 'score' || sketchKind(o.code)) {
        next.set(o.id, external.get(o.id) ?? {});
        if (externalErrors.has(o.id)) errors.set(o.id, externalErrors.get(o.id));
        continue;
      }
      const b = parseBlanket(o.code), f = compile(o.code);
      if (f.error) { errors.set(o.id, f.error); continue; }
      const inp = {}, p = {};
      for (const n of b.ins) inp[n] = read(o.id, n);
      for (const q of b.params) p[q.name] = o.params?.[q.name] ?? q.value;
      let geom = null;
      // A path remembers where its code last looked, so the view can show it.
      if (o.points) { const points = ptsOf(o); geom = { points, last: null, at(u) { return (this.last = along(points, u)); } }; }
      if (!mems.has(o.id)) mems.set(o.id, {});
      try {
        let out = f.run(inp, p, t, geom, mems.get(o.id), along);
        if (typeof out === 'number') out = { [b.outs[0]]: out };
        next.set(o.id, out ?? {});
        if (geom?.last) cursors.set(o.id, geom.last);
        // A path whose code returns `points` is drawn as those points.
        if (geom && Array.isArray(out?.points) && out.points.length > 1) shown.set(o.id, out.points);
      } catch (e) {
        errors.set(o.id, e.message);
        next.set(o.id, values.get(o.id) ?? {});
      }
    }
    values = next;
    return {
      errors, cursors, shown,
      input: read,
      output(id, port) { const l = leaf({ id, port }, 'outs'); return l ? values.get(l.id)?.[l.port] : undefined; },
    };
  }
}
