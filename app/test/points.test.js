import { test } from 'node:test';
import assert from 'node:assert/strict';
import { without } from '../src/points.js';

test('without drops points and keeps the pen in step', () => {
  const r = without([[0, 0], [1, 1], [2, 0], [3, 1]], [[0, 0.1], [10, 0.2], [20, 0.3], [30, 0.4]], [1, 2]);
  assert.deepEqual(r.points, [[0, 0], [3, 1]]);
  assert.deepEqual(r.pen, [[0, 0.1], [30, 0.4]]);
});

test('without leaves null when under two points would remain', () => {
  assert.equal(without([[0, 0], [1, 1], [2, 2]], null, [0, 1]), null);
  assert.equal(without([[0, 0], [1, 1], [2, 2]], null, [1]).pen, null);
});
