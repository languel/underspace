import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrees, snap, step, pitch, bbt, beatsOf, noteName, noteNumber, DEFAULT_MUSIC } from '../src/music.js';
import { midiFile, readMidiFile } from '../src/midi.js';
import { createTransport } from '../src/transport.js';
import { state, call, undo } from '../src/space.js';

test('scales: degrees, snapping, steps by interval, your own tuning', () => {
  assert.deepEqual(degrees('major'.replace('major', 'Ionian')), [0, 2, 4, 5, 7, 9, 11]);
  assert.equal(snap(61, 'Ionian', 60), 60);            // ties go down
  assert.equal(step(60, 2, 'Ionian', 60), 64);         // a third up, in degrees
  assert.equal(step(64, -1, 'Pentatonic Major', 60), 62);
  assert.equal(snap(63.9, [0, 3.86, 7.02], 60), 63.86); // a just major third
  assert.equal(pitch(0.5, { ...DEFAULT_MUSIC, scale: 'Pentatonic Minor', root: 57 }), 67);
  assert.equal(noteName(61), 'C#4'); assert.equal(noteNumber('A4'), 69);
});

test('time: bars and beats', () => {
  assert.equal(bbt(0), '1.1.1');
  assert.equal(bbt(2.75, { ...DEFAULT_MUSIC, bpm: 120 }), '2.2.3');
  assert.equal(beatsOf('8n'), 0.5); assert.equal(beatsOf('2 bars', { meter: [3, 4] }), 6); assert.equal(beatsOf('1s', { bpm: 120 }), 2);
});

test('a MIDI file holds the notes, on their ticks', () => {
  const bytes = midiFile([{ beat: 0, midi: 60, vel: 100, len: 1 }, { beat: 1, midi: 64, vel: 90, len: 0.5 }], { bpm: 100 });
  const ev = readMidiFile(bytes);
  assert.deepEqual(ev.map((e) => [e.tick, e.bytes[0] & 0xf0, e.bytes[1]]), [[0, 0x90, 60], [480, 0x80, 60], [480, 0x90, 64], [720, 0x80, 64]]);
});

test('the transport: pause keeps the place, the loop comes round', () => {
  let now = 0;
  const tr = createTransport(() => now);
  tr.spb = 0.5; tr.play(); now = 1; assert.equal(tr.beat, 2);
  tr.pause(); now = 5; assert.equal(tr.t, 1);
  tr.loop = { on: true, a: 0, b: 4 }; tr.play(); now = 7; // 1 + 2 = 3 s = 6 beats: past the loop's end at 4
  assert.equal(tr.beat, 2); assert.equal(tr.wrapped, 1);
});

test('music context and clips are commands, and undo', () => {
  call('space.clear');
  call('music.set', { bpm: 96, scale: 'dorian', root: 62, meter: [3, 4] });
  assert.deepEqual([state.music.bpm, state.music.scale, state.music.root, state.music.meter], [96, 'Dorian', 62, [3, 4]]);
  const id = call('clip.add', { at: 4, notes: [{ beat: 0, midi: 62, vel: 100, len: 0.5 }] });
  call('clip.set', { id, at: 8 });
  assert.equal(state.clips.get(id).at, 8);
  undo();
  assert.equal(state.clips.get(id).at, 4);
  call('music.set', { scale: [0, 2.04, 3.86] });
  assert.deepEqual(state.music.scale, [0, 2.04, 3.86]);
});

test('a traveler waits for its beat, and at speed moves a grid cell a beat', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [8, 0]], style: { path: 'straight' } });
  const tr = call('traveler.add', { on: line, loop: 0 });
  call('object.set', { id: tr, name: 'at', value: 2 });
  call('object.set', { id: tr, name: 'speed', value: 1 });
  const play = createPlay(), hooks = { spb: 0.5, grid: 1, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 8, loop: 0, start: 0, at: 0, speed: 0, ...o.params }), note() {} };
  let r;
  for (let t = 0; t <= 0.9; t += 0.05) r = play.step(state.objects, t, true, hooks);
  assert.ok(Math.abs(r.moved.get(tr)[0]) < 1e-9, 'not before beat 2 (1 s)');
  for (let t = 0.95; t <= 3.0001; t += 0.05) r = play.step(state.objects, t, true, hooks);
  assert.ok(Math.abs(r.moved.get(tr)[0] - 4) < 0.15, `4 beats later, 4 cells on: ${r.moved.get(tr)}`);
});

