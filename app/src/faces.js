// Faces: how an object looks at each zoom level.
//   far   a small filled block (a line or a visual is just its ink)
//   mid   the blanket: ports on the edges, parameters inside
//   near  the interior: the code, or for a group and a target, what is in it
// A sketch container shows its running sketch at mid and near.
// One DOM element per visible object, placed over the canvas every frame.

import { h, syncParams, codeArea, syncCode } from './controls.js';
import { hasCode } from './object.js';
import { sketchKind, sketchDoc } from './sketch.js';
import { icon } from './icons.js';

const fmt = (v) => (Array.isArray(v) ? `[${v.length}]` : typeof v === 'number' && Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : '');
const FRAME_W = 480; // a sketch is laid out this wide, then scaled to its face
const VENDOR = new URL('../vendor/three/', location.href).href;

export function createFaces(layer, { onParam, onCode }) {
  const els = new Map();

  function create(o) {
    const el = h('div', 'face');
    el.head = h('div', 'head'); el.ins = h('div', 'ports ins'); el.outs = h('div', 'ports outs');
    el.body = h('div', 'body'); el.params = h('div', 'params');
    el.body.append(el.params);
    if (hasCode(o)) { el.code = codeArea(onCode); el.body.append(el.code); }
    el.note = h('div', 'note');
    el.append(el.head, el.ins, el.outs, el.body, el.note);
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

  // Keeps a sketch's frame running its current code, scaled to the face.
  function sketch(el, v, kind, run) {
    const o = v.o, b = v.blanket;
    if (!kind) { el.frame?.remove(); el.frame = null; return; }
    if (!el.frame) { el.frame = h('iframe', 'sketch'); el.frame.sandbox = 'allow-scripts allow-same-origin'; el.frame.title = b.name || 'sketch'; el.append(el.frame); }
    if (el.frame.dataset.code !== o.code) { el.frame.dataset.code = o.code; el.frame.srcdoc = sketchDoc(o.code, kind, o.id, VENDOR); }
    const k = v.px.w / FRAME_W;
    el.frame.style.cssText = `width:${FRAME_W}px;height:${(v.px.h / k).toFixed(1)}px;transform:scale(${k.toFixed(4)})`;
    const inp = {}, p = {};
    for (const n of b.ins) inp[n] = run.input(o.id, n);
    for (const q of b.params) p[q.name] = o.params?.[q.name] ?? q.value;
    el.frame.contentWindow?.postMessage({ inp, p }, '*');
  }

  // vis: id -> { o, face, px: { l, t, w, h }, blanket }
  function update(vis, { run, selection, w, h: stageH, code = true, ground = 0.85 }) {
    const seen = new Set();
    // the code on objects zoomed into: shown or not, and how solid its ground is
    layer.classList.toggle('no-code', !code);
    layer.style.setProperty('--code-ground', Math.round(ground * 100) + '%');
    for (const [id, v] of vis) {
      const o = v.o, sel = selection.has(id), isNote = o.role === 'note', plain = !v.blanket && !isNote;
      if (v.face === 'line' || v.face === 'joint' || !v.px) continue;
      if (plain && !(sel && o.rect)) continue;                 // a visual gets a frame only while selected
      if (v.face === 'far' && o.kind === 'line') continue;
      const p = v.px;
      if (p.l > w || p.t > stageH || p.l + p.w < 0 || p.t + p.h < 0) continue;
      seen.add(id);
      let el = els.get(id);
      if (el && !!el.code !== hasCode(o)) { el.remove(); els.delete(id); el = null; } // its role changed
      if (!el) els.set(id, el = create(o));
      // stroke, fill and opacity apply to a face as they do to ink
      const st = o.style ?? {}, look = (st.stroke && !sel ? `;border-color:${st.stroke}` : '') + (st.fill ? `;background:${st.fill}` : '') + (st.opacity != null ? `;opacity:${st.opacity}` : '');
      el.style.cssText = `left:${p.l.toFixed(1)}px;top:${p.t.toFixed(1)}px;width:${p.w.toFixed(1)}px;height:${p.h.toFixed(1)}px${plain ? '' : look}`;
      const error = run.errors.get(id), kind = plain || v.face === 'far' ? null : hasCode(o) && o.role !== 'score' ? sketchKind(o.code) : null;
      el.className = `face kind-${o.kind} role-${o.role ?? 'group'} ${v.face}${sel ? ' sel' : ''}${error ? ' err' : ''}${kind ? ' is-sketch' : ''}${plain ? ' plain' : ''}${o.rect && sel && selection.size === 1 ? ' sizable' : ''}${o.shape === 'ellipse' ? ' shape-ellipse' : ''}`;
      if (plain || v.face === 'far') {
        if (el.frame) sketch(el, v, null);
        // a synth part far off is its kind's glyph (synth.js), so a drawn instrument still reads as one
        const fg = o.role === 'synth' && v.blanket?.name ? 'syn.' + v.blanket.name : v.inst ? 'syn.out' : '';
        if (fg && el.dataset.glyph !== fg) { el.dataset.glyph = fg; el.head.innerHTML = icon(fg); }
        el.classList.toggle('instrument', !!v.inst);
        continue;
      }
      if (isNote) {
        if (el.note.textContent !== (o.text ?? '')) el.note.textContent = o.text ?? '';
        el.note.style.color = o.style?.stroke ?? '';
        // the lettering scales with the note, as ink does not
        el.note.style.fontSize = Math.max(6, v.px.h * 0.22).toFixed(1) + 'px';
        continue;
      }
      const b = v.blanket;
      if (o.role === 'synth') { // its kind's glyph, and its name where there is room
        const g = 'syn.' + b.name, t = error ? `${b.name} · ${error}` : b.name;
        if (el.dataset.glyph !== g + t) { el.dataset.glyph = g + t; el.head.innerHTML = icon(g); el.head.append(h('span', '', t)); }
      } else if (v.inst) { // an instrument: the out's glyph, the group's name, the channel it plays
        const ch = Math.round(v.inst.o.params?.channel ?? v.inst.blanket.params.find((q) => q.name === 'channel')?.value ?? 1), t = `${ch} · ${b.name}`; // the channel first: it stays when the name is cut
        if (el.dataset.glyph !== 'inst' + t) { el.dataset.glyph = 'inst' + t; el.head.innerHTML = icon('syn.out'); el.head.append(h('span', '', t)); }
      } else { if (el.dataset.glyph) delete el.dataset.glyph; el.head.textContent = error ? `${b.name} · ${error}` : b.name; }
      el.classList.toggle('instrument', !!v.inst);
      ports(el.ins, b.ins, b.ins.join(' '));
      ports(el.outs, b.outs, b.outs.join(' '));
      b.outs.forEach((name, i) => {
        const label = el.outs.children[i].firstChild, text = `${name} ${fmt(run.output(id, name))}`;
        if (label.textContent !== text) label.textContent = text;
      });
      // an instrument's face publishes its out's channel and gain: edits go to the out inside
      // (not zoomed in, where the out itself is in view)
      if (v.inst && v.face === 'mid') syncParams(el.params, v.inst.o, { ...v.inst.blanket, params: v.inst.blanket.params.filter((q) => q.name === 'channel' || q.name === 'gain') }, onParam);
      else syncParams(el.params, o, b, onParam);
      if (el.code) syncCode(el.code, o);
      sketch(el, v, kind, run);
    }
    for (const [id, el] of els) if (!seen.has(id) && !el.contains(document.activeElement)) { el.remove(); els.delete(id); }
  }

  return { update };
}
