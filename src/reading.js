// A reading turns the shape of marks into time and pitch.
// Pure functions: no DOM, no audio. Tested in Node (test/reading.test.js).
//
// A point is [x, y, z, t, p]: position, the second it was drawn, pressure.

export const CH = { x: 0, y: 1, z: 2, t: 3, p: 4 };

// A scale is a list of pitches in semitones above the root, within one octave.
// Fractions are allowed, so a scale need not be 12-tone.
export const SCALES = {
  continuous: null,
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  'whole tone': [0, 2, 4, 6, 8, 10],
  'quarter tone': Array.from({ length: 24 }, (_, i) => i / 2),
};

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const defaultReading = () => ({
  time: 'x',        // channel read as time
  pitch: 'y',       // channel read as pitch
  beats: 16,        // length of the whole selection, in beats
  low: 40, high: 88, // pitch range, MIDI note numbers
  quant: 'off',     // 'off' | 'starts' | 'all'
  grid: 0.25,       // snap step in beats
  scale: 'continuous',
  root: 0,          // 0 = C
});

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function extent(marks, channel) {
  const i = CH[channel];
  let min = Infinity, max = -Infinity;
  for (const m of marks) for (const pt of m.points) {
    if (pt[i] < min) min = pt[i];
    if (pt[i] > max) max = pt[i];
  }
  if (min === Infinity) return [0, 1];
  return [min, max];
}

export function snapToScale(midi, scaleName, root = 0) {
  const steps = SCALES[scaleName];
  if (!steps) return midi;
  const rel = midi - root;
  const octave = Math.floor(rel / 12);
  const within = rel - octave * 12;
  let best = steps[0], bestD = Infinity;
  for (const s of [...steps, steps[0] + 12]) {
    const d = Math.abs(s - within);
    if (d < bestD) { bestD = d; best = s; }
  }
  return root + octave * 12 + best;
}

const snap = (v, step) => Math.round(v / step) * step;

// Keep at most `max` points of a path, always keeping the first and last.
function thin(points, max) {
  if (points.length <= max) return points;
  const out = [];
  for (let k = 0; k < max; k++) out.push(points[Math.round(k * (points.length - 1) / (max - 1))]);
  return out;
}

// read(marks, reading, { bpm }) -> { voices, duration, timeExtent, pitchExtent }
// voices: [{ id, events: [{ time (seconds), midi, hz, gain }] }]
// The marks are never changed: snapping happens here, on read.
export function read(marks, reading, { bpm = 90, maxEvents = 48 } = {}) {
  const r = { ...defaultReading(), ...reading };
  const secPerBeat = 60 / bpm;
  const duration = r.beats * secPerBeat;
  const timeExtent = extent(marks, r.time);
  const pitchExtent = extent(marks, r.pitch);
  const tSpan = (timeExtent[1] - timeExtent[0]) || 1;
  const pSpan = (pitchExtent[1] - pitchExtent[0]) || 1;
  const ti = CH[r.time], pi = CH[r.pitch];

  const voices = [];
  for (const m of marks) {
    let events = thin(m.points, maxEvents).map((pt) => {
      const beat = ((pt[ti] - timeExtent[0]) / tSpan) * r.beats;
      const norm = pitchExtent[1] === pitchExtent[0] ? 0.5 : (pt[pi] - pitchExtent[0]) / pSpan;
      const midi = snapToScale(r.low + norm * (r.high - r.low), r.scale, r.root);
      return { beat, midi, gain: 0.35 + 0.65 * (pt[CH.p] ?? 0.5) };
    });
    // Time only runs forward: a path drawn right to left is read left to right.
    events.sort((a, b) => a.beat - b.beat);

    if (r.quant === 'all' && r.grid > 0) {
      for (const e of events) e.beat = snap(e.beat, r.grid);
    } else if (r.quant === 'starts' && r.grid > 0 && events.length) {
      const shift = snap(events[0].beat, r.grid) - events[0].beat;
      for (const e of events) e.beat += shift;
    }

    voices.push({
      id: m.id,
      events: events.map((e) => ({ time: Math.max(0, e.beat * secPerBeat), midi: e.midi, hz: midiToHz(e.midi), gain: e.gain })),
    });
  }
  return { voices, duration, timeExtent, pitchExtent };
}
