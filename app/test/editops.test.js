import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subdivide, cut, join, removeVerts, dissolveVerts, subdivideEdges, mergeVerts, fill } from '../src/editops.js';

const line = [[0, 0], [1, 0], [2, 0], [3, 0]];
const pen = line.map((_, i) => [i * 10, 0.2 * i]);

test('subdivide: a point between picked neighbours, in two and three dimensions', () => {
  const r = subdivide(line, pen, [1, 2], { curved: false });
  assert.deepEqual(r.points, [[0, 0], [1, 0], [1.5, 0], [2, 0], [3, 0]]);
  assert.deepEqual(r.picked, [1, 2, 3]);
  assert.ok(Math.abs(r.pen[2][1] - 0.3) < 1e-9);
  assert.equal(subdivide(line, null, [0, 2]), null); // not neighbours
  const r3 = subdivide([[0, 0, 0], [2, 0, 2], [4, 0, 0]], null, [0, 1, 2]);
  assert.equal(r3.points.length, 5);
  assert.ok(r3.points.every((p) => p.length === 3 && p.every(Number.isFinite)));
  assert.equal(subdivide(line, null, [3, 0], { closed: true, curved: false }).points.length, 5);
});

test('cut: pieces that share the picked point; a closed line opens', () => {
  const r = cut(line, pen, [2]);
  assert.deepEqual(r.map((x) => x.points), [[[0, 0], [1, 0], [2, 0]], [[2, 0], [3, 0]]]);
  assert.equal(r[0].pen.length, 3);
  assert.equal(cut(line, null, [0, 3]), null); // ends cut nothing
  const ring = [[0, 0], [1, 0], [1, 1], [0, 1]], open = cut(ring, null, [2], { closed: true });
  assert.deepEqual(open[0].points, [[1, 1], [0, 1], [0, 0], [1, 0], [1, 1]]);
  assert.equal(cut(ring, null, [0, 2], { closed: true }).length, 2);
});

test('join: two lines by their picked ends, turned as needed', () => {
  const a = { points: [[0, 0], [1, 0]] }, b = { points: [[3, 0], [2, 0]] };
  assert.deepEqual(join(a, 1, b, 1).points, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(join(a, 0, b, 0).points, [[1, 0], [0, 0], [3, 0], [2, 0]]);
  assert.deepEqual(join(a, 1, { points: [[1, 0], [5, 5]] }, 0).points, [[0, 0], [1, 0], [5, 5]]); // ends together: one point
  assert.equal(join({ points: line }, 1, b, 0), null);
});

const V = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]];
const F = [[0, 1, 2, 3], [1, 4, 5, 2]];

test('mesh: take away, dissolve, subdivide, merge, fill', () => {
  const rm = removeVerts(V, F, [4]);
  assert.equal(rm.verts.length, 5); assert.deepEqual(rm.faces, [[0, 1, 2, 3]]);
  const ds = dissolveVerts(V, F, [4]);
  assert.deepEqual(ds.faces, [[0, 1, 2, 3], [1, 4, 2]]);
  const sd = subdivideEdges(V, F, [1, 2]);
  assert.equal(sd.verts.length, 7);
  assert.deepEqual(sd.faces, [[0, 1, 6, 2, 3], [1, 4, 5, 2, 6]]);
  assert.deepEqual(sd.verts[6], [1, 0.5, 0]);
  const mg = mergeVerts(V, F, [4, 5]);
  assert.equal(mg.verts.length, 5);
  assert.deepEqual(mg.faces, [[0, 1, 2, 3], [1, 4, 2]]);
  assert.deepEqual(mg.verts[4], [2, 0.5, 0]);
  const fl = fill(V, [F[0]], [5, 1, 2, 4]);
  const f = fl.faces[1], k = f.indexOf(1);
  const round = [0, 1, 2, 3].map((i) => f[(k + i) % 4]);
  assert.ok(round.join() === '1,4,5,2' || round.join() === '1,2,5,4', round.join());
  assert.equal(fill(V, F, [0, 1, 2, 3]), null);
});
