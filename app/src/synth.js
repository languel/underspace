// Synths you draw (after Xenakis's UPIC): a drawn curve is a part of a synth, and its shape is
// what it does. A curve made an oscillator is one cycle of its wave; an envelope, a level over
// time; a shaper, how its input maps to its output; partials, the strengths of the harmonics.
// Shapes are the parts with no curve: filter, amp, mix, noise, and out. Connectors between their
// ports wire them. An `out` part is an instrument: it plays the notes of a MIDI channel (its
// `channel` parameter, or music.set channels naming it), and each note builds a Web Audio voice
// from the drawing as it is then. Zoom out (or collapse the parts into a group) and it is one
// object; zoom in and it is the drawing that makes the sound.
//
// A part is an object with role "synth" whose code is only a header: its name is its kind, and its
// in, out and param lines are its ports and parameters (so faces, the Code panel and connectors
// work on it as on any code object). planInstrument() reads the parts and the wires into plain data
// (pure, tested); buildVoice() makes one note of it in an AudioContext.

import { ptsOf, along, smooth, parseBlanket } from './object.js';

const head = (name, lines) => [`// ${name}`, ...lines].join('\n');
// The parts: a line's kinds take their data from its curve; a shape's have only parameters.
export const SYNTH_PARTS = {
  osc: head('osc', ['// in: fm', '// out: audio', '// param: ratio 1', '// param: fm 300', '// param: level 1', '// one cycle of the wave is this curve, left to right; ratio times the note\'s pitch; fm: Hz per unit of what comes in']),
  partials: head('partials', ['// in: fm', '// out: audio', '// param: ratio 1', '// param: count 16', '// param: fm 300', '// param: level 1', '// additive: the height of this curve across is the strength of harmonics 1 to count']),
  env: head('env', ['// out: level', '// param: dur 0.6', '// param: release 0.3', '// a level over time: this curve, left to right, over dur seconds; held at its end while the note is; then to nothing over release']),
  shaper: head('shaper', ['// in: audio', '// out: audio', '// param: drive 1', '// a waveshaper: across is what comes in (-1 to 1), up is what goes out']),
  filter: head('filter', ['// in: audio cutoff', '// out: audio', '// param: type 0', '// param: hz 1200', '// param: q 1', '// param: depth 3000', '// type: 0 low pass, 1 high pass, 2 band pass; cutoff moves hz by depth per unit']),
  amp: head('amp', ['// in: audio level', '// out: audio', '// param: gain 1', '// with level wired, its loudness is the level (an envelope); else gain']),
  mix: head('mix', ['// in: a b c', '// out: audio', '// param: gain 0.6']),
  noise: head('noise', ['// out: audio', '// param: level 0.5']),
  out: head('out', ['// in: audio', '// param: channel 0', '// param: gain 0.5', '// the instrument: it plays the notes of MIDI channel `channel` (1 to 16; 0: only where music.set channels names it)']),
};
export const LINE_PARTS = ['osc', 'partials', 'env', 'shaper'];
export const SHAPE_PARTS = ['filter', 'amp', 'mix', 'noise', 'out'];
export const kindOf = (o) => (o?.role === 'synth' && o.code ? parseBlanket(o.code).name : null);
export const isOut = (o) => kindOf(o) === 'out';

