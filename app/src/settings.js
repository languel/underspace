// Settings: what belongs to this browser, not to the drawing. Kept in
// localStorage; nothing here is part of the take.

const KEY = 'underspace-settings';
export const DEFAULTS = {
  theme: 'auto',        // 'auto' | 'light' | 'dark'
  grid: true, gridSize: 1, snap: false,
  stroke: null, fill: null, width: 2.2, // the look new lines and shapes take; null is the default ink
  brush: '', planeBrush: '',            // the ink brush new lines and new shapes take ('' is a plain line)
  brushParams: {},                      // brush id -> the parameters last set for it
  sculpt: 'push', sculptRadius: 40, sculptStrength: 0.6, sculptParams: {}, // radius in pixels
  smooth: true, simplify: 1.5,          // new lines: drawn smooth; points within this many pixels of the line are dropped
  codePreset: 'osc', scoreBrush: 'glissando', targetPlane: 'view', // what the object tools make
  islands: {},          // where toolbars were dragged to: id -> [x, y]
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
