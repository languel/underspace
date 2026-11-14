import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCULPTS, MESH_SCULPTS, sculptMark } from '../src/ink/sculpt.js';

// a point as sculpted in a scene: [sx, sy, ms, pressure, x, y, z]
const line = Array.from({ length: 5 }, (_, i) => [i * 40, 100, 0, 0.5, i, 0, i * 0.5]);
const stroke = (x, y, more = {}) => ({ x, y, dx: 0, dy: -10, radius: 60, strength: 1, pressure: 1, first: true, start: [x, y], ...more });

test('every tool passes on what a point carries past pressure', () => {
  for (const id of Object.keys(SCULPTS)) {
    const out = sculptMark(id, { points: line, closed: false }, stroke(80, 100), undefined, () => 0.3);
    if (!out) continue;
    assert.ok(out.every((q) => q.length === 7 && q.slice(4).every(Number.isFinite)), id);
  }
});

test('points a tool adds lie between the places of their neighbours', () => {
  const out = sculptMark('push', { points: line, closed: false, path: 'straight' }, stroke(80, 100));
  assert.ok(out.length > line.length);
  for (const q of out) assert.ok(q[4] >= 0 && q[4] <= 4 && Math.abs(q[6] - q[4] * 0.5) < 1e-9);
});

test('a mesh: no corners added, and smooth uses the neighbours it is given', () => {
  const verts = [[0, 0], [40, 0], [40, 40], [0, 40]].map((p, i) => [...p, 0, 0.5, i, 0, 0]);
  for (const id of MESH_SCULPTS) {
    const out = sculptMark(id, { points: verts, path: 'straight', mean: () => null }, stroke(20, 20), { detail: 0 }, () => 0.3);
    if (out) assert.equal(out.length, 4, id);
  }
  const to = [100, 100], out = sculptMark('smooth', { points: verts, path: 'straight', mean: () => to }, stroke(20, 20), { amount: 1 });
  assert.ok(out.every((q, i) => Math.hypot(q[0] - to[0], q[1] - to[1]) < Math.hypot(verts[i][0] - to[0], verts[i][1] - to[1])));
});
