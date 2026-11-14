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
