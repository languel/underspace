import { state, call, onChange, take, replay, cancelReplay, loadTake, listCommands, defineCommand, now } from './space.js';
import { read, SCALES, NOTE_NAMES } from './reading.js';
import { PRESETS } from './brushes.js';
import * as audio from './audio.js';
import { createViews } from './views.js';

const $ = (id) => document.getElementById(id);
const paneCanvas = $('paneCanvas'), paneScene = $('paneScene');

// ---- controls ----------------------------------------------------------------
for (const name of Object.keys(SCALES)) $('rScale').add(new Option(name, name));
NOTE_NAMES.forEach((n, i) => $('rRoot').add(new Option(n, i)));
for (const name of [...Object.keys(PRESETS), 'custom']) $('preset').add(new Option(name, name));

const readingFields = { rTime: 'time', rPitch: 'pitch', rBeats: 'beats', rLow: 'low', rHigh: 'high', rQuant: 'quant', rGrid: 'grid', rScale: 'scale', rRoot: 'root' };
const numeric = new Set(['beats', 'low', 'high', 'grid', 'root']);
for (const [id, key] of Object.entries(readingFields)) {
  $(id).addEventListener('change', (e) => {
    const v = numeric.has(key) ? Number(e.target.value) : e.target.value;
    if (numeric.has(key) && !Number.isFinite(v)) return;
    call('reading.set', { [key]: v });
  });
}
function showReading() { for (const [id, key] of Object.entries(readingFields)) $(id).value = state.reading[key]; }
function showBrush() {
  if ($('code').value !== state.brush.source) $('code').value = state.brush.source;
  $('preset').value = state.brush.preset in PRESETS ? state.brush.preset : 'custom';
}

let tool = 'draw';
function setTool(next) {
  tool = next;
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === tool);
  paneCanvas.style.cursor = paneScene.style.cursor = tool === 'draw' ? 'crosshair' : 'default';
}
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));

// ---- transport ---------------------------------------------------------------
let score = null;       // the last reading that was sent to the brush
let brushFn = null;
const status = (text, err = false) => { $('brushStatus').textContent = text; $('brushStatus').classList.toggle('err', err); };

function readingMarks() {
  const ids = state.selection.size ? [...state.selection] : [...state.marks.keys()];
  return ids.map((id) => state.marks.get(id)).filter(Boolean);
}
function compile() {
  try { brushFn = audio.compileBrush(state.brush.source); return true; }
  catch (err) { status(`brush: ${err.message}`, true); return false; }
}
function startPlay() {
  const marks = readingMarks();
  if (!marks.length) { status('Nothing to play yet: draw a line first.'); return; }
  if (!compile()) return;
  score = read(marks, state.reading, { bpm: state.bpm });
  const ok = audio.play(score, brushFn, { loop: $('loop').checked, bpm: state.bpm, onError: (err) => status(`brush: ${err.message}`, true) });
  if (ok) status(`${score.voices.length} voice${score.voices.length === 1 ? '' : 's'} · ${score.duration.toFixed(1)} s`);
  showTransport();
}
function stopPlay() { audio.stop(); showTransport(); }
function showTransport() {
  const on = audio.isPlaying();
  $('play').textContent = on ? '■ stop' : '▶ play';
  $('play').classList.toggle('on', on);
}
defineCommand('transport.play', 'Play the selection (or everything) through the reading and the brush.', startPlay);
defineCommand('transport.stop', 'Stop playback.', stopPlay);

// While playing, any change is heard straight away.
let restartTimer = 0;
function liveUpdate() {
  if (!audio.isPlaying()) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { if (audio.isPlaying()) startPlay(); }, 120);
}

$('play').addEventListener('click', () => call(audio.isPlaying() ? 'transport.stop' : 'transport.play'));
$('loop').addEventListener('change', (e) => audio.setLoop(e.target.checked));
$('bpm').addEventListener('change', (e) => { const v = Number(e.target.value); if (v >= 20 && v <= 300) call('context.set', { bpm: v }); });

