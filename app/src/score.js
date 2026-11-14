// A score reads the lines inside its frame: across is time, up is pitch.
// Pure: no DOM, no audio. The lines are never changed; snapping happens here.

export const SCALES = [
  null,                                   // 0 continuous
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // 1 chromatic
  [0, 2, 4, 5, 7, 9, 11],                 // 2 major
  [0, 2, 3, 5, 7, 8, 10],                 // 3 minor
  [0, 2, 4, 7, 9],                        // 4 pentatonic
  [0, 2, 4, 6, 8, 10],                    // 5 whole tone
  Array.from({ length: 24 }, (_, i) => i / 2), // 6 quarter tone
];
export const DEFAULTS = { bpm: 90, beats: 8, low: 48, high: 84, scale: 0, grid: 0 };
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function snapToScale(midi, steps, root = 0) {
  if (!steps) return midi;
  const rel = midi - root, octave = Math.floor(rel / 12), within = rel - octave * 12;
  let best = steps[0], bestD = Infinity;
  for (const s of [...steps, steps[0] + 12]) { const d = Math.abs(s - within); if (d < bestD) { bestD = d; best = s; } }
  return root + octave * 12 + best;
}

// Keep at most `max` points, always the first and last.
function thin(points, max) {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, k) => points[Math.round(k * (points.length - 1) / (max - 1))]);
}

// lines: [{ id, points: [[x, y], ...] }]; rect: the frame { cx, cy, w, h }.
// -> { voices: [{ id, events: [{ time (seconds), midi, hz, gain }] }], duration }
export function read(lines, rect, params = {}, maxEvents = 48) {
  const p = { ...DEFAULTS, ...params }, secPerBeat = 60 / Math.max(1, p.bpm), beats = Math.max(0.25, p.beats);
  // steps and root, when given, are the scale (the timeline's); otherwise the scale numbered `scale`
  const left = rect.cx - rect.w / 2, bottom = rect.cy - rect.h / 2, steps = p.steps ?? SCALES[Math.round(p.scale)] ?? null;
  const voices = [];
  for (const l of lines) {
    // only the part of the line that is inside the frame is heard
    const inside = l.points.filter((pt) => pt[0] >= left && pt[0] <= left + rect.w && pt[1] >= bottom && pt[1] <= bottom + rect.h);
    if (!inside.length) continue;
    const events = thin(inside, maxEvents).map((pt) => {
      let beat = ((pt[0] - left) / rect.w) * beats;
      if (p.grid > 0) beat = Math.round(beat / p.grid) * p.grid;
      const midi = snapToScale(p.low + ((pt[1] - bottom) / rect.h) * (p.high - p.low), steps, p.root ?? 0);
      return { time: beat * secPerBeat, midi, hz: midiToHz(midi), gain: 0.7 };
    });
    // Time only runs forward: a line drawn right to left is read left to right.
    events.sort((a, b) => a.time - b.time);
    voices.push({ id: l.id, events });
  }
  return { voices, duration: beats * secPerBeat, bpm: p.bpm };
}
