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
