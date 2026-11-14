// The transport: one clock for everything that plays (after IanniX's: every
// score object reads its own time from it). Seconds, from 0. Play and pause
// keep the place; seek moves it; a loop range, in beats, sends it back to the
// loop's start when it passes the end. Recording is a flag that whoever plays
// notes reads. View state: not in the take. No DOM.

export function createTransport(now = () => performance.now() / 1000) {
  let playing = false, t0 = 0, at = 0; // while playing, the place is at + (now - t0)
  const listeners = new Set();
  const tell = (why) => { for (const f of listeners) f(why); };
  const tr = {
    loop: { on: false, a: 0, b: 16 }, // in beats
    recording: false,
    spb: 0.5,                         // seconds per beat, kept in step with the music context
    get playing() { return playing; },
    // where it is now, in seconds; a pass beyond the loop's end goes back to its start
    get t() {
      let t = playing ? at + (now() - t0) : at;
      const { on, a, b } = tr.loop, A = a * tr.spb, B = b * tr.spb;
      if (playing && on && B > A && t >= B) { t = A + ((t - A) % (B - A)); at = t; t0 = now(); tr.wrapped = (tr.wrapped ?? 0) + 1; }
      return t;
    },
    get beat() { return tr.t / tr.spb; },
    play() { if (playing) return; t0 = now(); playing = true; tell('play'); },
    pause() { if (!playing) return; at = tr.t; playing = false; tell('pause'); },
    toggle() { if (playing) tr.pause(); else tr.play(); },
    seek(sec) { at = Math.max(0, sec); t0 = now(); tell('seek'); },
    stop() { playing = false; at = tr.loop.on ? tr.loop.a * tr.spb : 0; tr.recording = false; tell('stop'); },
    record(on = !tr.recording) { tr.recording = on; tell('record'); },
    on(f) { listeners.add(f); return () => listeners.delete(f); },
  };
  return tr;
}