// ---- brush editor ------------------------------------------------------------
let codeTimer = 0;
$('code').addEventListener('input', () => {
  clearTimeout(codeTimer);
  codeTimer = setTimeout(() => {
    const source = $('code').value;
    try { audio.compileBrush(source); } catch (err) { status(`brush: ${err.message}`, true); return; }
    status('');
    call('brush.set', { source, preset: 'custom' });
  }, 450);
});
$('code').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const el = e.target, s = el.selectionStart;
  el.setRangeText('  ', s, el.selectionEnd, 'end');
  el.dispatchEvent(new Event('input'));
});
$('preset').addEventListener('change', (e) => {
  const name = e.target.value;
  if (PRESETS[name]) call('brush.set', { source: PRESETS[name], preset: name });
});

// ---- views -------------------------------------------------------------------
const views = await createViews({ canvas: $('gl'), paneCanvas, paneScene, onFrame });
$('hint').textContent += ` Wheel pans the canvas, pinch zooms; in the scene, right-drag or Alt-drag orbits. (${views.backend})`;

function applyPlane() { views.setPlane($('plane').value, Number($('depth').value) || 0); }
$('plane').addEventListener('change', applyPlane);
$('depth').addEventListener('change', applyPlane);
$('proj').addEventListener('change', (e) => { views.setProjection(e.target.value); views.setFrame(readingMarks()); });

function onFrame() {
  const pos = audio.position();
  if (pos < 0 || !score) {
    if (onFrame.wasPlaying) { views?.setPlayhead(null); for (const v of score?.voices ?? []) views.setHot(v.id, 0); showTransport(); }
    onFrame.wasPlaying = false;
    return;
  }
  onFrame.wasPlaying = true;
  const frac = pos / (audio.duration() || 1);
  const [a, b] = score.timeExtent;
  views.setPlayhead({ channel: state.reading.time, value: a + frac * (b - a) });
  for (const v of score.voices) {
    const e = v.events;
    views.setHot(v.id, e.length && pos >= e[0].time && pos <= e[e.length - 1].time + 0.15 ? 1 : 0);
  }
}

// ---- drawing and selecting ---------------------------------------------------
let stroke = null, drag = null;
const round = (v) => Math.round(v * 1e4) / 1e4;

function pointerDown(view, e) {
  if (e.button !== 0 || e.altKey) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  if (tool === 'draw') {
    if (view === 'scene' && views.projection !== 'space') { status('Switch "scene shows" to space to draw in the scene view.'); return; }
    stroke = { view, plane: $('plane').value, points: [], last: null };
    addPoint(e);
  } else {
    drag = { view, x: e.clientX, y: e.clientY, moved: false, add: e.shiftKey };
  }
}
function addPoint(e) {
  if (stroke.last && Math.hypot(e.clientX - stroke.last[0], e.clientY - stroke.last[1]) < 2) return;
  const w = views.toWorld(stroke.view, e.clientX, e.clientY);
  if (!w) return;
  stroke.last = [e.clientX, e.clientY];
  stroke.points.push([round(w[0]), round(w[1]), round(w[2]), +now().toFixed(3), round(e.pressure > 0 ? e.pressure : 0.5)]);
  views.setPreview(stroke.points, stroke.plane);
}
function pointerMove(e) {
  if (stroke) { for (const c of e.getCoalescedEvents?.() ?? [e]) addPoint(c); return; }
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
  if (drag.moved) {
    const s = $('stage').getBoundingClientRect(), m = $('marquee');
    m.hidden = false;
    m.style.left = Math.min(drag.x, e.clientX) - s.left + 'px'; m.style.top = Math.min(drag.y, e.clientY) - s.top + 'px';
    m.style.width = Math.abs(e.clientX - drag.x) + 'px'; m.style.height = Math.abs(e.clientY - drag.y) + 'px';
  }
}
function pointerUp(e) {
  if (stroke) {
    const s = stroke; stroke = null;
    views.setPreview(null);
    if (s.points.length) call('mark.add', { plane: s.plane, points: s.points });
    return;
  }
  if (!drag) return;
  const d = drag; drag = null; $('marquee').hidden = true;
  let ids = d.moved ? views.pickRect(d.view, d.x, d.y, e.clientX, e.clientY) : [views.pick(d.view, e.clientX, e.clientY)].filter(Boolean);
  if (d.add) { const set = new Set(state.selection); for (const id of ids) set.has(id) && !d.moved ? set.delete(id) : set.add(id); ids = [...set]; }
  call('select.set', { ids });
}
for (const [view, el] of [['canvas', paneCanvas], ['scene', paneScene]]) {
  el.addEventListener('pointerdown', (e) => pointerDown(view, e));
  el.addEventListener('pointermove', pointerMove);
  el.addEventListener('pointerup', pointerUp);
  el.addEventListener('pointercancel', () => { stroke = null; drag = null; views.setPreview(null); $('marquee').hidden = true; });
}

