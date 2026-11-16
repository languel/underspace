import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, call, undo } from '../src/space.js';
import '../src/quantize.js';
import { ptsOf } from '../src/object.js';

test('quantize: points to the grid, a whole object by its start', () => {
  call('space.clear');
  const l = call('line.add', { points: [[0.1, 0.2], [1.4, 0.9], [2.6, 2.2]] });
  const r = call('quantize', { ids: [l] });
  assert.equal(r.moved, 1);
  assert.deepEqual(state.objects.get(l).points, [[0, 0], [1, 1], [3, 2]]);
  const m = call('line.add', { points: [[0.3, 0.4], [1.3, 0.4]] });
  call('quantize', { ids: [m], what: 'object' });
  assert.deepEqual(ptsOf(state.objects.get(m)).map((p) => p.map((v) => Math.round(v * 1e4) / 1e4)), [[0, 0], [1, 0]]); // shape kept
  const s = call('shape.add', { role: 'note', rect: { cx: 4.4, cy: 0.6, w: 1, h: 1 }, text: 'a' });
  call('quantize', { ids: [s], step: 0.5 });
  assert.deepEqual([state.objects.get(s).rect.cx, state.objects.get(s).rect.cy], [4.5, 0.5]);
  undo();
  assert.deepEqual([state.objects.get(s).rect.cx, state.objects.get(s).rect.cy], [4.4, 0.6]);
});

test('quantize: in a score, across to time and up to the scale', () => {
  call('space.clear');
  call('music.set', { scale: 'Ionian', root: 60, low: 60, high: 72 });
  // a frame 8 units wide is 8 beats: a unit a beat; 12 units tall over an octave: a unit a semitone
  call('shape.add', { role: 'score', rect: { cx: 4, cy: 6, w: 8, h: 12 } });
  const l = call('line.add', { points: [[0.3, 1.2], [2.6, 3.4]] });
  call('quantize', { ids: [l], time: '1/8', pitch: 'scale' });
  // x to half beats; y: 61.2 -> 62 (D), 63.4 -> 64 (E)
  assert.deepEqual(state.objects.get(l).points, [[0.5, 2], [2.5, 4]]);
  call('quantize', { ids: [l], time: '1 bar' });
  assert.deepEqual(state.objects.get(l).points.map((p) => p[0]), [0, 4]);
  assert.throws(() => call('quantize', { ids: [l], pitch: 'nonsense' }), /not "scale"/);
});

test('quantize: outside a score, time needs a grid that times paths', () => {
  call('space.clear');
  const l = call('line.add', { points: [[10.3, 10], [12, 10]] });
  assert.throws(() => call('quantize', { ids: [l], time: 1 }), /grid does not time paths/);
  call('grid.set', { beats: 1 });
  call('quantize', { ids: [l], time: 0.5 });
  assert.deepEqual(state.objects.get(l).points[0], [10.5, 10]);
  assert.throws(() => call('quantize', {}), /select something/);
  call('select.set', { ids: [l] });
  assert.equal(call('quantize', {}).moved, 1);
  assert.deepEqual(state.objects.get(l).points[0], [11, 10]); // to the lattice (10.5 rounds up), through the selection
});
