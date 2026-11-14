// Grids: how space, time and pitch are quantized. After Artist Model Studio's
// path time (src/score/compile.js: a path's length read as time through the
// grid, `beatUnits` to a beat, measured along it, across or at right angles,
// rounded to a division) and Midinous (a grid cell is a beat, a row a degree).
//
// There is one global grid (document state, grid.set) and any number of grid
// frames: shapes with the role 'grid', drawn like a score frame, whose
// parameters are a grid for what lies inside them. Pure: no DOM.
//
//   cell    canvas units a cell                       space
//   sub     snap points a cell (2: halves)            space
//   beats   beats a cell of path, 0: travelers keep their own dur
//   metric  how a path is measured: 0 along it, 1 at right angles (Midinous), 2 across only (a score)
//   bars    a path's time is rounded to this many beats (4: whole bars of 4/4), 0: not rounded
//   rows    scale degrees a cell up: pitch by row, 0: pitch from height (continuous)
//   snap    1: drawing in it snaps to its points

export const GRID_KEYS = ['cell', 'sub', 'beats', 'metric', 'bars', 'rows', 'snap'];
export const DEFAULT_GRID = { cell: 1, sub: 1, beats: 0, metric: 0, bars: 0, rows: 0, snap: 0 };

// A grid frame's code: only its parameters (the header is its blanket, so panels show them).
export const GRID = `// grid
// param: cell 1
// param: sub 1
// param: beats 1
// param: metric 0
// param: bars 0
// param: rows 0
// param: snap 1
// A grid for what lies inside: cell (units), sub (snap points a cell), beats (a cell of path),
// metric (0 along, 1 right angles, 2 across), bars (round path times to this many beats),
// rows (scale degrees a cell up), snap (drawing snaps to its points).`;

// Grid frames ready made (the preset menu of the Code panel).
const make = (name, g, note) => `// ${name}
` + ['cell', 'sub', 'beats', 'metric', 'bars', 'rows', 'snap'].map((k) => `// param: ${k} ${g[k] ?? DEFAULT_GRID[k]}`).join('\n') + `
// ${note}`;
export const GRID_PRESETS = {
  'a cell a beat': make('a cell a beat', { beats: 1, snap: 1 }, 'a path a cell long takes a beat, measured along it'),
  midinous: make('midinous', { beats: 1, metric: 1, snap: 1 }, 'at right angles, a cell a beat, points on the grid (Midinous)'),
  'whole bars': make('whole bars', { beats: 1, bars: 4, snap: 1, sub: 2 }, 'a path takes a whole number of bars of 4, whatever its length'),
  'score rows': make('score rows', { beats: 1, metric: 2, rows: 1, sub: 4, snap: 1 }, 'across is time, a cell a beat; each row up is the next degree of the scale'),
  'half beats': make('half beats', { beats: 0.5, sub: 2, snap: 1 }, 'a cell is half a beat: twice as quick'),
  'triplets': make('triplets', { beats: 1, sub: 3, bars: 1, snap: 1 }, 'thirds of a cell to snap to; paths rounded to whole beats'),
};

export const isGrid = (o) => o?.kind === 'shape' && o.role === 'grid';
const clean = (g) => {
  const out = { ...DEFAULT_GRID };
  for (const k of GRID_KEYS) if (Number.isFinite(g?.[k])) out[k] = g[k];
  out.cell = Math.max(0.01, out.cell); out.sub = Math.max(1, Math.round(out.sub));
  return out;
};

// The grid in force at point p of a space: the smallest grid frame there that holds it, else the
// global grid. -> { ...settings, origin: [x, y] (a grid point: the frame's lower left corner), frame }
// paramsOf(frame) gives a frame's parameters.
export function gridAt(objects, space, p, global, paramsOf) {
  let best = null;
  for (const o of objects.values()) {
    if (!isGrid(o) || o.space !== space || o.hidden) continue;
    const r = o.rect;
    if (Math.abs(p[0] - r.cx) > r.w / 2 || Math.abs(p[1] - r.cy) > r.h / 2) continue;
    if (!best || r.w * r.h < best.rect.w * best.rect.h) best = o;
  }
  if (!best) return { ...clean(global), origin: [0, 0], frame: null };
  return { ...clean(paramsOf(best)), origin: [best.rect.cx - best.rect.w / 2, best.rect.cy - best.rect.h / 2], frame: best.id };
}

// The length of a path, measured the grid's way.
export function lengthBy(pts, metric = 0) {
  if (pts.length < 2) return 0;
  if (metric === 2) return Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0]));
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += metric === 1 ? Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]) : Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] ?? 0) - (pts[i - 1][2] ?? 0));
  return s;
}

// How many beats a path takes in a grid: its length in cells times beats a cell, rounded to
// whole groups of `bars` beats (at least one). 0 when the grid does not time paths (beats 0).
export function pathBeats(pts, g) {
  if (!(g.beats > 0)) return 0;
  const beats = (lengthBy(pts, g.metric) / g.cell) * g.beats;
  // a path the grid measures as nothing (a vertical line measured across) still takes a sixteenth
  return g.bars > 0 ? Math.max(g.bars, Math.round(beats / g.bars) * g.bars) : Math.max(0.25, beats);
}

// A point on the grid's lattice (cell / sub apart, from its origin), nearest p. A third coordinate stays.
export function snapPoint(p, g) {
  const q = g.cell / g.sub, f = (v, o) => o + Math.round((v - o) / q) * q;
  return [f(p[0], g.origin[0]), f(p[1], g.origin[1]), ...p.slice(2)];
}

// The cell p is in, counted from the grid's origin: [col, row].
export const cellOf = (p, g) => [Math.floor((p[0] - g.origin[0]) / g.cell + 1e-9), Math.floor((p[1] - g.origin[1]) / g.cell + 1e-9)];

// The scale that makes a path take exactly `beats` beats in the grid (its length, not its shape, changes).
export function fitScale(pts, g, beats) {
  const now = (lengthBy(pts, g.metric) / g.cell) * g.beats;
  return now > 0 && beats > 0 ? beats / now : 1;
}
