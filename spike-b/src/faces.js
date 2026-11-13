// Faces: how an object looks at each zoom level.
//   far   a small filled box (a mark is just its ink)
//   mid   the blanket: ports on the edges, parameters inside
//   near  the interior: the code, or for a group and a scene, what is in it
// One DOM element per visible object, placed over the canvas every frame.

import { h, syncParams, codeArea, syncCode } from './controls.js';

const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : '');

export function createFaces(layer, { onParam, onCode }) {
  const els = new Map();

  function create(o) {
    const el = h('div', 'face kind-' + o.kind);
    el.head = h('div', 'head'); el.ins = h('div', 'ports ins'); el.outs = h('div', 'ports outs');
    el.body = h('div', 'body'); el.params = h('div', 'params');
    el.body.append(el.params);
    if (o.kind === 'box' || o.kind === 'mark') { el.code = codeArea(onCode); el.body.append(el.code); }
    el.append(el.head, el.ins, el.outs, el.body);
    layer.append(el);
    return el;
  }

  function ports(box, names, sig) {
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren(...names.map((name, i) => {
      const dot = h('i', 'port');
      dot.style.top = ((i + 1) / (names.length + 1)) * 100 + '%';
      dot.title = name;
      dot.append(h('b', '', name));
      return dot;
    }));
  }

  // vis: id -> { o, face, px: { l, t, w, h }, blanket }
  function update(vis, { run, selection, w, h: stageH }) {
    const seen = new Set();
    for (const [id, v] of vis) {
      if (v.face === 'line' || (v.face === 'far' && v.o.kind === 'mark')) continue;
      const p = v.px;
      if (p.l > w || p.t > stageH || p.l + p.w < 0 || p.t + p.h < 0) continue;
      seen.add(id);
      let el = els.get(id);
      if (!el) els.set(id, el = create(v.o));
      el.style.cssText = `left:${p.l.toFixed(1)}px;top:${p.t.toFixed(1)}px;width:${p.w.toFixed(1)}px;height:${p.h.toFixed(1)}px`;
      const error = run.errors.get(id);
      el.className = `face kind-${v.o.kind} ${v.face}${selection.has(id) ? ' sel' : ''}${error ? ' err' : ''}`;
      if (v.face === 'far') continue;
      const b = v.blanket;
      el.head.textContent = error ? `${b.name} · ${error}` : b.name;
      ports(el.ins, b.ins, b.ins.join(' '));
      ports(el.outs, b.outs, b.outs.join(' '));
      b.outs.forEach((name, i) => {
        const label = el.outs.children[i].firstChild, text = `${name} ${fmt(run.output(id, name))}`;
        if (label.textContent !== text) label.textContent = text;
      });
      syncParams(el.params, v.o, b, onParam);
      if (el.code) syncCode(el.code, v.o);
    }
    for (const [id, el] of els) if (!seen.has(id) && !el.contains(document.activeElement)) { el.remove(); els.delete(id); }
  }

  return { update };
}