test('a looping traveler does not cross events on its jump back to the start', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[-6, 0], [6, 0]], style: { path: 'straight' } });
  for (const x of [-3, 1]) { const e = call('line.add', { points: [[x, -1], [x, 1]] }); call('object.role', { id: e, role: 'event' }); }
  call('traveler.add', { on: line, dur: 4, loop: 1 });
  const notes = [], play = createPlay(), hooks = { spb: 0.5, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 4, loop: 1, start: 0, at: 0, speed: 0, ...o.params }), note: (m) => notes.push(m) };
  for (let t = 0; t <= 3.9; t += 1 / 60) play.step(state.objects, t, true, hooks); // nearly two laps of 2 s
  assert.equal(notes.length, 4, `two events a lap: ${notes.length}`);
});

test('the take as a history: travel back and forward, an edit continues from there', async () => {
  const { history, travel } = await import('../src/space.js');
  call('space.clear');
  const ids = [];
  for (let i = 0; i < 4; i++) { ids.push(call('line.add', { points: [[i, 0], [i, 1]] })); call('select.set', { ids: [ids[i]] }); }
  const h0 = history();
  const n = h0.steps.length;
  travel(n - 2);
  assert.ok(!state.objects.has(ids[3]) && !state.objects.has(ids[2]) && state.objects.has(ids[1]));
  assert.equal(history().steps.length, n, 'nothing lost: the rest is ahead');
  travel(n - 1);
  assert.ok(state.objects.has(ids[2]) && !state.objects.has(ids[3]));
  travel(n);
  assert.ok(state.objects.has(ids[3]));
  travel(n - 3);
  call('line.add', { points: [[9, 9], [9, 8]] });
  assert.equal(history().steps.length, n - 2, 'a new edit continues from there');
});

test('a gate note sounds while the traveler is inside, and a traveler can go at the drawn pace', async () => {
  const { createPlay, EVENTS } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [10, 0]], style: { path: 'straight' } });
  call('traveler.add', { on: line, dur: 10, loop: 0 });
  const box = call('shape.add', { role: 'event', rect: { cx: 5, cy: 0, w: 2, h: 2 } });
  call('object.code', { id: box, code: EVENTS.gate });
  const held = [], play = createPlay();
  const hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 10, loop: 0, start: 0, at: 0, speed: 0, drawn: 0, ...o.params }), note() {}, hold: (m) => { const h = { m, on: true, stop() { h.on = false; } }; held.push(h); return h; } };
  for (let t = 0; t <= 5; t += 0.1) play.step(state.objects, t, true, hooks);
  assert.equal(held.length, 1); assert.equal(held[0].on, true, 'still inside at x = 5');
  for (let t = 5.1; t <= 7; t += 0.1) play.step(state.objects, t, true, hooks);
  assert.equal(held[0].on, false, 'let go on leaving');

  // drawn: the first half took 0.2 s, the second half 2 s
  call('space.clear');
  const drawnLine = call('line.add', { points: [[0, 0], [5, 0], [10, 0]], pen: [[0, 0.5], [200, 0.5], [2200, 0.5]], style: { path: 'straight' } });
  const tr = call('traveler.add', { on: drawnLine, dur: 100, loop: 0 });
  call('object.set', { id: tr, name: 'drawn', value: 1 });
  const p2 = createPlay();
  let r;
  for (let t = 0; t <= 0.2001; t += 0.01) r = p2.step(state.objects, t, true, hooks);
  assert.ok(Math.abs(r.moved.get(tr)[0] - 5) < 0.4, `fast at first: ${r.moved.get(tr)}`);
  for (let t = 0.21; t <= 1.2001; t += 0.01) r = p2.step(state.objects, t, true, hooks);
  assert.ok(Math.abs(r.moved.get(tr)[0] - 7.5) < 0.4, `then slow: ${r.moved.get(tr)}`);
});

test('a score reads its lines on the timeline\'s scale and root when told to', async () => {
  const { read } = await import('../src/score.js');
  const rect = { cx: 0.5, cy: 0.5, w: 1, h: 1 };
  const lines = [{ id: 'a', points: [[0, 0.52], [0.5, 0.52]] }];
  const s = read(lines, rect, { bpm: 120, beats: 4, low: 60, high: 72, steps: degrees('Pentatonic Major'), root: 62 });
  // 60 + 0.52 * 12 = 66.24, nearest in D pentatonic major (62 64 66 69 71): 66
  assert.deepEqual(s.voices[0].events.map((e) => e.midi), [66, 66]);
  assert.equal(s.duration, 2);
});

