// Music: the context a drawing is heard in, and the maps from space to it.
//
// After IanniX (a score's objects read one transport clock) and Midinous (by
// way of languel/midinojs and Artist Model Studio: named scales, steps through
// a scale, distance on the grid as time in beats). Pure: no DOM, no audio.
//
// The context is document state (the music.set command):
//   { bpm, meter: [beats in a bar, note value], scale, root, low, high }
// scale is a name below, or a list of steps in semitones from the root within
// an octave (fractions are allowed: [0, 2.04, 3.86, 4.98, 7.02, 8.84, 10.88]
// is near just intonation).

export const DEFAULT_MUSIC = { bpm: 120, meter: [4, 4], scale: 'Chromatic', root: 60, low: 48, high: 84 };

// Intervals between the notes of each scale, in semitones (the Midinous set).
export const SCALES = {
  'Aeolian': [2, 1, 2, 2, 1, 2, 2], // Minor
  'Altered': [1, 2, 1, 2, 2, 2, 2],
  'Augmented': [3, 1, 3, 1, 3, 1],
  'Blues': [3, 2, 1, 1, 3, 2],
  'Chromatic': [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  'Dorian': [2, 1, 2, 2, 2, 1, 2],
  'Flamenco': [1, 3, 1, 2, 1, 3, 1],
  'Half Diminished': [2, 1, 2, 1, 2, 2, 2],
  'Harmonic Major': [2, 2, 1, 2, 1, 3, 1],
  'Harmonic Minor': [2, 1, 2, 2, 1, 3, 1],
  'Hirajoshi': [4, 2, 1, 4, 1],
  'Hungarian': [2, 1, 3, 1, 1, 3, 1],
  'Insen': [1, 4, 2, 4, 2],
  'Ionian': [2, 2, 1, 2, 2, 2, 1], // Major
  'Iwato': [1, 4, 1, 4, 2],
  'Locrian': [1, 2, 2, 1, 2, 2, 2],
  'Locrian Major': [2, 2, 1, 1, 2, 2, 2],
  'Lydian': [2, 2, 2, 1, 2, 2, 1],
  'Lydian Augmented': [2, 2, 2, 2, 1, 2, 1],
  'Pentatonic Major': [2, 2, 3, 2, 3],
  'Pentatonic Minor': [3, 2, 2, 3, 2],
  'Melodic Minor': [2, 1, 2, 2, 2, 2, 1],
  'Mixolydian': [2, 2, 1, 2, 2, 1, 2],
  'Octatonic Whole': [2, 1, 2, 1, 2, 1, 2, 1],
  'Octatonic Half': [1, 2, 1, 2, 1, 2, 1, 2],
  'Persian': [1, 3, 1, 1, 2, 3, 1],
  'Phrygian': [1, 2, 2, 2, 1, 2, 2],
  'Prometheus': [2, 2, 2, 3, 1, 2],
  'Tritone': [1, 3, 2, 1, 3, 2],
  'Two Semitone Tritone': [1, 1, 4, 1, 1],
  'Ukrainian Dorian': [2, 1, 3, 1, 2, 1, 2],
  'Whole Tone': [2, 2, 2, 2, 2, 2]
};

const KEY = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
const BY_KEY = new Map(Object.keys(SCALES).map((n) => [KEY(n), n]));
export const scaleNames = () => Object.keys(SCALES);
// The canonical name of a scale, or null.
export const scaleName = (n) => BY_KEY.get(KEY(n)) || null;

// The degrees of a scale within an octave, from the root: [0, 2, 4, 5, 7, 9, 11] for Ionian.
export function degrees(scale) {
  if (Array.isArray(scale) && scale.length) return [...new Set(scale.map(Number).filter(Number.isFinite).map((d) => ((d % 12) + 12) % 12))].sort((a, b) => a - b);
  const steps = SCALES[scaleName(scale) ?? 'Chromatic'], out = [0];
  for (let i = 0; i < steps.length - 1; i++) out.push(out[i] + steps[i]);
  return out;
}

const cache = new Map();
// Every note of the scale over the MIDI range, low to high (fractional for a tuning).
export function scaleNotes(scale = 'Chromatic', root = 60) {
  const r = ((root % 12) + 12) % 12, key = JSON.stringify([scale, r]);
  let notes = cache.get(key);
  if (!notes) {
    const d = degrees(scale);
    notes = [];
    for (let o = -1; o <= 11; o++) for (const x of d) { const n = r + o * 12 + x; if (n >= 0 && n <= 127) notes.push(n); }
    if (cache.size > 200) cache.clear();
    cache.set(key, notes);
  }
  return notes;
}
// The note of the scale nearest n.
export function snap(n, scale = 'Chromatic', root = 60) {
  const notes = scaleNotes(scale, root);
  let best = notes[0], d = Infinity;
  for (const s of notes) { const k = Math.abs(s - n); if (k < d) { d = k; best = s; } }
  return best;
}
// k steps of the scale up (or down) from n: an interval counted in degrees.
export function step(n, k, scale = 'Chromatic', root = 60) {
  const notes = scaleNotes(scale, root), i = notes.indexOf(snap(n, scale, root));
  return notes[Math.max(0, Math.min(notes.length - 1, i + Math.round(k)))];
}
// A place 0..1 (up a frame, along a line) as a note: across the context's range, on its scale.
export const pitch = (v, m = DEFAULT_MUSIC) => snap(m.low + Math.max(0, Math.min(1, v)) * (m.high - m.low), m.scale, m.root);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => `${NAMES[((Math.round(n) % 12) + 12) % 12]}${Math.floor(Math.round(n) / 12) - 1}`;
export function noteNumber(name) {
  const m = String(name).match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) return 60;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + base;
}
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- time: beats and bars -----------------------------------------------------

export const secPerBeat = (m = DEFAULT_MUSIC) => 60 / Math.max(1, m.bpm ?? 120);
export const beatsToSec = (b, m) => b * secPerBeat(m);
export const secToBeats = (s, m) => s / secPerBeat(m);
// Seconds as bar.beat.sixteenth, counted from 1 (IanniX's and every DAW's way).
export function bbt(sec, m = DEFAULT_MUSIC) {
  const per = m.meter?.[0] ?? 4, beats = Math.max(0, secToBeats(sec, m) + 1e-9);
  const bar = Math.floor(beats / per), beat = Math.floor(beats - bar * per), six = Math.floor((beats - Math.floor(beats)) * 4);
  return `${bar + 1}.${beat + 1}.${six + 1}`;
}
// A length written as a time: a number (beats), '1 bar', '2 beats', '8n' (an eighth note), '1.5s'. In beats.
export function beatsOf(v, m = DEFAULT_MUSIC) {
  if (typeof v === 'number') return v;
  const s = String(v).trim(), per = m.meter?.[0] ?? 4;
  let x;
  if ((x = s.match(/^([\d.]+)\s*(bars?)$/))) return +x[1] * per;
  if ((x = s.match(/^([\d.]+)\s*(beats?)?$/))) return +x[1];
  if ((x = s.match(/^(\d+)n(t?)$/))) return (4 / +x[1]) * (x[2] ? 2 / 3 : 1);
  if ((x = s.match(/^([\d.]+)\s*s$/))) return secToBeats(+x[1], m);
  return 0;
}
