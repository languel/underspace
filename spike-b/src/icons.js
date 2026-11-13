// Glyphs for the toolbar: 16 by 16, drawn with the current colour.

const PATHS = {
  select: 'M3 2l9 6-4.2 1 2.2 4.2-1.8 1L6 10 3 12.5z',
  draw: 'M2 12c2-7 4 3 6-3s3-5 6-6',
  box: 'M4 4h8v8H4z M2.5 8h1.5 M12 8h1.5',
  scene: 'M8 2l5 3v6l-5 3-5-3V5z M3 5l5 3 5-3 M8 8v6',
  code: 'M6 4L2 8l4 4 M10 4l4 4-4 4',
  collapse: 'M2 2l4 4 M6 3v3H3 M14 14l-4-4 M10 13v-3h3',
  expand: 'M6 6L2 2 M2 5V2h3 M10 10l4 4 M14 11v3h-3',
  remove: 'M4 4l8 8 M12 4l-8 8',
  undo: 'M5 3L2 6l3 3 M2 6h7a4 4 0 010 8H6',
  fit: 'M2 6V2h4 M10 2h4v4 M14 10v4h-4 M6 14H2v-4',
  save: 'M8 2v8 M5 7l3 3 3-3 M3 13h10',
  open: 'M8 10V2 M5 5l3-3 3 3 M3 13h10',
  clear: 'M3 4h10 M6 4V2h4v2 M4.5 4l.8 10h5.4l.8-10',
  side: 'M2 3h12v10H2z M10 3v10',
  clean: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
};

export const icon = (name) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
