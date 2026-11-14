// Performance and debugging: what each part of a frame costs, the errors that
// happened (kept across a reload, so a crash leaves its trace), whether the
// last session ended without closing, and a report to copy.
//
//   const dbg = createDebug(el, counts)   el: the display; counts() -> { name: number }
//   dbg.time(name, fn)    run fn, adding its time to section `name`
//   dbg.frame()           a frame ended (for the frame rate)
//   dbg.error(e, where)   note an error (also caught from window: error, unhandledrejection)
//   dbg.show(on), dbg.visible, dbg.report() -> a plain object, dbg.crashed (the last session did not close)

const ERRORS = 'underspace-errors', ALIVE = 'underspace-alive';
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private */ } } };

export function createDebug(el, counts = () => ({})) {
  const sections = new Map(); // name -> { ms (smoothed), max (this second), last }
  const errors = store.get(ERRORS) ?? [];
  let frames = 0, fps = 0, lastSecond = performance.now(), frameMs = 0, lastFrame = performance.now(), worst = 0;

  // Did the last session end without closing? A heartbeat is written while the page lives and
  // removed when it closes; one still there on load means the page died (a crash, or killed).
  const beat = store.get(ALIVE);
  const crashed = !!beat && Date.now() - beat.t < 7 * 24 * 3600e3;
  const alive = () => store.set(ALIVE, { t: Date.now(), url: location.href });
  alive();
  setInterval(alive, 2000);
  addEventListener('pagehide', () => { try { localStorage.removeItem(ALIVE); } catch { /* ignore */ } });

  function error(e, where = '') {
    const message = String(e?.message ?? e ?? 'error'), at = String(e?.stack ?? '').split('\n').find((l) => /\.js:\d+/.test(l))?.trim() ?? '';
    const same = errors.find((x) => x.message === message && x.where === where);
    if (same) { same.count++; same.t = Date.now(); } else errors.push({ t: Date.now(), where, message, at, count: 1 });
    while (errors.length > 40) errors.shift();
    store.set(ERRORS, errors);
    if (!el.hidden) draw(true);
  }
  addEventListener('error', (e) => error(e.error ?? e.message, 'window'));
  addEventListener('unhandledrejection', (e) => error(e.reason, 'promise'));

  function time(name, fn) {
    const t0 = performance.now();
    try { return fn(); } finally {
      const ms = performance.now() - t0, s = sections.get(name) ?? { ms, max: 0, last: 0 };
      s.ms = s.ms * 0.9 + ms * 0.1; s.max = Math.max(s.max, ms); s.last = ms;
      sections.set(name, s);
    }
  }
  function frame() {
    const now = performance.now();
    frameMs = frameMs * 0.9 + (now - lastFrame) * 0.1; worst = Math.max(worst, now - lastFrame); lastFrame = now; frames++;
    if (now - lastSecond >= 1000) { fps = (frames * 1000) / (now - lastSecond); frames = 0; lastSecond = now; draw(); worst = 0; for (const s of sections.values()) s.max = 0; }
  }
  function draw(force) {
    if (el.hidden && !force) return;
    const row = (k, v) => `${k.padEnd(9)}${v}`;
    const lines = [row('fps', `${fps.toFixed(0)}  ${frameMs.toFixed(1)} ms  worst ${worst.toFixed(0)}`)];
    for (const [k, s] of sections) lines.push(row(k, `${s.ms.toFixed(2)} ms  max ${s.max.toFixed(1)}`));
    const c = counts();
    lines.push(Object.entries(c).map(([k, v]) => `${k} ${v}`).join('  '));
    if (crashed) lines.push('⚠ the last session ended without closing');
    if (errors.length) lines.push(`errors ${errors.reduce((a, x) => a + x.count, 0)}: ${errors[errors.length - 1].message.slice(0, 60)}`);
    el.textContent = lines.join('\n');
  }
  function report() {
    return {
      when: new Date().toISOString(), agent: navigator.userAgent, crashedBefore: crashed,
      fps: +fps.toFixed(1), frameMs: +frameMs.toFixed(2),
      sections: Object.fromEntries([...sections].map(([k, s]) => [k, { ms: +s.ms.toFixed(3), last: +s.last.toFixed(3) }])),
      counts: counts(), errors, memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined,
    };
  }
  return {
    time, frame, error, report, crashed,
    get visible() { return !el.hidden; },
    show(on = el.hidden) { el.hidden = !on; draw(true); },
    clearErrors() { errors.length = 0; store.set(ERRORS, errors); draw(true); },
  };
}
