// What the context menu does to a selection that is not one command already:
// snapping to the grid, and copying out as SVG or p5 code. Pure functions
// over plain data; main.js turns their results into commands.

// A line's points on a grid of step q. 'points' moves each point to the
// nearest grid point; 'tidy' then merges repeated points and drops points on
// straight runs. Returns the indices kept (to keep the pen in step) and the points.
export function snapPoints(points, q, mode = 'points') {
  const at = points.map((p) => [Math.round(p[0] / q) * q, Math.round(p[1] / q) * q, ...p.slice(2)].map((v) => Math.round(v * 1e4) / 1e4));
  let keep = at.map((_, i) => i);
  if (mode === 'tidy') {
    keep = keep.filter((i, n) => n === 0 || at[i][0] !== at[keep[n - 1]][0] || at[i][1] !== at[keep[n - 1]][1]);
    keep = keep.filter((i, n) => {
      if (n === 0 || n === keep.length - 1) return true;
      const a = at[keep[n - 1]], b = at[i], c = at[keep[n + 1]];
      return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-9;
    });
    if (keep.length < 2) keep = [0, at.length - 1];
  }
  return { keep, points: keep.map((i) => at[i]) };
}

// How far to move a box so its top left corner, or its centre, lands on the grid.
export function snapBox(r, q, mode) {
  const x = mode === 'center' ? r.cx : r.cx - r.w / 2, y = mode === 'center' ? r.cy : r.cy + r.h / 2;
  return [Math.round(x / q) * q - x, Math.round(y / q) * q - y];
}

// marks: [{ pts: [[x, y]...], closed?, stroke, fill, width } | { rect, shape, stroke, fill, width }],
// in canvas units with y up. The picture is drawn at `scale` pixels to a unit.
function bounds(marks) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of marks) {
    const pts = m.pts ?? [[m.rect.cx - m.rect.w / 2, m.rect.cy - m.rect.h / 2], [m.rect.cx + m.rect.w / 2, m.rect.cy + m.rect.h / 2]];
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  }
  return { x0, y0, x1, y1 };
}
const f = (v) => +v.toFixed(2);

export function toSVG(marks, scale = 40) {
  if (!marks.length) return '';
  const b = bounds(marks), pad = 8, w = (b.x1 - b.x0) * scale + pad * 2, h = (b.y1 - b.y0) * scale + pad * 2;
  const X = (x) => f((x - b.x0) * scale + pad), Y = (y) => f((b.y1 - y) * scale + pad);
  const look = (m) => `fill="${m.fill ?? 'none'}" stroke="${m.stroke ?? '#1d1c1a'}" stroke-width="${f(m.width ?? 2.2)}" stroke-linecap="round" stroke-linejoin="round"`;
  const body = marks.map((m) => {
    if (m.pts) return `  <path d="M${m.pts.map((p) => `${X(p[0])} ${Y(p[1])}`).join(' L')}${m.closed ? ' Z' : ''}" ${look(m)}/>`;
    const r = m.rect;
    if (m.shape === 'ellipse') return `  <ellipse cx="${X(r.cx)}" cy="${Y(r.cy)}" rx="${f(r.w / 2 * scale)}" ry="${f(r.h / 2 * scale)}" ${look(m)}/>`;
    return `  <rect x="${X(r.cx - r.w / 2)}" y="${Y(r.cy + r.h / 2)}" width="${f(r.w * scale)}" height="${f(r.h * scale)}" ${look(m)}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}">\n${body.join('\n')}\n</svg>\n`;
}

export function toP5(marks, scale = 40) {
  if (!marks.length) return '';
  const b = bounds(marks), pad = 8, w = Math.ceil((b.x1 - b.x0) * scale + pad * 2), h = Math.ceil((b.y1 - b.y0) * scale + pad * 2);
  const X = (x) => f((x - b.x0) * scale + pad), Y = (y) => f((b.y1 - y) * scale + pad);
  const look = (m) => `  ${m.fill ? `fill('${m.fill}')` : 'noFill()'}; stroke('${m.stroke ?? '#1d1c1a'}'); strokeWeight(${f(m.width ?? 2.2)});`;
  const body = marks.map((m) => {
    if (m.pts) return `${look(m)}\n  beginShape();\n${m.pts.map((p) => `  vertex(${X(p[0])}, ${Y(p[1])});`).join('\n')}\n  endShape(${m.closed ? 'CLOSE' : ''});`;
    const r = m.rect;
    return `${look(m)}\n  ${m.shape === 'ellipse' ? `ellipse(${X(r.cx)}, ${Y(r.cy)}, ${f(r.w * scale)}, ${f(r.h * scale)})` : `rect(${X(r.cx - r.w / 2)}, ${Y(r.cy + r.h / 2)}, ${f(r.w * scale)}, ${f(r.h * scale)})`};`;
  });
  return `function setup() {\n  createCanvas(${w}, ${h});\n}\n\nfunction draw() {\n  background(255);\n${body.join('\n')}\n}\n`;
}
