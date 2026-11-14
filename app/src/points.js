// The points tool (Shift+V): a line's control points as they are stored, not
// the smooth curve drawn through them. Each one shows as a handle; hovering one
// reads out its index, position and pen pressure; handles can be picked, boxed,
// dragged and deleted.
//
// Handles live on their own layer of the stage. Which points are picked is
// view state, like the camera: it is not recorded in the take. What is done to
// them is, through line.set.

const key = (id, i) => id + ':' + i;

export function createPoints(layer) {
  let shown = [];          // { id, i, x, y, p, pen, scene, xf }: x, y on screen; p the stored point
  const picked = new Set(); // keys of picked points
  const tip = document.createElement('span');
  tip.className = 'tip';
  tip.hidden = true;

  const fmt = (v) => (Math.round(v * 100) / 100).toString();

  function render() {
    const want = shown.length;
    while (layer.children.length - 1 < want) layer.append(document.createElement('i'));
    while (layer.children.length - 1 > want) layer.lastChild.remove();
    if (tip.parentNode !== layer) layer.prepend(tip);
    shown.forEach((h, n) => {
      const el = layer.children[n + 1];
      el.className = (picked.has(key(h.id, h.i)) ? 'on' : '') + (h.i === 0 ? ' first' : '');
      el.style.transform = `translate(${h.x.toFixed(1)}px,${h.y.toFixed(1)}px)`;
    });
  }

  return {
    key,
    picked,
    get shown() { return shown; },
    // The handles to show this frame (screen positions already worked out).
    set(list) { shown = list; render(); },
    clear() { shown = []; picked.clear(); tip.hidden = true; render(); },
    // The handle nearest (x, y), within r pixels; picked handles win ties.
    at(x, y, r = 7) {
      let best = null, bestD = r;
      for (const h of shown) { const d = Math.hypot(h.x - x, h.y - y); if (d < bestD || (d === bestD && picked.has(key(h.id, h.i)))) { bestD = d; best = h; } }
      return best;
    },
    within(x0, y0, x1, y1) { return shown.filter((h) => h.x >= x0 && h.x <= x1 && h.y >= y0 && h.y <= y1); },
    // The readout beside a hovered handle: index · x, y[, z] · pressure.
    hover(h) {
      if (!h) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.textContent = `${h.i}  ${h.p.map(fmt).join(', ')}${h.pen ? '  ·' + fmt(h.pen[1]) : ''}`;
      tip.style.transform = `translate(${(h.x + 10).toFixed(1)}px,${(h.y - 22).toFixed(1)}px)`;
    },
    // Picked points grouped by line: id -> [indices], ascending.
    byLine() {
      const out = new Map();
      for (const k of picked) { const j = k.lastIndexOf(':'), id = k.slice(0, j); if (!out.has(id)) out.set(id, []); out.get(id).push(Number(k.slice(j + 1))); }
      for (const list of out.values()) list.sort((a, b) => a - b);
      return out;
    },
  };
}

// A line's points without the ones at `drop` (indices), keeping its pen in step.
// null when fewer than two would be left.
export function without(points, pen, drop) {
  const gone = new Set(drop), keep = points.map((_, i) => i).filter((i) => !gone.has(i));
  if (keep.length < 2) return null;
  return { points: keep.map((i) => points[i]), pen: pen && pen.length === points.length ? keep.map((i) => pen[i]) : null };
}
