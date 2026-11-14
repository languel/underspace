import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognize } from '../src/pie.js';

const circle = Array.from({ length: 40 }, (_, i) => { const a = (i / 39) * Math.PI * 2; return [Math.cos(a) * 3, Math.sin(a) * 2]; });
const square = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0.05]];

test('a closed round stroke is an ellipse, a boxy one a rectangle', () => {
  const e = recognize(circle);
  assert.equal(e.shape, 'ellipse');
  assert.ok(Math.abs(e.rect.w - 6) < 0.01 && Math.abs(e.rect.h - 4) < 0.05);
  assert.equal(recognize(square).shape, 'rect');
});

test('an open stroke is no shape', () => {
  assert.equal(recognize([[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]]), null);
});

test('simplifying a closed stroke keeps its shape', async () => {
  const { simplifyIndex } = await import('../src/object.js');
  const keep = simplifyIndex(circle, 0.05);
  assert.ok(keep.length > 8, `kept ${keep.length}`);
});