test('piano roll: transpose by degrees, quantize, shift; clip.set takes notes', async () => {
  const { transpose, quantize, shift } = await import('../src/roll.js');
  const m = { ...DEFAULT_MUSIC, scale: 'Ionian', root: 60 };
  const notes = [{ beat: 0.13, midi: 60, vel: 100, len: 0.2 }, { beat: 1.01, midi: 64, vel: 90, len: 0.6 }];
  assert.deepEqual(transpose(notes, new Set([1]), 1, m).map((n) => n.midi), [60, 65]); // E up a degree of C major: F
  assert.deepEqual(transpose(notes, null, -1, m, true).map((n) => n.midi), [48, 52]);
  assert.deepEqual(quantize(notes, null).map((n) => [n.beat, n.len]), [[0.25, 0.25], [1, 0.5]]);
  assert.deepEqual(shift(notes, new Set([0]), 0.25, 2).map((n) => [n.beat, n.midi]), [[0.38, 62], [1.01, 64]]);
  call('space.clear');
  const id = call('clip.add', { notes });
  call('clip.set', { id, notes: quantize(notes, null) });
  assert.equal(state.clips.get(id).notes[0].beat, 0.25);
  undo();
  assert.equal(state.clips.get(id).notes[0].beat, 0.13);
});

test('events: crossing direction, exit, lockout, launch; rng repeats from the start', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [10, 0]], style: { path: 'straight' } });
  const other = call('line.add', { points: [[0, 5], [10, 5]], style: { path: 'straight' } });
  call('object.name', { id: other, name: 'upper' });
  call('traveler.add', { on: line, dur: 10, loop: 0 });
  const wall = call('line.add', { points: [[2, -1], [2, 1]] });
  call('object.role', { id: wall, role: 'event' });
  call('object.code', { id: wall, code: '// w\n// param: lockout 0\nmem.seen = (mem.seen ?? []); mem.seen.push([ev.type, ev.dir]); note(60, 100, 0.1, 2); ev.launch("upper");' });
  const box = call('shape.add', { role: 'event', rect: { cx: 5, cy: 0, w: 2, h: 2 } });
  call('object.code', { id: box, code: '// b\n// param: exit 1\nnote(ev.type === "exit" ? 50 : 70, 100, 0.1); note(Math.round(rng() * 1000), 1, 0.1);' });
  const notes = [], ch = [], hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => { const p = { dur: 10, loop: 0, start: 0, at: 0, speed: 0, drawn: 0 }; for (const m of (o.code ?? '').matchAll(/\/\/ param: (\w+) ([\d.]+)/g)) p[m[1]] = +m[2]; return { ...p, ...o.params }; }, note: (m, v, d, c) => { notes.push(m); ch.push(c); } };
  const run = () => { const play = createPlay(); notes.length = 0; let r; for (let t = 0; t <= 8; t += 0.05) r = play.step(state.objects, t, true, hooks); return r; };
  const r = run();
  assert.deepEqual(notes.filter((m) => m === 60 || m === 70 || m === 50), [60, 70, 50], 'cross, enter, exit');
  assert.equal(ch[0], 2, 'on channel 2');
  assert.equal(r.ghosts.length, 1, 'a rider launched on the upper line');
  assert.ok(Math.abs(r.ghosts[0].pos[1] - 5) < 1e-9);
  const randomNote = notes.find((m) => m !== 60 && m !== 70 && m !== 50);
  run();
  assert.equal(notes.find((m) => m !== 60 && m !== 70 && m !== 50), randomNote, 'the same random each time from the start');
});

test('channels pick instruments; recorded notes keep their channel', () => {
  call('space.clear');
  call('music.set', { channels: { 2: 'bell', 3: 'nonsense' } });
  assert.equal(state.music.channels[2], 'bell');
  assert.equal(state.music.channels[3], undefined);
  const id = call('clip.add', { notes: [{ beat: 0, midi: 36, vel: 100, len: 0.25, ch: 10 }] });
  assert.equal(state.clips.get(id).notes[0].ch, 10);
});
