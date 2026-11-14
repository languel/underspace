// Settings: what belongs to this browser, not to the drawing. Kept in
// localStorage; nothing here is part of the take.

const KEY = 'underspace-settings';
export const DEFAULTS = {
  theme: 'auto',        // 'auto' | 'light' | 'dark'
  grid: true, gridSize: 1, snap: false,
  wheel: 'auto',        // what the mouse wheel does: 'auto' (a wheel zooms, a trackpad pans), 'zoom', 'pan'
  stroke: null, fill: null, width: 2.2, // the look new lines and shapes take; null is the default ink
  brush: '', planeBrush: '',            // the ink brush new lines and new shapes take ('' is a plain line)
  brushParams: {},                      // brush id -> the parameters last set for it
  sculpt: 'push', sculptRadius: 40, sculptStrength: 0.6, sculptParams: {}, // radius in pixels
  pointGlyph: 'dot', pointSize: 14,  // the point tool: the glyph it places, and its size in pixels when placed
  polySides: 6, polyStar: false,      // the polygon tool
  showCrossings: false, // a small mark where lines cross without a joint
  quant: 0.25, quantOn: false, // sliding along a line: snapped to this many beats of the time along it, while on (Q)
  pressureWidth: 'targets', // where a stroke's pen pressure is its width (grease pencil): 'targets', 'everywhere', 'off'
  magnet: 'auto', magnetCell: 0.5, // in render targets: what a point placed snaps to (magnet.js), and the plane's lattice
  metronome: false,    // a click on each beat while playing
  codeOverlay: true, codeOpacity: 0.85, // the code shown on an object zoomed into: on or off (;), how solid its ground is
  smooth: true, simplify: 1.5,          // new lines: drawn smooth; points within this many pixels of the line are dropped
  codePreset: 'osc', scoreBrush: 'glissando', targetPlane: 'view', // what the object tools make
  islands: {},          // where toolbars were dragged to: id -> [x, y]
  showPoints: false,    // control points shown in every tool (')
  stacks: {},           // the tool each stack last used
  panel: 'code', panelOpen: false,
  assistBase: 'http://127.0.0.1:11434', assistModel: '',
};

let stored = {};
try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* start from the defaults */ }
export const settings = { ...DEFAULTS, ...stored };

const listeners = new Set();
export const onSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function setSetting(key, value) {
  if (settings[key] === value) return;
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: it still works for the session */ }
  for (const fn of listeners) fn(key, value);
}
export function resetSettings() { for (const [k, v] of Object.entries(DEFAULTS)) setSetting(k, v); }
