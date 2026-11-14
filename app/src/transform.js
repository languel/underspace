// Grab, rotate and scale, as in Blender (and threeditor's Blender keymap,
// editor/js/ModalTransform.js there): G, R or S starts; the pointer drives it;
// X, Y, Z hold it to an axis (Shift+axis: the plane without that axis; the
// same key again lets go); typing a number sets the amount; Shift is fine
// control, Ctrl steps; Enter or a click accepts, Escape or a right-click
// cancels. The same on the canvas (2D) and inside a render target (3D), on
// whole objects or (with the points tool) on picked control points.
//
// The math is pure and shared with the `object.transform` command:
//   t = { pivot, d: [dx, dy, dz], angle (radians), axis: [x, y, z], s: [sx, sy, sz] }
//   p' = pivot + R(axis, angle) · S · (p - pivot) + d

export const AXIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The spec of a transform from the command's arguments (angle in degrees).
export function spec(a) {
  const axis = Array.isArray(a.axis) ? norm(a.axis) : AXIS[a.axis] ?? AXIS.z;
  return { pivot: [a.pivot?.[0] ?? 0, a.pivot?.[1] ?? 0, a.pivot?.[2] ?? 0], d: [a.dx ?? 0, a.dy ?? 0, a.dz ?? 0], angle: ((a.angle ?? 0) * Math.PI) / 180, axis, s: [a.sx ?? 1, a.sy ?? 1, a.sz ?? 1] };
}

// One point. A flat point ([x, y]) stays flat: it turns about z only.
export function apply(t, p) {
  const flat = p.length < 3, v = [p[0] - t.pivot[0], p[1] - t.pivot[1], (flat ? 0 : p[2]) - (flat ? 0 : t.pivot[2])];
  for (let i = 0; i < 3; i++) v[i] *= t.s[i];
  let r = v;
  if (t.angle) {
    const k = flat ? AXIS.z : t.axis, c = Math.cos(t.angle), s = Math.sin(t.angle), kv = cross(k, v), kd = dot(k, v) * (1 - c);
    r = [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd);
  }
  const out = [r[0] + t.pivot[0] + t.d[0], r[1] + t.pivot[1] + t.d[1]];
  if (!flat) out.push(r[2] + t.pivot[2] + t.d[2]);
  return [...out, ...p.slice(flat ? 2 : 3)];
}

// A shape's rectangle: its centre moves; its size scales; a quarter turn swaps width and height.
export function applyRect(t, r) {
  const c = apply(t, [r.cx, r.cy]), quarter = Math.abs(Math.sin(t.angle)) > 0.7071;
  const w = Math.abs(r.w * t.s[0]), h = Math.abs(r.h * t.s[1]);
  return { cx: c[0], cy: c[1], w: quarter ? h : w, h: quarter ? w : h };
}

