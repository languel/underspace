// The built-in instruments: small Web Audio voices, one per channel, so a
// score sounds with no MIDI device (as AMS's GM output does, without the
// download). Channel 10 is drums, as in General MIDI: the note picks the drum.
//
//   voice(ac, out, name, midi, velocity, at, seconds | null) -> { stop(when) }
//   seconds null: held until stop() (a gate)

export const INSTRUMENTS = ['triangle', 'sine', 'square', 'saw', 'pluck', 'bell', 'pad', 'drums'];
// What each channel plays until the timeline says otherwise.
export const DEFAULT_CHANNELS = { 1: 'triangle', 2: 'pluck', 3: 'bell', 4: 'pad', 10: 'drums' };

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let noiseBuf = null;
function noise(ac) {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 7;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } // the same noise each time
  }
  const n = ac.createBufferSource();
  n.buffer = noiseBuf; n.loop = true;
  return n;
}

// An envelope on a gain: attack, then (with a length) a decay to silence at its end,
// or (held) a sustain until stop().
function envelope(g, at, peak, attack, seconds, sustain = 0.6, release = 0.12) {
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  if (seconds != null) g.gain.exponentialRampToValueAtTime(0.0005, at + Math.max(attack + 0.02, seconds));
  else g.gain.setTargetAtTime(peak * sustain, at + attack, 0.3);
  return (when) => { g.gain.cancelScheduledValues(when); g.gain.setValueAtTime(Math.max(0.0005, g.gain.value), when); g.gain.exponentialRampToValueAtTime(0.0005, when + release); };
}

// Instruments that are not built in (synth.js: drawn on the canvas): custom(name) -> a voice maker or null.
let custom = null;
export const setCustomVoices = (fn) => { custom = fn; };

export function voice(ac, out, name, midi, velocity = 100, at = ac.currentTime + 0.005, seconds = 0.3) {
  const made = custom?.(name);
  if (made) return made(ac, out, midi, velocity, at, seconds);
  const v = Math.max(0, Math.min(127, velocity)) / 127, nodes = [], g = ac.createGain();
  g.connect(out);
  const end = seconds != null ? at + Math.max(0.05, seconds) + 0.2 : null;
  const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; nodes.push(o); return o; };
  let off;
  switch (name === 'drums' ? 'drums' : name) {
    case 'sine': case 'square': case 'triangle': {
      osc(name, hz(midi)).connect(g);
      off = envelope(g, at, (name === 'square' ? 0.12 : 0.28) * v, 0.006, seconds);
      break;
    }
    case 'saw': case 'pad': {
      // two detuned saws through a low-pass; the pad swells in slowly
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = name === 'pad' ? 900 : 2200; f.Q.value = 0.7;
      osc('sawtooth', hz(midi) * 0.997).connect(f); osc('sawtooth', hz(midi) * 1.003).connect(f);
      f.connect(g);
      off = envelope(g, at, 0.12 * v, name === 'pad' ? 0.35 : 0.01, seconds, 0.8, name === 'pad' ? 0.6 : 0.15);
      break;
    }
    case 'pluck': {
      // a bright saw whose filter closes fast: a plucked string
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(Math.min(12000, hz(midi) * 12), at);
      f.frequency.exponentialRampToValueAtTime(Math.max(80, hz(midi) * 1.5), at + 0.35);
      osc('sawtooth', hz(midi)).connect(f); f.connect(g);
      off = envelope(g, at, 0.3 * v, 0.003, seconds == null ? null : Math.max(seconds, 0.6), 0.3);
      break;
    }
    case 'bell': {
      // two-operator FM: the modulator's depth falls, the tone mellows
      const c = osc('sine', hz(midi)), m = osc('sine', hz(midi) * 3.5), depth = ac.createGain();
      depth.gain.setValueAtTime(hz(midi) * 4 * v, at);
      depth.gain.exponentialRampToValueAtTime(Math.max(1, hz(midi) * 0.2), at + 1.2);
      m.connect(depth).connect(c.frequency); c.connect(g);
      off = envelope(g, at, 0.25 * v, 0.004, seconds == null ? null : Math.max(seconds, 1.2), 0.5, 0.4);
      break;
    }
    case 'drums': {
      const kind = midi <= 36 ? 'kick' : midi <= 40 ? 'snare' : [42, 44, 46].includes(midi) ? 'hat' : 'tom';
      if (kind === 'kick' || kind === 'tom') {
        const o = osc('sine', kind === 'kick' ? 150 : hz(midi));
        o.frequency.setValueAtTime(kind === 'kick' ? 150 : hz(midi) * 1.6, at);
        o.frequency.exponentialRampToValueAtTime(kind === 'kick' ? 45 : hz(midi), at + 0.12);
        o.connect(g);
        envelope(g, at, 0.6 * v, 0.002, kind === 'kick' ? 0.35 : 0.25);
      } else {
        const n = noise(ac), f = ac.createBiquadFilter();
        f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
        n.connect(f).connect(g); nodes.push(n);
        envelope(g, at, (kind === 'hat' ? 0.18 : 0.4) * v, 0.001, kind === 'hat' ? (midi === 46 ? 0.3 : 0.06) : 0.18);
        if (kind === 'snare') { const o = osc('triangle', 190); o.connect(g); }
      }
      off = () => {}; // a drum rings out as it does
      const stopAt = at + 0.5;
      for (const n of nodes) { n.start(at); n.stop(stopAt); }
      return { stop() {} };
    }
    default: return voice(ac, out, 'triangle', midi, velocity, at, seconds);
  }
  for (const n of nodes) { n.start(at); if (end) n.stop(end); }
  let done = false;
  return {
    stop(when = ac.currentTime) {
      if (done) return;
      done = true; off(when);
      for (const n of nodes) { try { n.stop(when + 0.7); } catch { /* already stopped */ } }
    },
  };
}
