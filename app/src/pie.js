// The hold menu: hold still at the end of a stroke and a ring of glyphs opens
// around the pointer (a marking menu). Move toward one and let go to turn the
// stroke into it; let go in the middle and it stays as drawn. Only the glyph
// under the pointer is named, in a tip.
//
// Also the shape a stroke most looks like, for "recognize".

import { icon } from './icons.js';

const RADIUS = 62, DEAD = 20;

// items: [{ title, icon }]. Returns { at(x, y) -> index or -1 (and highlights it), close() }.
export function showPie(host, items, x, y) {
  const el = document.createElement('div');
  el.className = 'pie';
  el.style.transform = `translate(${x}px, ${y}px)`;
  const centre = document.createElement('i');
  centre.className = 'pie-centre';
  const tip = document.createElement('span');
  tip.className = 'pie-tip';
  el.append(centre, tip);
  const n = items.length, step = (Math.PI * 2) / n;
  const buttons = items.map((it, i) => {
    const a = -Math.PI / 2 + i * step, b = document.createElement('span');
    b.className = 'pie-item';
    b.innerHTML = icon(it.icon);
    b.style.transform = `translate(${(Math.cos(a) * RADIUS).toFixed(1)}px, ${(Math.sin(a) * RADIUS).toFixed(1)}px)`;
    el.append(b);
    return b;
  });
  host.append(el);
  let on = -1;
  return {
    at(px, py) {
      const dx = px - x, dy = py - y;
      let i = -1;
      if (Math.hypot(dx, dy) > DEAD) i = ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / step) % n) + n) % n;
      if (i !== on) {
        buttons[on]?.classList.remove('on');
        on = i;
        buttons[on]?.classList.add('on');
        tip.textContent = on < 0 ? '' : items[on].title;
        tip.hidden = on < 0;
      }
      return on;
    },
    close() { el.remove(); },
  };
}

// The closed shape a stroke is nearest to: 'ellipse' or 'rect', with its box
// { cx, cy, w, h }. A stroke whose ends are far apart is not closed: null.
export function recognize(points) {
  if (points.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
  points.forEach((p, i) => {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    if (i) len += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
  });
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = points[0], b = points[points.length - 1];
  if (!(w > 0 && h > 0) || Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.25 * len) return null;
  // How far each point lies from an ellipse and from a rectangle in that box (in box units).
  let ell = 0, box = 0;
  for (const p of points) {
    const u = (p[0] - cx) / (w / 2), v = (p[1] - cy) / (h / 2);
    ell += Math.abs(Math.hypot(u, v) - 1);
    box += Math.min(1 - Math.abs(u), 1 - Math.abs(v)) ** 2 * 4;
  }
  return { shape: ell < box ? 'ellipse' : 'rect', rect: { cx, cy, w, h } };
}
