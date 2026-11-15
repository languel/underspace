import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRUSHES, brushSource, compileBrush, syncBrushes, isBuiltinBrush, resolveParams } from '../src/ink/brushes.js';
import { state, call, undo } from '../src/space.js';

// a canvas context that only counts what is asked of it
const ctx = () => { const calls = []; return new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => { t[k] = v; return true; } }); };

test('every built-in brush reads back as source that makes the same brush', () => {
  for (const id of Object.keys(BRUSHES)) {
    const def = compileBrush(brushSource(id));
    assert.equal(def.id, id);
    assert.deepEqual(def.roles, BRUSHES[id].roles);
    assert.deepEqual(def.params.map((p) => [p.key, p.min, p.max, p.default]), BRUSHES[id].params.map((p) => [p.key, p.min, p.max, p.default]), id);
  }
  assert.throws(() => compileBrush('brush({ id: "x" })'), /draw/);
  assert.throws(() => compileBrush('2'), /brush\(/);
});

const code = `brush({ id: 'beads', label: 'Beads', roles: ['line'], params: { size: [1, 20, 4, 'Bead size'] },
  draw(ctx, e, p, k) { ctx.fillStyle = e.color || k.INK; for (const [x, y] of e.points) { ctx.beginPath(); ctx.arc(x, y, p.size / 2, 0, 7); ctx.fill(); } } })`;

test('a brush written in the drawing: defined, drawn with, removed, undone', () => {
  assert.equal(call('brush.define', { id: 'beads', code }), 'beads');
  assert.ok(BRUSHES.beads?.custom && !isBuiltinBrush('beads'));
  assert.deepEqual(resolveParams('beads', { size: 99 }), { size: 20 });
  const g = ctx();
  BRUSHES.beads.draw(g, { points: [[0, 0, 0, 0.5], [5, 5, 10, 0.5]], color: '#000', role: 'line' }, resolveParams('beads'), {});
  assert.equal(g.calls.filter((c) => c === 'arc').length, 2);
  // the very next command can draw with it
  const id = call('line.add', { points: [[0, 0], [1, 1]], brush: { id: 'beads' } });
  assert.equal(state.objects.get(id).brush.id, 'beads');
  call('brush.remove', { id: 'beads' });
  assert.equal(BRUSHES.beads, undefined);
  assert.equal(state.objects.get(id).brush, undefined);
  undo(); // the brush is back, and the line has it again
  assert.ok(BRUSHES.beads);
  assert.equal(state.objects.get(id).brush.id, 'beads');
  assert.ok(syncBrushes({ ink: code }).ink); // a built-in one is never replaced
  syncBrushes(state.brushes);
});

test('a brush that throws is drawn plainly and says why', () => {
  const bad = compileBrush(`brush({ id: 'bad', draw() { throw new Error('no paint'); } })`);
  bad.draw(ctx(), { points: [[0, 0, 0, 0.5], [5, 5, 10, 0.5]], role: 'line' }, {}, {});
  assert.equal(bad.lastError, 'no paint');
});

test('a line of two points, or a straight one, has samples along its length (the Ink brush swells and tapers it)', async () => {
  const { smoothPath, densify } = await import('../src/ink/walk.js');
  const two = [[0, 0, 0, 0.2], [60, 0, 100, 0.8]], out = smoothPath(two, false);
  assert.ok(out.length > 10);
  assert.deepEqual(out[0], [0, 0, 0, 0.2]); assert.deepEqual(out.at(-1), [60, 0, 100, 0.8]);
  assert.ok(out.every((q, i) => !i || (q[0] > out[i - 1][0] && q[3] >= out[i - 1][3]))); // in order, pressure ramps
  const corner = densify([[0, 0], [30, 0], [30, 30]]);
  assert.ok(corner.some((q) => q[0] === 30 && q[1] === 0)); // corners are kept
  // the Ink brush: the same two points now draw a swelling shape, not a thin line
  let widths = 0; const g = new Proxy({}, { get: (t, k) => (k === 'lineTo' ? () => { widths++; } : () => {}), set: () => true });
  BRUSHES.ink.draw(g, { points: two, closed: false, color: '#000', role: 'line' }, resolveParams('ink'), {});
  assert.ok(widths > 10, String(widths));
});
