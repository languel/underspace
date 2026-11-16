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
  env: head('env', ['// out: level', '// param: dur 0.6', '// param: release 0.3', '// param: sync 0', '// a level over time: this curve, left to right, over dur seconds (sync 1: dur and release in beats of the instrument\'s clock); held at its end while the note is; then to nothing over release']),
  shaper: head('shaper', ['// in: audio', '// out: audio', '// param: drive 1', '// a waveshaper: across is what comes in (-1 to 1), up is what goes out']),
  filter: head('filter', ['// in: audio cutoff', '// out: audio', '// param: type 0', '// param: hz 1200', '// param: q 1', '// param: depth 3000', '// type: 0 low pass, 1 high pass, 2 band pass; cutoff moves hz by depth per unit']),
  amp: head('amp', ['// in: audio level', '// out: audio', '// param: gain 1', '// with level wired, its loudness is the level (an envelope); else gain']),
  mix: head('mix', ['// in: a b c', '// out: audio', '// param: gain 0.6']),
  noise: head('noise', ['// out: audio', '// param: level 0.5']),
  out: head('out', ['// in: audio', '// param: channel 0', '// param: gain 0.5', '// param: bpm 0', '// bpm: its own clock for parts that sync (0: the timeline\'s tempo)', '// the instrument: it plays the notes of MIDI channel `channel` (1 to 16; 0: only where music.set channels names it)']),
};
export const LINE_PARTS = ['osc', 'partials', 'env', 'shaper'];

// Readymades: a curve part's shape as a formula. A formula is the body of a plain JavaScript
// function of x (0 to 1, across the curve) that returns its height; Math's functions are given by
// name (sin, cos, tanh, exp, abs, pow, sign, floor, min, max, sqrt, PI) and p is the parameters.
// Written under the header, it replaces the drawing, and the line is redrawn to show it.
export const READYMADES = {
  osc: { sine: 'return sin(2 * PI * x);', saw: 'return 1 - 2 * x;', square: 'return x < 0.5 ? 1 : -1;', triangle: 'return 1 - 4 * abs(x - 0.5);', pulse: 'return x < 0.2 ? 1 : -0.25;', organ: 'return sin(2 * PI * x) + 0.5 * sin(4 * PI * x) + 0.25 * sin(8 * PI * x);' },
  partials: { saw: 'return 1 / (1 + x * 15);', square: 'return floor(x * 15 + 0.5) % 2 ? 0 : 1 / (1 + x * 15);', bright: 'return 1 - 0.5 * x;', bell: 'return exp(-3 * x) * abs(sin(9 * x));' },
  env: { adsr: 'return x < 0.05 ? x / 0.05 : x < 0.3 ? 1 - (x - 0.05) * 1.6 : 0.6;', pluck: 'return exp(-6 * x);', swell: 'return sin(PI * x / 2);', gate: 'return x < 0.02 ? x / 0.02 : 1;', pulse4: 'return x * 4 % 1 < 0.5 ? 1 : 0.2;' },
  shaper: { tanh: 'return tanh(3 * (2 * x - 1));', fold: 'return sin(3 * PI * (2 * x - 1));', clip: 'return max(-0.6, min(0.6, 2 * x - 1));', cubic: 'return pow(2 * x - 1, 3);' },
};
const MATH = ['sin', 'cos', 'tan', 'tanh', 'exp', 'log', 'abs', 'pow', 'sign', 'floor', 'min', 'max', 'sqrt'];
// The body of a part's code under its header (its formula), or ''.
export const formulaOf = (o) => (o?.code ?? '').split('\n').filter((l) => !/^\s*\/\//.test(l) && l.trim()).join('\n');
const formulas = new Map();
// The formula as a function x -> height; throws with the reason when it cannot be one.
export function formula(body, p = {}) {
  let f = formulas.get(body);
  if (!f) { f = new Function('x', 'p', 'PI', ...MATH, `"use strict";\n${body}`); if (formulas.size > 200) formulas.clear(); formulas.set(body, f); } // eslint-disable-line no-new-func
  const args = MATH.map((n) => Math[n]);
  return (x) => { const y = Number(f(x, p, Math.PI, ...args)); return Number.isFinite(y) ? y : 0; };
}
// Points that draw a formula in the box the line has now (y up), 49 across.
export function formulaPoints(o, body) {
  const pts = ptsOf(o), xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), w = Math.max(...xs) - x0 || 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, h = Math.max(...ys) - Math.min(...ys) || 1.2;
  const f = formula(body, {}), v = Array.from({ length: 49 }, (_, i) => f(i / 48)), lo = Math.min(...v), hi = Math.max(...v), d = hi - lo || 1;
  return v.map((y, i) => [Math.round((x0 + (w * i) / 48) * 1e4) / 1e4, Math.round((cy - h / 2 + ((y - lo) / d) * h) * 1e4) / 1e4]);
}
export const SHAPE_PARTS = ['filter', 'amp', 'mix', 'noise', 'out'];
export const kindOf = (o) => (o?.role === 'synth' && o.code ? parseBlanket(o.code).name : null);
export const isOut = (o) => kindOf(o) === 'out';

