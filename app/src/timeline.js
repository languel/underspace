// The timeline: the transport and what plays on it, as a strip along the
// bottom (after IanniX's transport and Underscores's timeline). A ruler in
// bars and beats with the playhead and the loop; a lane for each traveler
// (when it sets off, how long its line takes), each score (its passes) and
// each recorded clip (its notes, high up for high notes). The musical context
// (tempo, meter, scale, root, range) is edited at its head.
//
// The first lane is the making: every step of the take (what one undo takes
// away), by when it was made, long pauses shortened, fitted to the lane. Its
// own time, not the music's (HANDOFF: time in the work and time of its making
// stay apart). Drag along it to go back and forward through the history: the
// drawing is shown as it was; an edit there continues from there, as undo
// does. Click its name to replay the making.
//
// Ruler: click or drag to move the playhead; Shift-drag marks the loop.
// Clips: drag to move (by sixteenths; Shift: free), right-click for more.
// Wheel: scroll; ⌘ wheel or pinch: zoom.

import { h } from './controls.js';
import { icon } from './icons.js';
import { bbt, scaleNames, noteName } from './music.js';

const GUTTER = 92, RULER = 20, LANE = 18;

// host: { transport, state, call, history() -> { done, steps: [{ t, name, by }] }, travel(k), replay(), replaying, lanes() -> [{ id, kind, name, at, len, repeat, notes? }], actions: { play, stop, record, loop }, menu(items, x, y) }
export function createTimeline(el, host) {
  const head = h('div', 'tl-head'), canvas = h('canvas', 'tl-lanes'), ctx = canvas.getContext('2d');
  el.append(head, canvas);
  let ppb = 24, scroll = 0, drag = null, lastSig = '';

  const button = (name, title, run) => { const b = h('button'); b.title = title; b.setAttribute('aria-label', title); b.innerHTML = icon(name); b.onclick = run; return b; };
  const rewind = button('rewind', 'Back to the start (⌥,)', host.actions.stop), play = button('play', 'Play or pause (Space)', host.actions.play);
  const rec = button('record', 'Record what plays (⌥R)', host.actions.record), loop = button('loop', 'Loop (⌥L); Shift-drag the ruler to mark it', host.actions.loop);
  const pos = h('span', 'tl-pos'), num = (title, w, get, set, step = 1) => {
    const i = h('input'); i.type = 'number'; i.step = step; i.title = title; i.setAttribute('aria-label', title); i.style.width = w;
    i.onchange = () => { const v = Number(i.value); if (Number.isFinite(v)) set(v); };
    i.sync = () => { if (document.activeElement !== i) i.value = get(); };
    return i;
  };
  const m = () => host.state.music;
  const bpm = num('Tempo (beats a minute)', '46px', () => m().bpm, (v) => host.call('music.set', { bpm: v }));
  const meter = h('input'); meter.title = 'Meter'; meter.setAttribute('aria-label', 'Meter'); meter.style.width = '34px';
  meter.onchange = () => { const x = meter.value.match(/(\d+)\s*\/\s*(\d+)/); if (x) host.call('music.set', { meter: [+x[1], +x[2]] }); };
  meter.sync = () => { if (document.activeElement !== meter) meter.value = m().meter.join('/'); };
  const scale = h('select'); scale.title = 'Scale'; scale.setAttribute('aria-label', 'Scale');
  for (const n of scaleNames()) scale.append(new Option(n, n));
  scale.append(new Option('your own…', '*'));
  scale.onchange = () => {
    if (scale.value !== '*') return host.call('music.set', { scale: scale.value });
    const steps = prompt('Steps in semitones from the root (fractions allowed)', '0 2 4 7 9');
    const list = steps?.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (list?.length) host.call('music.set', { scale: list }); else scale.sync();
  };
  scale.sync = () => { if (document.activeElement === scale) return; const s = m().scale; if (Array.isArray(s)) { scale.options[scale.options.length - 1].text = s.join(' '); scale.value = '*'; } else scale.value = s; };
  const root = h('select'); root.title = 'Root'; root.setAttribute('aria-label', 'Root');
  for (let n = 48; n < 72; n++) root.append(new Option(noteName(n), n));
  root.onchange = () => host.call('music.set', { root: +root.value });
  root.sync = () => { if (document.activeElement !== root) root.value = String(Math.round(m().root)); };
  const low = num('Lowest note (MIDI)', '38px', () => m().low, (v) => host.call('music.set', { low: v })), high = num('Highest note (MIDI)', '38px', () => m().high, (v) => host.call('music.set', { high: v }));
  const range = h('span', 'tl-range'); range.append(low, h('span', '', '–'), high);
  head.append(rewind, play, rec, loop, pos, bpm, meter, scale, root, range);
  const fields = [bpm, meter, scale, root, low, high];

  // Where each step of the making sits across the lane: its time, pauses over 1.5 s shortened.
  function making(w) {
    const h = host.history(), xs = [];
    let c = 0;
    h.steps.forEach((st, i) => { if (i) c += Math.max(0.05, Math.min(1.5, st.t - h.steps[i - 1].t)); xs.push(c); });
    const span = Math.max(c, 1e-6), x0 = GUTTER + 6, x1 = w - 8;
    return { ...h, xs: xs.map((v) => (h.steps.length > 1 ? x0 + (v / span) * (x1 - x0) : x0)) };
  }
  const STEP_COLOR = (name, c) => (/^(line\.|shape\.|object\.paste|object\.copy)/.test(name) ? c.ink : /^joint|^line\.keep/.test(name) ? c.hot : /^(music|clip)/.test(name) ? c.accent : c.muted);
  // the step under x: how many steps would be done if the pointer were let go there
  const doneAt = (mk, x) => { let k = 0, d = Math.abs(x - GUTTER); mk.xs.forEach((sx, i) => { const e = Math.abs(x - sx); if (e < d) { d = e; k = i + 1; } }); return k; }; // the nearest step

  const beatAt = (x) => (x - GUTTER) / ppb + scroll;
  const xOf = (beat) => GUTTER + (beat - scroll) * ppb;
  const colors = () => { const cs = getComputedStyle(el); const v = (n, f) => cs.getPropertyValue(n).trim() || f; return { ink: v('--ink', '#ddd'), muted: v('--muted', '#888'), line: v('--line', '#333'), accent: v('--accent', '#e80'), hot: v('--hot', '#5cb'), field: v('--field', '#222') }; };

  function draw() {
    const tr = host.transport, lanes = host.lanes(), w = el.clientWidth, hgt = Math.max(RULER + LANE * 2, RULER + LANE * (lanes.length + 1) + 6), dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); canvas.style.height = hgt + 'px'; }
    const c = colors(), per = m().meter[0], beat = tr.beat;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
    // loop band
    if (tr.loop.b > tr.loop.a) { ctx.fillStyle = c.accent; ctx.globalAlpha = tr.loop.on ? 0.22 : 0.08; ctx.fillRect(xOf(tr.loop.a), 0, (tr.loop.b - tr.loop.a) * ppb, RULER - 4); ctx.globalAlpha = 1; }
    // bars and beats
    const first = Math.floor(scroll), last = Math.ceil(beatAt(w));
    for (let b = first; b <= last; b++) {
      const x = xOf(b), bar = b % per === 0;
      if (x < GUTTER) continue;
      ctx.strokeStyle = c.line; ctx.globalAlpha = bar ? 0.9 : 0.4;
      ctx.beginPath(); ctx.moveTo(x + 0.5, bar ? 2 : RULER - 8); ctx.lineTo(x + 0.5, hgt); ctx.stroke(); ctx.globalAlpha = 1;
      if (bar && ppb * per > 26) { ctx.fillStyle = c.muted; ctx.fillText(String(b / per + 1), x + 3, 8); }
    }
    // the making: one tick a step
    {
      const mk = making(w), y = RULER;
      ctx.fillStyle = c.field; ctx.fillRect(GUTTER, y + 1, w - GUTTER, LANE - 2);
      ctx.fillStyle = host.replaying ? c.accent : c.muted; ctx.fillText((host.replaying ? '■ ' : '▷ ') + 'making', 6, y + LANE / 2);
      mk.steps.forEach((st, i) => { ctx.globalAlpha = i < mk.done ? 0.9 : 0.25; ctx.fillStyle = STEP_COLOR(st.name, c); ctx.fillRect(Math.round(mk.xs[i]), y + 4, 1.5, LANE - 8); });
      ctx.globalAlpha = 1;
      if (mk.done > 0) { const x = mk.xs[mk.done - 1] + 0.75; ctx.fillStyle = c.accent; ctx.beginPath(); ctx.moveTo(x - 4, y + 1); ctx.lineTo(x + 4, y + 1); ctx.lineTo(x, y + 6); ctx.fill(); ctx.fillRect(x - 0.5, y + 1, 1.5, LANE - 2); }
    }
    // lanes
    lanes.forEach((l, i) => {
      const y = RULER + (i + 1) * LANE;
      ctx.fillStyle = c.muted; ctx.fillText(l.name.slice(0, 13), 6, y + LANE / 2);
      ctx.save(); ctx.beginPath(); ctx.rect(GUTTER, y, w - GUTTER, LANE); ctx.clip();
      const tint = l.kind === 'clip' ? c.accent : l.kind === 'score' ? c.ink : c.hot;
      const reps = l.repeat ? Math.min(400, Math.ceil((last - l.at) / Math.max(0.25, l.len))) : 1;
      for (let k = 0; k < Math.max(1, reps); k++) {
        const a = l.at + k * l.len, x = xOf(a), wd = l.len * ppb;
        if (x > w || x + wd < GUTTER) continue;
        ctx.globalAlpha = l.muted ? 0.15 : k ? 0.25 : 0.45; ctx.fillStyle = tint; ctx.fillRect(x, y + 3, Math.max(2, wd - 1), LANE - 6); ctx.globalAlpha = 1;
        if (l.notes && k === 0) {
          ctx.fillStyle = c.ink;
          const lo = Math.min(...l.notes.map((n) => n.midi)), hi = Math.max(...l.notes.map((n) => n.midi)), span = Math.max(1, hi - lo);
          for (const n of l.notes) ctx.fillRect(xOf(l.at + n.beat), y + LANE - 4 - ((n.midi - lo) / span) * (LANE - 8), Math.max(1.5, n.len * ppb), 1.5);
        }
      }
      if (host.selected === l.id) { ctx.strokeStyle = c.accent; ctx.strokeRect(xOf(l.at) + 0.5, y + 2.5, l.len * ppb, LANE - 5); }
      ctx.restore();
    });
    // the playhead
    const px = xOf(beat);
    if (px >= GUTTER) { ctx.strokeStyle = tr.recording ? '#e33' : c.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, hgt); ctx.stroke(); ctx.lineWidth = 1; }
  }

  function update() {
    if (el.hidden) return;
    document.body.style.setProperty('--tl-h', el.offsetHeight + 'px');
    const tr = host.transport;
    pos.textContent = bbt(tr.t, m());
    play.innerHTML = icon(tr.playing ? 'pause' : 'play');
    rec.classList.toggle('on', tr.recording); loop.classList.toggle('on', tr.loop.on);
    for (const f of fields) f.sync();
    // follow the playhead while playing
    if (tr.playing && !drag) { const b = tr.beat, vis = (el.clientWidth - GUTTER) / ppb; if (b > scroll + vis * 0.9 || b < scroll) scroll = Math.max(0, b - vis * 0.1); }
    const sig = `${tr.t.toFixed(3)}|${scroll}|${ppb}|${host.state.version}|${host.history().done}|${host.replaying}|${tr.loop.on}${tr.loop.a}${tr.loop.b}|${tr.recording}|${host.selected}|${el.clientWidth}`;
    if (sig !== lastSig) { lastSig = sig; draw(); }
  }

  const laneAt = (y) => Math.floor((y - RULER) / LANE) - 1; // -1: the making
  const sixteenth = (b, e) => (e.shiftKey ? b : Math.round(b * 4) / 4);
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, b = Math.max(0, beatAt(x)), tr = host.transport;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a scripted pointer has nothing to capture */ }
    if (e.button === 2) return;
    if (y < RULER || x < GUTTER) {
      if (e.shiftKey) { drag = { kind: 'loop', a: Math.round(b) }; tr.loop = { on: true, a: Math.round(b), b: Math.round(b) + 1 }; }
      else { drag = { kind: 'seek' }; host.seek(b * tr.spb); }
      return;
    }
    if (laneAt(y) === -1) {
      if (x < GUTTER) { host.replay(); return; }
      drag = { kind: 'making' }; host.travel(doneAt(making(el.clientWidth), x)); return;
    }
    const lane = host.lanes()[laneAt(y)];
    host.selected = lane?.id ?? null;
    if (lane?.kind === 'clip') drag = { kind: 'clip', id: lane.id, from: b, at: lane.at, to: lane.at };
    else { drag = { kind: 'seek' }; host.seek(b * tr.spb); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, b = Math.max(0, beatAt(x)), tr = host.transport;
    if (!drag) {
      // name the step under the pointer
      let tip = '';
      if (laneAt(e.clientY - r.top) === -1) { const mk = making(el.clientWidth), k = doneAt(mk, x); tip = x < GUTTER ? 'Replay the making' : k ? `${k}. ${mk.steps[k - 1].name}${mk.steps[k - 1].by !== 'human' ? ' · ' + mk.steps[k - 1].by : ''}` : 'the start'; }
      if (canvas.title !== tip) canvas.title = tip;
      return;
    }
    if (drag.kind === 'making') host.travel(doneAt(making(el.clientWidth), x));
    else if (drag.kind === 'seek') host.seek(b * tr.spb);
    else if (drag.kind === 'loop') { const a = Math.min(drag.a, Math.round(b)), z = Math.max(drag.a + 1, Math.round(b)); tr.loop = { on: true, a: Math.min(a, drag.a), b: Math.max(z, a + 1) }; }
    else if (drag.kind === 'clip') { drag.to = Math.max(0, sixteenth(drag.at + b - drag.from, e)); host.preview(drag.id, drag.to); }
    lastSig = '';
  });
  const up = () => {
    if (drag?.kind === 'clip') { host.preview(null); if (drag.to !== drag.at) host.call('clip.set', { id: drag.id, at: drag.to }); }
    drag = null; lastSig = '';
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), lane = host.lanes()[laneAt(e.clientY - r.top)];
    if (lane?.kind === 'clip') { host.selected = lane.id; host.clipMenu(lane.id, e.clientX, e.clientY); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey) { const at = beatAt(x); ppb = Math.max(2, Math.min(240, ppb * Math.exp(-e.deltaY * 0.01))); scroll = Math.max(0, at - (x - GUTTER) / ppb); }
    else scroll = Math.max(0, scroll + (e.deltaX || e.deltaY) / ppb);
    lastSig = '';
  }, { passive: false });

  return { update, get visible() { return !el.hidden; }, show(on = el.hidden) { el.hidden = !on; document.body.classList.toggle('with-timeline', on); lastSig = ''; } };
}