const shown = (o) => { const p = ptsOf(o); return o.style?.path === 'straight' || p.length < 3 ? p : smooth(p); };
// n samples of the curve as drawn, read across: at n evenly spaced x from its left to its right, the
// height where the curve first passes that x (a curve is a function of time here, as on UPIC's page).
// A curve with no width (drawn straight up) is read along its length instead. -> [[x, y], ...]
function samples(o, n) {
  const p = shown(o);
  if (p.length < 2) return [];
  const dense = Array.from({ length: 1024 }, (_, i) => along(p, i / 1023)), xs = dense.map((q) => q[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 1e-6) return Array.from({ length: n }, (_, i) => along(p, i / (n - 1)));
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    for (let j = 1; j < dense.length; j++) {
      const a = dense[j - 1], b = dense[j];
      if ((a[0] - x) * (b[0] - x) <= 0) return [x, a[0] === b[0] ? a[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
    }
    return [x, dense.reduce((m, q) => (Math.abs(q[0] - x) < Math.abs(m[0] - x) ? q : m))[1]];
  });
}
const span = (v) => { const lo = Math.min(...v), hi = Math.max(...v); return [lo, hi - lo || 1]; };

// One cycle of the wave as the first `h` harmonics, for createPeriodicWave: { real, imag }.
export function waveOf(o, h = 48, n = 256) {
  const s = samples(o, n + 1).slice(0, n).map((q) => q[1]);
  const real = new Float32Array(h + 1), imag = new Float32Array(h + 1);
  if (!s.length) { imag[1] = 1; return { real, imag }; }
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  for (let k = 1; k <= h; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * k * i) / n, y = s[i] - mean; re += y * Math.cos(a); im += y * Math.sin(a); }
    real[k] = (2 * re) / n; imag[k] = (2 * im) / n;
  }
  return { real, imag };
}
// Additive: harmonic k's strength is the curve's height (0 at its lowest, 1 at its highest) at k of count across.
export function partialsOf(o, count = 16) {
  const n = Math.max(1, Math.min(64, Math.round(count))), s = samples(o, Math.max(2, n)), [lo, d] = span(s.map((q) => q[1]));
  const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) imag[k] = ((s[Math.min(s.length - 1, k - 1)]?.[1] ?? lo) - lo) / d;
  return { real, imag };
}
// A level over time, 0 (the curve's lowest) to 1 (its highest): n values.
export function envOf(o, n = 64) {
  const s = samples(o, n);
  if (!s.length) return new Float32Array([1, 1]);
  const [lo, d] = span(s.map((q) => q[1]));
  return Float32Array.from(s, (q) => (q[1] - lo) / d);
}
// A waveshaper's curve: n values from -1 to 1, read across.
export function shaperOf(o, n = 257) {
  const s = samples(o, n);
  if (!s.length) return Float32Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2 - 1);
  const [lo, d] = span(s.map((q) => q[1]));
  return Float32Array.from(s, (q) => ((q[1] - lo) / d) * 2 - 1);
}

const paramsOf = (o) => { const p = {}; for (const q of parseBlanket(o.code).params) p[q.name] = o.params?.[q.name] ?? q.value; return p; };

// Everything the instrument `outId` is made of, as data: the parts that feed it (following the
// wires back from it) and the wires between them. -> { out, parts: [{ id, kind, p, data? }], wires: [{ from, fromPort, to, toPort }] } | null
export function planInstrument(objects, outId) {
  const out = objects.get(outId);
  if (!isOut(out)) return null;
  const wires = [...objects.values()].filter((w) => w.bind && kindOf(objects.get(w.bind.from.id)) && kindOf(objects.get(w.bind.to.id))).map((w) => ({ from: w.bind.from.id, fromPort: w.bind.from.port, to: w.bind.to.id, toPort: w.bind.to.port }));
  const need = new Set([outId]), queue = [outId];
  while (queue.length) { const id = queue.shift(); for (const w of wires) if (w.to === id && !need.has(w.from)) { need.add(w.from); queue.push(w.from); } }
  const parts = [...need].map((id) => {
    const o = objects.get(id), kind = kindOf(o), p = paramsOf(o);
    const data = kind === 'osc' ? waveOf(o) : kind === 'partials' ? partialsOf(o, p.count) : kind === 'env' ? envOf(o) : kind === 'shaper' ? shaperOf(o) : undefined;
    return { id, kind, p, ...(data ? { data } : {}) };
  });
  return { out: outId, parts, wires: wires.filter((w) => need.has(w.from) && need.has(w.to)) };
}

// The instrument a name stands for: an out part by id or by its name. -> id | null
export function instrumentId(objects, name) {
  const o = objects.get(name);
  if (isOut(o)) return o.id;
  for (const x of objects.values()) if (isOut(x) && x.name === name) return x.id;
  return null;
}
// The instrument that claims MIDI channel ch with its channel parameter. -> id | null
export function claimOf(objects, ch) {
  for (const x of objects.values()) if (isOut(x) && Math.round(paramsOf(x).channel) === ch) return x.id;
  return null;
}

// ---- sound -----------------------------------------------------------------------

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let noiseBuf = null;