// ---- the modal ---------------------------------------------------------------
//
// host: {
//   items()          what to transform: [{ id, pts, idx?, pen?, rect?, scene?, xf? }] (pts in the
//                    object's own space, idx the points to move, null for all), or null
//   unitsPerPx(item) canvas units per pixel for a flat item
//   toScreen(item, p) a point of the item's space on the stage
//   toLocal(item, px, py, plane, through) a pointer on a plane of a target (3D items)
//   basis(scene)     the target's view basis { u, v }
//   snap(v)          a length snapped to the grid
//   preview(items, t) show it; commit(items, t) make it so; cancel()
//   readout(text)    show the state, or null
//   local(e)         a pointer event's position on the stage
// }
export function createModal(host) {
  let m = null, ended = 0;

  function start(mode, at) {
    if (m) return false;
    const items = host.items();
    if (!items?.length) return false;
    // The pivot: the middle of what moves (the median, as Blender's default).
    const pts = [];
    for (const it of items) {
      if (it.rect) pts.push([it.rect.cx, it.rect.cy, 0]);
      else (it.idx ?? it.pts.map((_, i) => i)).forEach((i) => pts.push([it.pts[i][0], it.pts[i][1], it.pts[i][2] ?? 0]));
    }
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    const pivot = lo.map((v, k) => (v + hi[k]) / 2), scene = items[0].scene ?? null;
    m = { mode, items, pivot, scene, axis: null, plane: false, typed: '', start: at, at, fine: false, step: false };
    m.pivotPx = host.toScreen(items[0], scene ? pivot : pivot.slice(0, 2)) ?? at;
    update();
    return true;
  }

  // The transform the pointer (or the typed number) asks for now.
  function current() {
    const { mode, items, pivot, scene, axis, plane, typed } = m, n = typed === '' || typed === '-' || typed === '.' ? null : Number(typed);
    const t = { pivot, d: [0, 0, 0], angle: 0, axis: AXIS.z, s: [1, 1, 1] };
    const dx = m.at[0] - m.start[0], dy = m.at[1] - m.start[1], k = m.fine ? 0.1 : 1;
    const ax = axis ? AXIS[axis] : null;
    if (mode === 'grab') {
      let d;
      if (scene) {
        // Where the pointer moved on a plane through the pivot: facing the view, or (Shift+axis) the plane without the axis.
        const name = ax && plane ? { x: 'side', y: 'top', z: 'front' }[axis] : 'view';
        const a = host.toLocal(items[0], m.start[0], m.start[1], name, pivot), b = host.toLocal(items[0], m.start[0] + dx * k, m.start[1] + dy * k, name, pivot);
        d = a && b ? b.map((v, i) => v - a[i]) : [0, 0, 0];
        if (ax && !plane) { const along = dot(d, ax); d = ax.map((c) => c * along); }
        if (ax && !plane && !dot(d, d) && (dx || dy)) { const u = host.unitsPerPx(items[0]); d = ax.map((c) => c * (dx - dy) * u * k); }
      } else {
        const u = host.unitsPerPx(items[0]) * k;
        d = [dx * u, -dy * u, 0];
        if (ax) d = d.map((v, i) => (ax[i] ? v : 0));
        if (m.step) d = d.map((v) => host.snap(v));
      }
      if (n != null) { const dir = ax ?? (dot(d, d) ? norm(d) : AXIS.x); d = dir.map((c) => c * n); }
      t.d = d;
    } else if (mode === 'rotate') {
      const p = m.pivotPx, a0 = Math.atan2(m.start[1] - p[1], m.start[0] - p[0]), a1 = Math.atan2(m.at[1] - p[1], m.at[0] - p[0]);
      let a = -(a1 - a0) * k; // the screen's y points down
      if (m.step) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      if (n != null) a = (n * Math.PI) / 180;
      if (scene) {
        // About the axis given, or about the line of sight, turning as the pointer turns.
        const b = host.basis(scene), view = b ? norm(cross(b.u, b.v)) : AXIS.z;
        t.axis = ax ?? view;
        if (ax && dot(ax, view) < 0) a = -a;
      }
      t.angle = a;
    } else {
      const p = m.pivotPx, r0 = Math.hypot(m.start[0] - p[0], m.start[1] - p[1]) || 1, r1 = Math.hypot(m.at[0] - p[0], m.at[1] - p[1]);
      let f = 1 + (r1 / r0 - 1) * k;
      if (m.step) f = Math.round(f * 10) / 10;
      if (n != null) f = n;
      t.s = ax ? [0, 1, 2].map((i) => ((ax[i] ? 1 : 0) !== (plane ? 1 : 0) ? f : 1)) : [f, f, scene ? f : 1];
    }
    return t;
  }

  function label() {
    const t = current(), deg = (v) => Math.round((v * 180) / Math.PI * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
    const what = m.mode === 'grab' ? t.d.slice(0, m.scene ? 3 : 2).map(r2).join(', ') : m.mode === 'rotate' ? deg(t.angle) + '°' : t.s.slice(0, m.scene ? 3 : 2).map(r2).join(' × ');
    const glyph = { grab: '✥', rotate: '⟳', scale: '⤢' }[m.mode];
    return `${glyph}${m.axis ? '  ' + (m.plane ? '⊥' : '') + m.axis.toUpperCase() : ''}  ${m.typed !== '' ? m.typed + '  ' : ''}${what}`;
  }

  function update() { const t = current(); host.preview(m.items, t, m.axis && !m.plane ? AXIS[m.axis] : null); host.readout(label()); }
  function finish(accept) {
    if (!m) return;
    const t = current(), items = m.items;
    m = null; ended = performance.now();
    host.readout(null);
    if (accept) host.commit(items, t); else host.cancel();
  }

  addEventListener('pointermove', (e) => { if (!m) return; m.at = host.local(e); m.fine = e.shiftKey; m.step = e.ctrlKey || e.metaKey; update(); }, true);
  addEventListener('pointerdown', (e) => {
    if (!m) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.button === 0) finish(true); else if (e.button === 2) finish(false);
  }, true);
  addEventListener('contextmenu', (e) => { if (m || performance.now() - ended < 400) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  addEventListener('keydown', (e) => {
    if (!m) return;
    const k = e.key.toLowerCase();
    if (k === 'shift' || k === 'control' || k === 'meta' || k === 'alt') { m.fine = e.shiftKey; m.step = e.ctrlKey || e.metaKey; update(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (k === 'escape') finish(false);
    else if (k === 'enter' || k === ' ') finish(true);
    else if (k === 'x' || k === 'y' || k === 'z') {
      if (!m.scene && k === 'z') return; // a flat space has no depth
      const plane = e.shiftKey && m.mode !== 'rotate' && !!m.scene;
      if (m.axis === k && m.plane === plane) { m.axis = null; m.plane = false; } else { m.axis = k; m.plane = plane; }
      update();
    } else if (/^[0-9.]$/.test(k) || k === '-' || k === 'backspace') {
      if (k === 'backspace') m.typed = m.typed.slice(0, -1);
      else if (k === '-') m.typed = m.typed.startsWith('-') ? m.typed.slice(1) : '-' + m.typed;
      else if (k !== '.' || !m.typed.includes('.')) m.typed += k;
      update();
    } else if (k === 'g' || k === 'r' || k === 's') {
      // another of the three: switch to it, from where it began
      const mode = { g: 'grab', r: 'rotate', s: 'scale' }[k];
      if (mode !== m.mode) { m.mode = mode; m.axis = null; m.plane = false; m.typed = ''; update(); }
    }
  }, true);
  addEventListener('keyup', (e) => { if (m && (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta')) { m.fine = e.shiftKey; m.step = e.ctrlKey || e.metaKey; update(); } }, true);

  return { start, get active() { return !!m; } };
}