// ---- take --------------------------------------------------------------------
function describe(clip) {
  const a = clip.args;
  if (clip.name === 'mark.add') return `${a.points.length} pt${a.points.length === 1 ? '' : 's'} on ${a.plane}`;
  if (clip.name === 'select.set' || clip.name === 'mark.remove') return `${a.ids.length} mark${a.ids.length === 1 ? '' : 's'}`;
  if (clip.name === 'brush.set') return a.preset ?? 'custom';
  return Object.entries(a).map(([k, v]) => `${k} ${v}`).join(', ');
}
function showTake() {
  const clips = take.clips, list = $('takeList');
  $('takeInfo').textContent = clips.length ? `${clips.length} step${clips.length === 1 ? '' : 's'} · ${clips.at(-1).t.toFixed(0)} s` : 'records everything you do';
  list.replaceChildren(...clips.slice(-40).map((c) => {
    const li = document.createElement('li'), b = document.createElement('b');
    b.textContent = c.name;
    li.append(b, ` ${describe(c)} · ${c.by}`);
    return li;
  }));
  list.start = Math.max(1, clips.length - 39);
  list.scrollTop = list.scrollHeight;
}

let replaying = false;
async function runReplay() {
  if (replaying) { cancelReplay(); replaying = false; $('replay').textContent = 'replay take'; return; }
  if (!take.clips.length) return;
  replaying = true; $('replay').textContent = 'stop replay';
  await replay(take, { speed: 1.5, hooks: { reveal: views.reveal, stop: stopPlay } });
  replaying = false; $('replay').textContent = 'replay take';
}
$('replay').addEventListener('click', runReplay);
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(take)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'underspace-take.json' });
  a.click(); URL.revokeObjectURL(a.href);
});
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try { loadTake(JSON.parse(await file.text())); runReplay(); }
  catch (err) { status(`load: ${err.message}`, true); }
});
$('clear').addEventListener('click', () => { if (state.marks.size) call('space.clear'); });

// ---- state -> screen ---------------------------------------------------------
function showInfo() {
  const n = readingMarks().length, all = state.marks.size;
  const secs = state.reading.beats * 60 / state.bpm;
  $('readingInfo').textContent = all ? `${state.selection.size ? `${n} selected` : `all ${n}`} · ${secs.toFixed(1)} s` : '';
  $('hint').hidden = all > 0;
}
onChange((what) => {
  if (what === 'marks') { views.sync(state.marks); views.setSelection(state.selection); views.setFrame(readingMarks()); showInfo(); liveUpdate(); }
  if (what === 'selection') { views.setSelection(state.selection); views.setFrame(readingMarks()); showInfo(); liveUpdate(); }
  if (what === 'reading') { showReading(); showInfo(); liveUpdate(); }
  if (what === 'brush') { showBrush(); status(''); liveUpdate(); }
  if (what === 'context') { $('bpm').value = state.bpm; showInfo(); liveUpdate(); }
  if (what === 'take') showTake();
});

// ---- keys --------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('textarea, input, select')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'd' && !mod) setTool('draw');
  else if (e.key === 'v' && !mod) setTool('select');
  else if (e.key === ' ') { e.preventDefault(); call(audio.isPlaying() ? 'transport.stop' : 'transport.play'); }
  else if ((e.key === 'Backspace' || e.key === 'Delete') && state.selection.size) call('mark.remove', { ids: [...state.selection] });
  else if (e.key === 'a' && mod) { e.preventDefault(); call('select.set', { ids: [...state.marks.keys()] }); }
  else if (e.key === 'Escape') call('select.set', { ids: [] });
});

showReading(); showBrush(); showTake(); showInfo(); setTool('draw');

// The same door for people, scripts and agents:
//   underspace.commands()                       what can be done
//   underspace.call('mark.add', {...}, 'agent') do it (and it is recorded)
window.underspace = { call, commands: listCommands, state, take, read, views };
