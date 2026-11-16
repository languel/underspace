import test from 'node:test';
import assert from 'node:assert/strict';
import { read, snapToScale, midiToHz, extent } from '../src/reading.js';

const line = (id, pts) => ({ id, points: pts.map(([x, y, z = 0, t = 0, p = 0.5]) => [x, y, z, t, p]) });

test('x maps to time across the selection, y to pitch range', () => {
  const marks = [line('a', [[0, 0], [4, 2]]), line('b', [[2, 1], [4, 0]])];
  const { voices, duration } = read(marks, { beats: 8, low: 48, high: 72 }, { bpm: 120 });
  assert.equal(duration, 4);
  assert.deepEqual(voices[0].events.map((e) => e.time), [0, 4]);
  assert.deepEqual(voices[0].events.map((e) => e.midi), [48, 72]);
  assert.equal(voices[1].events[0].time, 2);
  assert.equal(voices[1].events[0].midi, 60);
});

test('marks are not changed by reading', () => {
  const marks = [line('a', [[0.13, 0.4], [3.9, 1.7]])];
  const before = JSON.stringify(marks);
  read(marks, { quant: 'all', grid: 1, scale: 'major' }, { bpm: 90 });
  assert.equal(JSON.stringify(marks), before);
});

test('snap starts shifts a whole mark onto the grid and keeps its shape', () => {
  const marks = [line('frame', [[0, 0], [16, 1]]), line('a', [[1.3, 0], [3.3, 1]])];
  const r = read(marks, { beats: 16, quant: 'starts', grid: 1 }, { bpm: 60 });
  const e = r.voices[1].events;
  assert.equal(e[0].time, 1);
  assert.ok(Math.abs((e[1].time - e[0].time) - 2) < 1e-9);
});

test('snap every point lands all events on the grid', () => {
  const marks = [line('frame', [[0, 0], [16, 1]]), line('a', [[1.3, 0], [2.6, 0.5], [3.4, 1]])];
  const r = read(marks, { beats: 16, quant: 'all', grid: 0.5 }, { bpm: 60 });
  for (const e of r.voices[1].events) assert.ok(Math.abs(e.time * 2 - Math.round(e.time * 2)) < 1e-9);
});

test('scale snapping, including a non-12-tone scale', () => {
  assert.equal(snapToScale(61, 'major', 0), 60);
  assert.equal(snapToScale(63.4, 'major', 0), 64);
  assert.equal(snapToScale(59.6, 'major', 0), 60); // wraps up to the next octave's root
  assert.equal(snapToScale(61, 'major', 2), 61);   // D major contains C sharp
  assert.equal(snapToScale(60.3, 'quarter tone', 0), 60.5);
  assert.equal(snapToScale(60.3, 'continuous', 0), 60.3);
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
});

test('a path drawn right to left is read forwards in time', () => {
  const r = read([line('a', [[4, 1], [0, 0]])], { beats: 4 }, { bpm: 60 });
  const times = r.voices[0].events.map((e) => e.time);
  assert.deepEqual(times, [0, 4]);
});

test('other channels can be read as time or pitch', () => {
  const marks = [{ id: 'a', points: [[0, 0, 0, 10, 0.2], [1, 0, 3, 12, 0.9]] }];
  assert.deepEqual(extent(marks, 't'), [10, 12]);
  const r = read(marks, { time: 't', pitch: 'z', beats: 2, low: 60, high: 72 }, { bpm: 60 });
  assert.deepEqual(r.voices[0].events.map((e) => [e.time, e.midi]), [[0, 60], [2, 72]]);
});

test('a single point and a flat line still produce sound events', () => {
  const r = read([line('dot', [[1, 1]])], {}, { bpm: 90 });
  assert.equal(r.voices[0].events.length, 1);
  assert.ok(Number.isFinite(r.voices[0].events[0].hz));
});
