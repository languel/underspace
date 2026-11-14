import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, call, undo, TARGET_SPAN } from '../src/space.js';

const near = (a, b, tol = 1e-3) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${a} vs ${b}`));

test('a target takes lines into its 3D scene, with their joints and travelers, and gives them back', () => {
  call('space.clear');
  const a = call('line.add', { points: [[1, 1], [3, 1]], style: { path: 'straight' } });
  const b = call('line.add', { points: [[3, 1], [3, 2]], style: { path: 'straight' } });
  const j = call('joint.add', { at: [{ id: b, u: 0 }, { id: a, u: 1 }] });
  const tr = call('traveler.add', { on: a, dur: 4 });
  const t = call('shape.add', { role: 'target', rect: { cx: 2, cy: 1.5, w: 4, h: 2 } });
  call('target.take', { id: t, ids: [a, b] });
  const k = TARGET_SPAN / 4;
  near(state.objects.get(a).points[0], [-1 * k, -0.5 * k, 0]);
  for (const id of [a, b, j, tr]) assert.equal(state.objects.get(id).space, t, id);
  call('target.take', { id: t, ids: [a, b], out: true });
  near(state.objects.get(a).points[0], [1, 1]);
  assert.equal(state.objects.get(j).space, null);
  undo();
  assert.equal(state.objects.get(a).space, t);
});

test('a traveler moves in 3D on a line in a target', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 6 } });
  const line = call('line.add', { space: t, points: [[0, 0, 0], [0, 0, 4]] });
  const tr = call('traveler.add', { on: line, dur: 4, loop: 0 });
  const play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 4, loop: 0, start: 0, at: 0, speed: 0, drawn: 0, ...o.params }), note() {} };
  let r;
  for (let s = 0; s <= 2.0001; s += 0.05) r = play.step(state.objects, s, true, hooks);
  near(r.moved.get(tr), [0, 0, 2], 1e-6);
});

test('smoothing: 3D curves too, and as many pieces as asked for each stretch', async () => {
  const { smooth, stepsOnScreen } = await import('../src/object.js');
  const pts = [[0, 0, 0], [1, 1, 1], [2, 0, 2], [3, 1, 3]];
  const s = smooth(pts);
  assert.equal(s[0].length, 3, 'it stays 3D');
  assert.equal(s.length, 3 * 6 + 1);
  const fine = smooth(pts, stepsOnScreen(100));          // a stretch is about 173 px: about 58 pieces
  assert.ok(fine.length > 150, `${fine.length}`);
  const coarse = smooth([[0, 0], [1, 0], [2, 1]], stepsOnScreen(1)); // a pixel a unit: the fewest
  assert.equal(coarse.length, 2 * 2 + 1);
  assert.deepEqual(fine[0], [0, 0, 0]); assert.deepEqual(fine[fine.length - 1], [3, 1, 3]);
});

test('a render target has code: its ports from its header, its camera from what it returns', async () => {
  const { blanketOf, TARGET_PRESETS } = await import('../src/object.js');
  const { createRunner } = await import('../src/run.js');
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 6 } });
  assert.deepEqual(blanketOf(state.objects.get(t)).ins, ['spin', 'tilt']);
  call('object.set', { id: t, name: 'orbit', value: 3 });
  const step = createRunner();
  let r = step(state.objects, 10);
  assert.equal(r.output(t, 'spin'), 1, '3 turns a minute, 10 s on: one half turn');
  assert.equal(r.output(t, 'zoom'), 1);
  call('object.code', { id: t, code: TARGET_PRESETS.look });
  assert.deepEqual(blanketOf(state.objects.get(t)).ins, ['x', 'y', 'z', 'spin', 'tilt']);
  r = step(state.objects, 0);
  assert.deepEqual(r.output(t, 'center'), [0, 0, 0]);
});

test('pen pressure as width: runs of one width, covering the curve exactly once', async () => {
  const { pressureRuns, smooth } = await import('../src/object.js');
  const pts = [[0, 0, 0], [1, 0, 0], [2, 1, 0], [3, 1, 1], [4, 0, 1]];
  const pen = [[0, 0.1], [10, 0.1], [20, 0.9], [30, 0.9], [40, 0.9]];
  const runs = pressureRuns(pts, pen, 2);
  assert.equal(runs.length, 3, `${runs.map((r) => r.width)}`); // light, rising, heavy
  assert.ok(runs[0].width < runs[2].width);
  const joined = runs.flatMap((r, i) => (i ? r.pts.slice(1) : r.pts));
  assert.deepEqual(joined, smooth(pts), 'the runs are the smooth curve, end to end');
  assert.equal(pressureRuns(pts, null, 2), null);
});

test('events in 3D: a point passed through, a line passed near, a closed line gone through', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 6 } });
  const line = call('line.add', { space: t, points: [[0, 0, 0], [0, 0, 10]], style: { path: 'straight' } });
  call('traveler.add', { on: line, dur: 10, loop: 0 });
  const pt = call('point.add', { space: t, at: [0.1, 0, 2], glyph: 'note', size: 0.4, role: 'event' });
  call('object.code', { id: pt, code: 'note(60, 100, 0.1);' });
  const bar = call('line.add', { space: t, points: [[-1, 0.1, 5], [1, 0.1, 5]], style: { path: 'straight' } });
  call('object.role', { id: bar, role: 'event' }); call('object.code', { id: bar, code: 'note(64, 100, 0.1);' });
  const ring = call('line.add', { space: t, points: Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return [Math.cos(a), Math.sin(a), 8]; }), closed: true });
  call('object.role', { id: ring, role: 'event' }); call('object.code', { id: ring, code: 'note(67, 100, 0.1);' });
  const far = call('point.add', { space: t, at: [3, 3, 4], size: 0.4, role: 'event' });
  call('object.code', { id: far, code: 'note(99, 100, 0.1);' });
  const notes = [], play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 10, loop: 0, start: 0, at: 0, speed: 0, drawn: 0, ...o.params }), note: (m) => notes.push(m) };
  for (let s = 0; s <= 9.5; s += 1 / 30) play.step(state.objects, s, true, hooks);
  assert.deepEqual(notes, [60, 64, 67]);
});
