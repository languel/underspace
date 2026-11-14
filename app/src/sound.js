import { voice } from './instruments.js';

// Transport for scores. Sound is scheduled ahead on the audio clock, one
// pass of the frame at a time. Each pass asks for the score afresh, so what
// is drawn or changed while it plays is heard from the next pass on: the
// loop never restarts, and a performance can be layered.

let audio = null, master = null;
function ensureAudio() {
  if (audio) return audio;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  const comp = audio.createDynamicsCompressor();
  master = audio.createGain();
  master.gain.value = 0.8;
  master.connect(comp).connect(audio.destination);
  return audio;
}

const compiled = new Map();
export function compileBrush(source) {
  let f = compiled.get(source);
  if (!f) {
    if (compiled.size > 100) compiled.clear();
    try { f = { run: new Function('voices', 'ctx', `"use strict";\n${source}`) }; } catch (e) { f = { error: e.message }; }
    compiled.set(source, f);
  }
  return f;
}

// A note now, on an instrument (instruments.js). What an event plays.
export function note(midi, velocity = 100, seconds = 0.3, instrument = 'triangle') {
  const ac = ensureAudio();
  if (ac.state === 'suspended') ac.resume();
  voice(ac, master, instrument, midi, velocity, ac.currentTime + 0.005, Math.max(0.05, seconds));
}
// A note held until stop() is called (an event's 'gate': as long as a traveler stays inside).
export function hold(midi, velocity = 100, instrument = 'triangle') {
  const ac = ensureAudio();
  if (ac.state === 'suspended') ac.resume();
  return voice(ac, master, instrument, midi, velocity, ac.currentTime + 0.005, null);
}

const sessions = new Map(); // id -> { bus, timer, passes: [{ t0, duration }], next }

// provide() -> { voices, duration, bpm, source } for the coming pass, or null to stop.
export function start(id, provide, onError) {
  stop(id);
  const ac = ensureAudio();
  if (ac.state === 'suspended') ac.resume();
  const bus = ac.createGain();
  bus.connect(master);
  const s = { bus, timer: 0, passes: [], next: ac.currentTime + 0.08 };
  const pass = () => {
    const score = provide();
    if (!score) return stop(id);
    const duration = Math.max(0.25, score.duration), brush = compileBrush(score.source);
    try {
      if (brush.error) throw new Error(brush.error);
      brush.run(score.voices, { audio: ac, out: bus, t0: s.next, duration, bpm: score.bpm });
      onError?.(null);
    } catch (e) { onError?.(e.message); }
    s.passes.push({ t0: s.next, duration });
    if (s.passes.length > 3) s.passes.shift();
    s.next += duration;
  };
  sessions.set(id, s);
  pass();
  s.timer = setInterval(() => { if (sessions.get(id) === s && s.next - ac.currentTime < 0.2) pass(); }, 40);
}

export function stop(id) {
  const s = sessions.get(id);
  if (!s) return;
  clearInterval(s.timer);
  const t = audio.currentTime;
  s.bus.gain.setValueAtTime(s.bus.gain.value, t);
  s.bus.gain.linearRampToValueAtTime(0, t + 0.04);
  setTimeout(() => s.bus.disconnect(), 120);
  sessions.delete(id);
}
export const stopAll = () => [...sessions.keys()].forEach(stop);
export const isPlaying = (id) => sessions.has(id);
export const playing = () => [...sessions.keys()];

// ---- passes on the transport ---------------------------------------------------
// The transport (main.js) decides when each pass of a score begins; this runs the
// score's brush for one pass, starting at audio time `at`. skip (seconds): a pass
// joined partway, from a seek or a pause, plays only what is still to come.
const buses = new Map();
export const audioNow = () => ensureAudio().currentTime;
export function schedulePass(id, score, at, skip = 0, onError) {
  const ac = ensureAudio();
  if (ac.state === 'suspended') ac.resume();
  let bus = buses.get(id);
  if (!bus) { bus = ac.createGain(); bus.connect(master); buses.set(id, bus); }
  const duration = Math.max(0.25, score.duration), brush = compileBrush(score.source);
  const voices = skip > 0 ? score.voices.map((v) => ({ ...v, events: v.events.filter((e) => e.time >= skip) })).filter((v) => v.events.length) : score.voices;
  try {
    if (brush.error) throw new Error(brush.error);
    brush.run(voices, { audio: ac, out: bus, t0: at, duration, bpm: score.bpm });
    onError?.(null);
  } catch (e) { onError?.(e.message); }
}
// Cut a score short (a pause, a seek, the loop coming round): what it scheduled fades and goes.
export function silence(id) {
  const bus = buses.get(id);
  if (!bus) return;
  buses.delete(id);
  const t = audio.currentTime;
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0, t + 0.04);
  setTimeout(() => bus.disconnect(), 120);
}
// A metronome click at audio time `at`: higher on the first beat of a bar.
export function click(at, accent = false) {
  const ac = ensureAudio(), o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = accent ? 1760 : 1320; o.type = 'square';
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(accent ? 0.12 : 0.07, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, at + 0.05);
  o.connect(g).connect(master); o.start(at); o.stop(at + 0.06);
}
export const silenceAll = () => [...buses.keys()].forEach(silence);

// How far through its frame a score is, 0..1, or -1 when stopped.
export function position(id) {
  const s = sessions.get(id);
  if (!s) return -1;
  const now = audio.currentTime;
  for (let i = s.passes.length - 1; i >= 0; i--) if (s.passes[i].t0 <= now) return Math.min(1, (now - s.passes[i].t0) / s.passes[i].duration);
  return 0;
}

// ---- audio out: a performance rendered offline, as a WAV file ---------------------
// notes: [{ sec, midi, vel, len, instrument }]; passes: [{ at (s), score }] scores' passes.
// Played through the same instruments and brushes into an OfflineAudioContext.
export async function renderAudio(notes, passes, seconds, rate = 44100) {
  const ac = new OfflineAudioContext(2, Math.max(1, Math.ceil((seconds + 1.5) * rate)), rate);
  const comp = ac.createDynamicsCompressor(), out = ac.createGain();
  out.gain.value = 0.8; out.connect(comp).connect(ac.destination);
  for (const n of notes) voice(ac, out, n.instrument, n.midi, n.vel, n.sec + 0.01, Math.max(0.05, n.len));
  for (const { at, score } of passes) {
    const brush = compileBrush(score.source);
    if (brush.error) continue;
    try { brush.run(score.voices, { audio: ac, out, t0: at + 0.01, duration: Math.max(0.25, score.duration), bpm: score.bpm }); } catch { /* a brush that fails is left out */ }
  }
  return wav(await ac.startRendering());
}
// 16-bit PCM WAV of an AudioBuffer.
export function wav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, bytes = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); bytes.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, ch, true);
  bytes.setUint32(24, buf.sampleRate, true); bytes.setUint32(28, buf.sampleRate * ch * 2, true); bytes.setUint16(32, ch * 2, true); bytes.setUint16(34, 16, true); w(36, 'data'); bytes.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); bytes.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([bytes], { type: 'audio/wav' });
}
