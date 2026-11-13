// Brushes are code. A brush receives the whole selection at once, already
// read into time and pitch, and schedules sound on the audio clock.
//
//   voices: [{ id, events: [{ time, midi, hz, gain }] }]   time in seconds from the start
//   ctx:    { audio, out, t0, duration, bpm }               connect to ctx.out, schedule at ctx.t0 + time

export const PRESETS = {
  glissando: `// glissando: each line is one bowed voice that follows its own shape.
const MAX = 64;                       // voices the browser can carry comfortably
for (const v of voices.slice(0, MAX)) {
  const e = v.events;
  if (!e.length) continue;
  const osc = ctx.audio.createOscillator();
  const tone = ctx.audio.createBiquadFilter();
  const amp = ctx.audio.createGain();
  osc.type = 'sawtooth';
  tone.frequency.value = 1600;
  osc.connect(tone).connect(amp).connect(ctx.out);

  const level = 0.5 / Math.sqrt(Math.min(voices.length, MAX));
  const start = ctx.t0 + e[0].time;
  const end = Math.max(start + 0.12, ctx.t0 + e[e.length - 1].time);

  osc.frequency.setValueAtTime(e[0].hz, start);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(level * e[0].gain, start + 0.03);
  for (const p of e.slice(1)) {
    const t = Math.max(start + 0.031, ctx.t0 + p.time);
    osc.frequency.exponentialRampToValueAtTime(p.hz, t);
    amp.gain.linearRampToValueAtTime(level * p.gain, t);
  }
  amp.gain.setValueAtTime(level * e[e.length - 1].gain, end);
  amp.gain.linearRampToValueAtTime(0, end + 0.08);
  osc.start(start);
  osc.stop(end + 0.1);
}
`,
  pizzicato: `// pizzicato: each mark is one plucked note, where the mark begins.
for (const v of voices.slice(0, 200)) {
  const e = v.events[0];
  if (!e) continue;
  const osc = ctx.audio.createOscillator();
  const amp = ctx.audio.createGain();
  osc.type = 'triangle';
  osc.frequency.value = e.hz;
  osc.connect(amp).connect(ctx.out);
  const t = ctx.t0 + e.time;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.25 * e.gain, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
  osc.start(t);
  osc.stop(t + 0.4);
}
`,
  clusters: `// clusters: every point of every mark is a short grain. Dense drawings become clouds.
let n = 0;
for (const v of voices) for (const e of v.events) {
  if (n++ > 600) break;
  const osc = ctx.audio.createOscillator();
  const amp = ctx.audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = e.hz;
  osc.connect(amp).connect(ctx.out);
  const t = ctx.t0 + e.time;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.06 * e.gain, t + 0.01);
  amp.gain.linearRampToValueAtTime(0, t + 0.12);
  osc.start(t);
  osc.stop(t + 0.14);
}
`,
};