// One note of the instrument: built from the plan, at `at`, for `seconds` (null: until stop()).
// -> { stop(when) }
export function buildVoice(ac, dest, plan, midi, velocity = 100, at = ac.currentTime + 0.005, seconds = 0.3) {
  const f0 = hz(midi), v = Math.max(0, Math.min(127, velocity)) / 127, sources = [], envs = [];
  const wired = new Set(plan.wires.map((w) => w.to + '.' + w.toPort));
  const gain = (g) => { const n = ac.createGain(); n.gain.value = g; return n; };
  const nodes = new Map(); // id -> { ins: { port: { node } | { param, scale } }, outs: { port: node } }
  let maxRelease = 0.05;
  for (const part of plan.parts) {
    const p = part.p, id = part.id;
    if (part.kind === 'osc' || part.kind === 'partials') {
      const o = ac.createOscillator(), lvl = gain(p.level ?? 1);
      o.setPeriodicWave(ac.createPeriodicWave(part.data.real, part.data.imag));
      o.frequency.value = f0 * (p.ratio || 1);
      o.connect(lvl); sources.push(o);
      nodes.set(id, { ins: { fm: { param: o.frequency, scale: p.fm ?? 300 } }, outs: { audio: lvl } });
    } else if (part.kind === 'noise') {
      if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } }
      const n = ac.createBufferSource(), lvl = gain(p.level ?? 0.5); n.buffer = noiseBuf; n.loop = true; n.connect(lvl); sources.push(n);
      nodes.set(id, { ins: {}, outs: { audio: lvl } });
    } else if (part.kind === 'env') {
      const c = ac.createConstantSource(), dur = Math.max(0.01, p.dur ?? 0.6);
      c.offset.value = part.data[0]; c.offset.setValueCurveAtTime(part.data, at, dur);
      sources.push(c); envs.push({ param: c.offset, release: Math.max(0.01, p.release ?? 0.3), until: at + dur });
      maxRelease = Math.max(maxRelease, p.release ?? 0.3);
      nodes.set(id, { ins: {}, outs: { level: c } });
    } else if (part.kind === 'shaper') {
      const pre = gain(p.drive ?? 1), ws = ac.createWaveShaper(); ws.curve = part.data; ws.oversample = '2x'; pre.connect(ws);
      nodes.set(id, { ins: { audio: { node: pre } }, outs: { audio: ws } });
    } else if (part.kind === 'filter') {
      const b = ac.createBiquadFilter(); b.type = ['lowpass', 'highpass', 'bandpass'][Math.round(p.type ?? 0)] ?? 'lowpass'; b.frequency.value = p.hz ?? 1200; b.Q.value = p.q ?? 1;
      nodes.set(id, { ins: { audio: { node: b }, cutoff: { param: b.frequency, scale: p.depth ?? 3000 } }, outs: { audio: b } });
    } else if (part.kind === 'amp') {
      const g = gain(wired.has(id + '.level') ? 0 : p.gain ?? 1);
      nodes.set(id, { ins: { audio: { node: g }, level: { param: g.gain, scale: p.gain ?? 1 } }, outs: { audio: g } });
    } else if (part.kind === 'mix') {
      const g = gain(p.gain ?? 0.6);
      nodes.set(id, { ins: { a: { node: g }, b: { node: g }, c: { node: g } }, outs: { audio: g } });
    } else if (part.kind === 'out') {
      const g = gain((p.gain ?? 0.5) * v);
      nodes.set(id, { ins: { audio: { node: g } }, outs: {}, g });
    }
  }
  for (const w of plan.wires) {
    const from = nodes.get(w.from)?.outs[w.fromPort], to = nodes.get(w.to)?.ins[w.toPort];
    if (!from || !to) continue;
    if (to.node) from.connect(to.node);
    else { const k = gain(to.scale ?? 1); from.connect(k); k.connect(to.param); }
  }
  // a short ramp in and out, so a note never clicks
  const vca = gain(0), out = nodes.get(plan.out);
  out.g.connect(vca); vca.connect(dest);
  vca.gain.setValueAtTime(0, at); vca.gain.linearRampToValueAtTime(1, at + 0.004);
  for (const s of sources) s.start(at);
  let stopped = false;
  const stop = (when = ac.currentTime) => {
    if (stopped) return; stopped = true;
    const t = Math.max(when, at + 0.005);
    for (const e of envs) { try { e.param.cancelAndHoldAtTime(t); } catch { e.param.cancelScheduledValues(t); } e.param.linearRampToValueAtTime(0, t + e.release); }
    const end = t + (envs.length ? maxRelease : 0.03);
    vca.gain.setValueAtTime(1, end - 0.004 > t ? end - 0.004 : t); vca.gain.linearRampToValueAtTime(0, end);
    for (const s of sources) s.stop(end + 0.02);
  };
  if (seconds != null) stop(at + Math.max(0.02, seconds));
  return { stop };
}

