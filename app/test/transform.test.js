import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spec, apply, applyRect } from '../src/transform.js';
import { snapPoints, snapBox, toSVG, toP5 } from '../src/selection.js';

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test('a quarter turn about a pivot, flat and in 3D', () => {
  close(apply(spec({ pivot: [1, 1], angle: 90 }), [2, 1]), [1, 2]);
  close(apply(spec({ pivot: [0, 0, 0], angle: 90, axis: 'y' }), [1, 0, 0]), [0, 0, -1]);
  assert.equal(apply(spec({ angle: 90, axis: 'x' }), [1, 0]).length, 2); // flat stays flat
});

test('scale and move keep extra coordinates', () => {
  close(apply(spec({ pivot: [1, 0], sx: 2, sy: 3, dx: 1 }), [2, 1, 5, 0.4]), [4, 3, 5, 0.4]);
  assert.deepEqual(applyRect(spec({ pivot: [0, 0], sx: 2 }), { cx: 1, cy: 1, w: 2, h: 1 }), { cx: 2, cy: 1, w: 4, h: 1 });
});

test('snap to the grid, tidy drops repeats and straight runs', () => {
  const r = snapPoints([[0.1, 0], [0.9, 0.1], [1.1, 0], [2.05, 0], [2, 0.9]], 1, 'tidy');
  assert.deepEqual(r.points, [[0, 0], [2, 0], [2, 1]]);
  assert.deepEqual(r.keep, [0, 3, 4]);
  assert.deepEqual(snapBox({ cx: 1.2, cy: 0.3, w: 2, h: 2 }, 1, 'center').map((v) => +v.toFixed(6)), [-0.2, -0.3]);
});

test('SVG and p5 out', () => {
  const marks = [{ pts: [[0, 0], [1, 1]], stroke: '#f00' }, { rect: { cx: 0, cy: 0, w: 1, h: 1 }, shape: 'ellipse' }];
  assert.match(toSVG(marks), /<path d="M[\d. L]+" fill="none" stroke="#f00"/);
  assert.match(toP5(marks), /createCanvas\(\d+, \d+\)[\s\S]*vertex[\s\S]*ellipse\(/);
});
