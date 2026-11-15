// Ink brushes as code: the preview draws a sample stroke (or, for a brush of
// planes, a sample shape) with the brush as written. A brush written here is
// part of the drawing (brush.define), so it is saved, undone and replayed
// with it, and the marks drawn with it keep it.

import { toolCodePanel } from './toolcode.js';
import { BRUSHES, brushSource, compileBrush, isBuiltinBrush, resolveParams, mulberry32 } from '../ink/brushes.js';
import { txBeginFrame } from '../ink/texture.js';
import { settings, setSetting } from '../settings.js';

// A stroke as a hand draws it: slow and heavy at the turns, fast and light between them.
const stroke = (W, H) => Array.from({ length: 49 }, (_, i) => { const u = i / 48, s = Math.sin(u * Math.PI * 3); return [W * (0.07 + u * 0.86), H * (0.5 + 0.24 * s), u * 900 + 120 * Math.sin(u * Math.PI * 6), 0.25 + 0.6 * Math.abs(s)]; });
const blob = (W, H) => Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2, r = 1 + 0.12 * Math.sin(a * 3); return [W / 2 + Math.cos(a) * W * 0.3 * r, H / 2 + Math.sin(a) * H * 0.34 * r, i * 20, 0.5]; });

export function brushesPanel(el, app) {
  return toolCodePanel(el, {
    word: 'brush', first: 'ink', current: () => settings.brush || 'ink',
    ids: () => [...new Set([...Object.keys(BRUSHES), ...Object.keys(app.state.brushes)])],
    label: (id) => BRUSHES[id]?.label ?? id,
    builtin: isBuiltinBrush,
    source: (id) => app.state.brushes[id] ?? brushSource(id),
    compile: compileBrush,
    preview(g, def, W, H, ink) {
      if (!def) return;
      const plane = !def.roles.includes('line') && def.roles.includes('plane'), point = def.roles.length === 1 && def.roles[0] === 'point';
      const e = point ? { points: [[W * 0.3, H / 2, 0, 0.5], [W * 0.5, H / 2, 0, 0.5], [W * 0.7, H / 2, 0, 0.5]], closed: false, color: ink, role: 'point' }
        : plane ? { points: blob(W, H), closed: true, color: ink, role: 'plane' } : { points: stroke(W, H), closed: false, color: ink, role: 'line' };
      txBeginFrame();
      def.draw(g, e, resolveParams(def, {}), { rng: mulberry32(7), scale: 2 });
      if (def.lastError) throw new Error(def.lastError);
    },
    define: (id, code) => app.call('brush.define', { id, code }),
    remove: (id) => app.call('brush.remove', { id }),
    // on the selection when it can take the brush, else for what is drawn next
    use: (id) => {
      const b = BRUSHES[id];
      if (!b) return;
      const sel = [...app.state.selection].map(app.get).filter((o) => o && !o.bind && (b.roles.includes('line') ? o.kind === 'line' : o.kind === 'shape' && o.role === 'visual'));
      if (sel.length) app.call('object.brush', { ids: sel.map((o) => o.id), id });
      else if (b.roles.includes('line')) { setSetting('brush', id); app.call('tool.set', { name: 'draw' }); }
      else setSetting('planeBrush', id);
    },
    useIcon: 'brush', useTitle: 'Draw with this brush (the selection takes it)',
    error: () => null,
    sig: () => JSON.stringify(app.state.brushes),
  });
}