const shown = (o) => { const p = ptsOf(o); return o.style?.path === 'straight' || p.length < 3 ? p : smooth(p); };
// n samples of the curve as drawn, read across: at n evenly spaced x from its left to its right, the
// height where the curve first passes that x (a curve is a function of time here, as on UPIC's page).
// A curve with no width (drawn straight up) is read along its length instead. -> [[x, y], ...]
function samples(o, n) {
  const body = formulaOf(o);
  if (body) { const f = formula(body, paramsOf(o)); return Array.from({ length: n }, (_, i) => [i / (n - 1), f(i / (n - 1))]); }
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

function paramsOf(o) { const p = {}; if (o?.code) for (const q of parseBlanket(o.code).params) p[q.name] = o.params?.[q.name] ?? q.value; return p; }

// Everything the instrument `outId` is made of, as data: the parts that feed it (following the
// wires back from it) and the wires between them. -> { out, parts: [{ id, kind, p, data? }], wires: [{ from, fromPort, to, toPort }] } | null
// A port of a group stands for a port of something inside it, at any depth: -> { id, port } | null
export function leaf(objects, ref, side) {
  let o = objects.get(ref.id), port = ref.port;
  for (let guard = 0; o?.kind === 'group' && guard < 32; guard++) {
    const q = o.ports?.[side]?.find((x) => x.name === port);
    if (!q) return null;
    port = q.inner.port; o = objects.get(q.inner.id);
  }
  return o ? { id: o.id, port } : null;
}
// bpm: the timeline's tempo, for parts that sync to the clock when the instrument has none of its own.
export function planInstrument(objects, outId, { bpm = 120 } = {}) {
  const out = objects.get(outId);
  if (!isOut(out)) return null;
  const wires = [];
  for (const w of objects.values()) {
    if (!w.bind) continue;
    const a = leaf(objects, w.bind.from, 'outs'), b = leaf(objects, w.bind.to, 'ins');
    if (a && b && kindOf(objects.get(a.id)) && kindOf(objects.get(b.id))) wires.push({ from: a.id, fromPort: a.port, to: b.id, toPort: b.port });
  }
  const need = new Set([outId]), queue = [outId];
  while (queue.length) { const id = queue.shift(); for (const w of wires) if (w.to === id && !need.has(w.from)) { need.add(w.from); queue.push(w.from); } }
  const parts = [...need].map((id) => {
    const o = objects.get(id), kind = kindOf(o), p = paramsOf(o);
    const data = kind === 'osc' ? waveOf(o) : kind === 'partials' ? partialsOf(o, p.count) : kind === 'env' ? envOf(o) : kind === 'shaper' ? shaperOf(o) : undefined;
    return { id, kind, p, ...(data ? { data } : {}) };
  });
  const own = paramsOf(out).bpm;
  return { out: outId, bpm: own > 0 ? own : bpm, parts, wires: wires.filter((w) => need.has(w.from) && need.has(w.to)) };
}

// The instrument a name stands for: an out part by id or by its name. -> id | null
// A group (at any depth) that holds an out part is that instrument: the patch at the top is its face.
export function instrumentId(objects, name) {
  const o = objects.get(name) ?? [...objects.values()].find((x) => x.name === name && (isOut(x) || x.kind === 'group'));
  if (isOut(o)) return o.id;
  if (o?.kind === 'group') return outInside(objects, o.id);
  return null;
}
export function outInside(objects, gid) {
  const queue = [gid];
  while (queue.length) { const s = queue.shift(); for (const x of objects.values()) if (x.space === s) { if (isOut(x)) return x.id; if (x.kind === 'group') queue.push(x.id); } }
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
      const beat = p.sync ? 60 / (plan.bpm || 120) : 1, dur = Math.max(0.01, (p.dur ?? 0.6) * beat), rel = Math.max(0.01, (p.release ?? 0.3) * beat), c = ac.createConstantSource();
      c.offset.value = part.data[0]; c.offset.setValueCurveAtTime(part.data, at, dur);
      sources.push(c); envs.push({ param: c.offset, release: rel, until: at + dur });
      maxRelease = Math.max(maxRelease, rel);
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

