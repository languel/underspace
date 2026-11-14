// Point glyphs: how a point, a joint or a Midinous node looks. The shapes are
// Artist Model Studio's node brush (src/workbench/icons.js, nodeIcon): note a
// square, cc a circle, gate a D, LED a diamond, counter a hexagon, switch an
// octagon with a bar, terminator a cross, anchor a dot; and plain marks: dot,
// ring, cross, plus. Pure: outlines as polylines, for the renderer.
//
//   glyphLines(kind, [cx, cy], r) -> [{ pts, closed, fill }]   r: the half size, in the caller's units

export const POINT_KINDS = ['dot', 'ring', 'plus', 'note', 'cc', 'gate', 'led', 'counter', 'switch', 'terminator', 'anchor'];
export const MIDINOUS_KINDS = ['note', 'cc', 'gate', 'led', 'counter', 'switch', 'terminator', 'anchor'];
export const GLYPH_TITLE = {
  dot: 'Dot', ring: 'Ring', plus: 'Plus', note: 'Note: plays a note', cc: 'Controller: sends a CC', gate: 'Gate: lets through when lit',
  led: 'LED: lights up', counter: 'Counter: every nth goes on', switch: 'Switch: on and off in turn', terminator: 'Terminator: stops travelers', anchor: 'Anchor: a silent corner',
};

const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const polygon = (cx, cy, r, n, turn = 0) => Array.from({ length: n + 1 }, (_, i) => { const a = turn + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });

export function glyphLines(kind, [cx, cy], r) {
  const k = r * 0.86;
  switch (kind) {
    case 'ring': return [{ pts: circle(cx, cy, r), closed: true }];
    case 'plus': return [{ pts: [[cx - r, cy], [cx + r, cy]] }, { pts: [[cx, cy - r], [cx, cy + r]] }];
    case 'note': return [{ pts: [[cx - k, cy - k], [cx + k, cy - k], [cx + k, cy + k], [cx - k, cy + k], [cx - k, cy - k]], closed: true, fill: true }];
    case 'cc': return [{ pts: circle(cx, cy, r), closed: true, fill: true }];
    case 'gate': {
      // a D: flat on the left, round on the right
      const arc = Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + (i / 12) * Math.PI; return [cx + Math.cos(a) * k, cy + Math.sin(a) * k]; });
      return [{ pts: [[cx - k, cy - k], ...arc, [cx - k, cy + k], [cx - k, cy - k]], closed: true, fill: true }];
    }
    case 'led': return [{ pts: polygon(cx, cy, r * 1.1, 4), closed: true, fill: true }];
    case 'counter': return [{ pts: polygon(cx, cy, r, 6, Math.PI / 2), closed: true, fill: true }];
    case 'switch': return [{ pts: polygon(cx, cy, r, 8, Math.PI / 8), closed: true }, { pts: [[cx - k * 0.7, cy], [cx + k * 0.7, cy]] }];
    case 'terminator': return [{ pts: [[cx - k, cy - k], [cx + k, cy + k]] }, { pts: [[cx - k, cy + k], [cx + k, cy - k]] }];
    case 'anchor': return [{ pts: circle(cx, cy, r * 0.45, 12), closed: true, fill: true }];
    default: return [{ pts: circle(cx, cy, r * 0.6, 16), closed: true, fill: true }]; // dot
  }
}

// The same shapes as 16 by 16 icons (for menus and the tool), in the icons.js path language.
export const GLYPH_ICONS = {
  dot: 'M8 10a2 2 0 100-4 2 2 0 000 4z', ring: 'M8 12.500a4.500 4.500 0 100-9 4.500 4.500 0 000 9z', plus: 'M8 3v10 M3 8h10',
  note: 'M3.500 3.500h9v9h-9z', cc: 'M8 12.700a4.700 4.700 0 100-9.400 4.700 4.700 0 000 9.400z', gate: 'M3.500 3.500H8a4.500 4.500 0 010 9H3.500z',
  led: 'M8 2.500L13.500 8 8 13.500 2.500 8z', counter: 'M8 3l4.300 2.500v5L8 13l-4.300-2.500v-5z', switch: 'M6 3h4l3 3v4l-3 3H6l-3-3V6z M5 8h6',
  terminator: 'M4 4l8 8 M12 4l-8 8', anchor: 'M8 9.700a1.700 1.700 0 100-3.400 1.700 1.700 0 000 3.400z',
};
