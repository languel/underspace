import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnet, onLattice } from '../src/magnet.js';

const near = (a, b, tol = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${a} vs ${b}`));
// a camera looking down z: screen x = 100 x + 400, y = 300 - 100 y
const toScreen = (p) => [400 + p[0] * 100, 300 - p[1] * 100];
const stroke = { points: [[0, 0, 1], [2, 0, 1]], curve: [[0, 0, 1], [1, 0, 1], [2, 0, 1]] };

test('the magnet: points, along strokes, middles, perpendiculars, and the plane when nothing is near', () => {
  const at = (x, y) => [400 + x * 100, 300 - y * 100];
  assert.deepEqual(magnet({ mode: 'point', pointer: at(1.95, 0.05), strokes: [stroke], toScreen, onPlane: [1.95, 0.05, 0] }), { point: [2, 0, 1], kind: 'point' });
  const e = magnet({ mode: 'edge', pointer: at(0.3, 0.05), strokes: [stroke], toScreen });
  assert.equal(e.kind, 'edge'); near(e.point, [0.3, 0, 1]);
  near(magnet({ mode: 'middle', pointer: at(0.3, 0.05), strokes: [stroke], toScreen }).point, [0.5, 0, 1]);
  near(magnet({ mode: 'perp', pointer: at(1.4, 0.05), strokes: [stroke], toScreen, from: [1.7, 3, 1] }).point, [1.7, 0, 1]);
  assert.deepEqual(magnet({ mode: 'auto', pointer: at(1, 2), strokes: [stroke], toScreen, onPlane: [1, 2, 0] }), { point: [1, 2, 0], kind: 'free' });
  assert.equal(magnet({ mode: 'off', pointer: at(2, 0), strokes: [stroke], toScreen, onPlane: [2, 0, 0] }).kind, 'free');
});

test('the grid lies in the drawing plane, in its own directions', () => {
  near(onLattice([0.26, 0.74, 0], { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }, 0.5), [0.5, 0.5, 0]);
  // a plane tilted about x, through (0, 0, 1)
  const c = Math.SQRT1_2, plane = { origin: [0, 0, 1], u: [1, 0, 0], v: [0, c, c] };
  const q = onLattice([0.9, 0.3 * c, 1 + 0.3 * c], plane, 0.5);
  near(q, [1, 0.5 * c, 1 + 0.5 * c], 1e-9);
});
