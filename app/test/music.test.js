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
