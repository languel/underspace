// Sculpt tools as code: the preview sweeps the tool as written over a sample
// line (faint: before; dark: after). A tool written here is part of the
// drawing (sculpt.define), so it is saved, undone and replayed with it.

import { toolCodePanel } from './toolcode.js';
import { SCULPTS, sculptSource, compileSculpt, sculptMark, isBuiltinSculpt } from '../ink/sculpt.js';
import { settings, setSetting } from '../settings.js';

const sample = (W, H) => Array.from({ length: 41 }, (_, i) => { const u = i / 40; return [W * (0.06 + u * 0.88), H * (0.5 + 0.2 * Math.sin(u * Math.PI * 3)), i * 20, 0.5]; });

// The sample line after the tool has been swept across it, left to right, a little above the middle.
function sweep(def, W, H) {
  let pts = sample(W, H), seed = 7;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mark = { orig: pts, state: {} }, start = [W * 0.2, H * 0.5];
  for (let i = 0; i <= 30; i++) {
    const x = W * (0.2 + 0.6 * (i / 30)), y = H * (0.5 - 0.22 * Math.sin((i / 30) * Math.PI));
    const out = sculptMark(def, { points: pts, closed: false }, { x, y, dx: i ? (W * 0.6) / 30 : 0, dy: i ? -H * 0.02 : 0, radius: 34, strength: 0.6, pressure: 1, first: i === 0, start }, undefined, rng, mark);
    if (out) pts = out;
  }
  return pts;
}

export function sculptsPanel(el, app) {
  return toolCodePanel(el, {
    word: 'tool', first: 'push', current: () => settings.sculpt,
    ids: () => [...new Set([...Object.keys(SCULPTS), ...Object.keys(app.state.sculpts)])],
    label: (id) => SCULPTS[id]?.label ?? id,
    builtin: isBuiltinSculpt,
    source: (id) => app.state.sculpts[id] ?? sculptSource(id),
    compile: compileSculpt,
    preview(g, def, W, H, ink) {
      g.lineJoin = g.lineCap = 'round'; g.strokeStyle = g.fillStyle = ink;
      const line = (pts, alpha, dots) => {
        g.globalAlpha = alpha; g.lineWidth = 1.4; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        if (dots) for (const p of pts) { g.beginPath(); g.arc(p[0], p[1], 1.3, 0, 7); g.fill(); }
      };
      line(sample(W, H), 0.25, false);
      if (def) line(sweep(def, W, H), 1, true);
    },
    define: (id, code) => app.call('sculpt.define', { id, code }),
    remove: (id) => app.call('sculpt.remove', { id }),
    use: (id) => { if (SCULPTS[id]) { setSetting('sculpt', id); app.call('tool.set', { name: 'sculpt' }); } },
    useIcon: 'sculpt', useTitle: 'Sculpt with this tool',
    error: (id) => app.sculptErrors()[id],
    sig: () => JSON.stringify(app.state.sculpts),
  });
}
