import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POINT_KINDS, glyphLines } from '../src/glyphs.js';
import { nodeCodeFor } from '../src/nous.js';
import { state, call, undo } from '../src/space.js';

const params = (o) => { const p = {}; for (const m of (o.code ?? '').matchAll(/\/\/ param: (\w+) (-?[\d.]+)/g)) p[m[1]] = +m[2]; return { ...p, ...o.params }; };

test('every glyph has an outline, around its centre', () => {
  for (const k of POINT_KINDS) {
    const g = glyphLines(k, [10, 5], 1);
    assert.ok(g.length > 0, k);
    for (const l of g) for (const [x, y] of l.pts) assert.ok(Math.abs(x - 10) <= 1.2 && Math.abs(y - 5) <= 1.2, `${k} stays within its size`);
  }
});

test('points: placed, retyped, made events; a traveler passing fires a point event', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const pt = call('point.add', { at: [5, 0.1], glyph: 'ring', size: 0.6 });
  assert.equal(state.objects.get(pt).kind, 'point');
  call('object.glyph', { ids: [pt], glyph: 'led' });
  assert.equal(state.objects.get(pt).glyph, 'led');
  undo();
  assert.equal(state.objects.get(pt).glyph, 'ring');
  call('object.role', { id: pt, role: 'event' });
  call('object.code', { id: pt, code: 'note(70, 100, 0.1);' });
  const line = call('line.add', { points: [[0, 0], [10, 0]], style: { path: 'straight' } });
  call('traveler.add', { on: line, dur: 10, loop: 0 });
  const notes = [], play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 10, loop: 0, start: 0, at: 0, speed: 0, drawn: 0, ...params(o) }), note: (m) => notes.push(m) };
  for (let t = 0; t <= 8; t += 0.05) play.step(state.objects, t, true, hooks);
  assert.deepEqual(notes, [70]);
});

test('a point on a line is a node: a traveler passing plays it and goes on', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [10, 0]], style: { path: 'straight' } });
  const node = call('joint.add', { at: [{ id: line, u: 0.3 }], node: true, glyph: 'note', code: nodeCodeFor('note', 64) });
  assert.ok(node, 'one place is enough for a node');
  const tr = call('traveler.add', { on: line, dur: 10, loop: 0 });
  const notes = [], play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => (o.kind === 'joint' ? params(o) : { dur: 10, loop: 0, start: 0, at: 0, speed: 0, drawn: 0, ...o.params }), note: (m) => notes.push(m) };
  let r;
  for (let t = 0; t <= 8; t += 0.05) r = play.step(state.objects, t, true, hooks);
  assert.deepEqual(notes, [64]);
  assert.ok(r.moved.get(tr)[0] > 7, 'and it went on');
  call('object.remove', { ids: [line] });
  assert.ok(!state.objects.has(node), 'a node goes with its line');
});
