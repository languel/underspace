// Transport and brush runner. Sound is scheduled ahead on the audio clock;
// the picture follows that clock, never the other way round.

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

export function compileBrush(source) {
  return new Function('voices', 'ctx', `"use strict";\n${source}\n//# sourceURL=brush.js`);
}

let current = null; // { bus, t0, duration, loop, timer, schedule }

// play({ voices, duration }, brushFn, { loop, bpm, onError })
export function play(score, brushFn, { loop = true, bpm = 90, onError } = {}) {
  stop();
  const ac = ensureAudio();
  if (ac.state === 'suspended') ac.resume();
  const bus = ac.createGain();
  bus.connect(master);
  const session = { bus, t0: ac.currentTime + 0.08, duration: Math.max(0.25, score.duration), loop, timer: 0, passes: 0 };

  const schedule = (t0) => {
    try {
      brushFn(score.voices, { audio: ac, out: bus, t0, duration: session.duration, bpm });
    } catch (err) {
      onError?.(err);
      stop();
      return false;
    }
    return true;
  };
  if (!schedule(session.t0)) return false;
  session.passes = 1;

  // Look ahead: queue the next pass shortly before the current one ends.
  session.timer = setInterval(() => {
    if (current !== session) return;
    const nextStart = session.t0 + session.passes * session.duration;
    if (!session.loop) {
      if (ac.currentTime > nextStart + 0.3) stop();
      return;
    }
    if (nextStart - ac.currentTime < 0.25) {
      if (schedule(nextStart)) session.passes++;
    }
  }, 50);

  current = session;
  return true;
}

export function stop() {
  if (!current) return;
  const { bus, timer } = current;
  clearInterval(timer);
  const t = audio.currentTime;
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0, t + 0.04);
  setTimeout(() => bus.disconnect(), 120);
  current = null;
}

export const isPlaying = () => !!current;
export const setLoop = (v) => { if (current) current.loop = v; };

// Seconds into the current pass, or -1 when stopped.
export function position() {
  if (!current) return -1;
  const elapsed = audio.currentTime - current.t0;
  if (elapsed < 0) return 0;
  return current.loop ? elapsed % current.duration : Math.min(elapsed, current.duration);
}
export const duration = () => (current ? current.duration : 0);
