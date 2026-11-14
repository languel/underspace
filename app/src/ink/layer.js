// The ink layer: a 2D canvas under the three.js one, where brushed marks are
// painted. Brushes work in brush units with y down; UNIT of them make one
// canvas unit, so a brush's widths read as pixels at 100% zoom.

import { BRUSHES, resolveParams, mulberry32 } from './brushes.js';
import { txBeginFrame } from './texture.js';

export const UNIT = 64;

// An object's points as a brush sees them: [x, y, time (ms), pressure].
export function element(points, pen, { closed = false, color, role = 'line' } = {}) {
  return {
    points: points.map((p, i) => [p[0] * UNIT, -p[1] * UNIT, pen?.[i]?.[0] ?? i * 16, pen?.[i]?.[1] ?? 0.5]),
    closed, color, role,
  };
}

export function createInk(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  return {
    resize(w, h) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    },
    // items: [{ e, brush, params, seed, straight, opacity, ox, oy, scale }]; a brush unit lands at [ox, oy] + unit * scale pixels
    draw(items) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      txBeginFrame();
      for (const it of items) {
        const b = BRUSHES[it.brush];
        if (!b) continue;
        ctx.setTransform(dpr * it.scale, 0, 0, dpr * it.scale, dpr * it.ox, dpr * it.oy);
        ctx.globalAlpha = it.opacity ?? 1;
        b.draw(ctx, it.e, resolveParams(it.brush, it.params), { rng: mulberry32(it.seed || 1), scale: it.scale * dpr, straight: it.straight });
      }
    },
  };
}
