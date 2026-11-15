import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, call, undo, TARGET_SPAN } from '../src/space.js';
import { flatCamera, camera } from '../src/framing.js';

const near = (a, b, tol = 2e-2) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${a} vs ${b}`));

test('the flat camera shows the plane z = 0 exactly as the frame', () => {
  const rect = { cx: 5, cy: -2, w: 6, h: 3 }, c = flatCamera(rect, TARGET_SPAN), k = TARGET_SPAN / 6;
  const f = camera(c, rect.w / rect.h);
  near(f([-3 * k, -1.5 * k, 0]), [-1, -1]); // the frame's corner is the view's corner
  near(f([3 * k, 1.5 * k, 0]), [1, 1]);
  near(f([0, 0, 0]), [0, 0]);
});

test('a frame over marks takes them in and faces them, and a point at depth shifts as perspective says', () => {
  call('space.clear');
  const a = call('line.add', { points: [[1, 1], [3, 1.5]], style: { path: 'straight' } });
  const t = call('shape.add', { role: 'target', rect: { cx: 2, cy: 1.25, w: 4, h: 2.5 } });
  call('target.take', { id: t, ids: [a], view: true });
  const o = state.objects.get(t);
  assert.equal(o.az, 0); assert.equal(o.el, 0); assert.ok(o.dist > 0);
  // out again: through the same camera, the line is where it was
  call('target.take', { id: t, ids: [a], out: true });
  near(state.objects.get(a).points[0], [1, 1]);
  near(state.objects.get(a).points[1], [3, 1.5]);
});

test('the camera is not moved when the scene already held something, or when not asked', () => {
  call('space.clear');
  const a = call('line.add', { points: [[1, 1], [3, 1]], style: { path: 'straight' } });
  const t = call('shape.add', { role: 'target', rect: { cx: 2, cy: 1, w: 4, h: 2 } });
  call('target.set', { id: t, az: 0.6, el: 0.35 });
  call('target.take', { id: t, ids: [a] });
  assert.equal(state.objects.get(t).az, 0.6);
});

test('dissolving a frame keeps what is in it, projected through its camera onto the canvas', () => {
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 8 } });
  const near3 = call('line.add', { space: t, points: [[-1, 0, 2], [1, 0, 2]], style: { path: 'straight' } });
  const far3 = call('line.add', { space: t, points: [[-1, 0, -2], [1, 0, -2]], style: { path: 'straight' } });
  call('target.set', { id: t, az: 0, el: 0 });
  call('target.dissolve', { id: t });
  assert.equal(state.objects.has(t), false);
  const n = state.objects.get(near3), f = state.objects.get(far3);
  assert.equal(n.space, null); assert.equal(f.space, null);
  const wn = Math.abs(n.points[1][0] - n.points[0][0]), wf = Math.abs(f.points[1][0] - f.points[0][0]);
  assert.ok(wn > wf, 'nearer is larger, as the camera showed it');
  assert.ok(state.selection.has(near3));
  undo();
  assert.ok(state.objects.has(t)); assert.equal(state.objects.get(near3).space, t);
});

test('dissolving a frame gives a mesh back as closed lines', () => {
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 8 } });
  const m = call('mesh.add', { space: t });
  call('mesh.set', { id: m, verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], faces: [[0, 1, 2, 3]] });
  call('target.dissolve', { id: t });
  assert.equal(state.objects.has(m), false);
  const lines = [...state.objects.values()].filter((o) => o.kind === 'line' && o.closed);
  assert.equal(lines.length, 1); assert.equal(lines[0].points.length, 4);
});
