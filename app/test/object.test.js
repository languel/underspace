import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlanket, portPos, along } from '../src/object.js';
import { fit } from '../src/bind.js';
import { createRunner } from '../src/run.js';
import { PRESETS } from '../src/presets.js';
import { state, call, undo, take } from '../src/space.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
const box = (cx, cy, code) => call('shape.add', { rect: { cx, cy, w: 2, h: 2 }, role: 'code', code });
const fresh = () => { call('space.clear'); take.clips.length = 0; };
// A line from the output of `a` to the first input of `b`, drawn with a bend.
const wire = (a, b, out = 'y', inn = 'x') => {
  const p = portPos(state.objects.get(a), 'outs', out), q = portPos(state.objects.get(b), 'ins', inn);
  return call('line.add', { points: [p, [(p[0] + q[0]) / 2, p[1] + 1], q], tol: 0.2 });
};

test('the blanket is read from the header of the code', () => {
  const b = parseBlanket(PRESETS.scale);
  assert.equal(b.name, 'scale');
  assert.deepEqual(b.ins, ['x']);
  assert.deepEqual(b.outs, ['y']);
  assert.deepEqual(b.params, [{ name: 'gain', value: 0.5 }, { name: 'add', value: 0 }]);
});

test('fit carries a drawing so its ends land on two points', () => {
  const out = fit([[0, 0], [1, 1], [2, 0]], [10, 10], [10, 14]);
  near(out[0][0], 10); near(out[0][1], 10);
  near(out[2][0], 10); near(out[2][1], 14);
  near(Math.hypot(out[1][0] - 10, out[1][1] - 12), 2); // the bend keeps its shape, scaled
});

test('along walks a path by length', () => {
  const p = along([[0, 0], [1, 0], [1, 3]], 0.5);
  near(p[0], 1); near(p[1], 1);
});

test('a line drawn between ports becomes a wire and follows its objects', () => {
  fresh();
  const a = box(0, 0, PRESETS.osc), b = box(5, 0, PRESETS.scale);
  const w = state.objects.get(wire(a, b));
  assert.deepEqual(w.bind, { from: { id: a, port: 'y' }, to: { id: b, port: 'x' } });
  const loose = call('line.add', { points: [[0, 5], [1, 6]], tol: 0.2 });
  assert.equal(state.objects.get(loose).bind, undefined);
  call('object.move', { ids: [b], dx: 0, dy: 3 });
  assert.equal(w.bind.to.id, b); // still bound after the move
});

test('a line drawn backwards, from input to output, is reversed', () => {
  fresh();
  const a = box(0, 0, PRESETS.osc), b = box(5, 0, PRESETS.scale);
  const p = portPos(state.objects.get(a), 'outs', 'y'), q = portPos(state.objects.get(b), 'ins', 'x');
  const w = state.objects.get(call('line.add', { points: [q, p], tol: 0.2 }));
  assert.equal(w.bind.from.id, a);
  assert.deepEqual(w.points[0], p);
});

test('collapse turns cut wires into ports, and expand restores them', () => {
  fresh();
  const a = box(0, 0, PRESETS.osc), b = box(5, 0, PRESETS.scale), c = box(10, 0, PRESETS.scale);
  const w1 = wire(a, b), w2 = wire(b, c);
  const g = call('group.collapse', { ids: [a, b] });
  const group = state.objects.get(g);
  assert.equal(state.objects.get(a).space, g);
  assert.equal(state.objects.get(w1).space, g, 'a wire wholly inside goes in');
  assert.deepEqual(group.ports.outs, [{ name: 'y', inner: { id: b, port: 'y' } }]);
  assert.deepEqual(state.objects.get(w2).bind.from, { id: g, port: 'y' });

  // values still flow through the group's port
  const step = createRunner();
  let r;
  for (let i = 0; i < 4; i++) r = step(state.objects, 1.25); // sin(2π·0.2·1.25) = 1
  near(r.output(g, 'y'), 0.5, 1e-6);
  near(r.input(c, 'x'), 0.5, 1e-6);

  call('group.expand', { id: g });
  assert.equal(state.objects.has(g), false);
  assert.equal(state.objects.get(a).space, null);
  assert.deepEqual(state.objects.get(w2).bind.from, { id: b, port: 'y' });
  assert.deepEqual(state.objects.get(a).rect, { cx: 0, cy: 0, w: 2, h: 2 }, 'contents come back where they were');
});

test('removing an object leaves its wires as plain marks', () => {
  fresh();
  const a = box(0, 0, PRESETS.osc), b = box(5, 0, PRESETS.scale);
  const w = wire(a, b);
  call('object.remove', { ids: [a] });
  assert.equal(state.objects.get(w).bind, undefined);
  assert.equal(state.objects.get(w).points.length, 3);
});

test('undo replays the take without its last change', () => {
  fresh();
  const a = box(0, 0, PRESETS.osc), b = box(5, 0, PRESETS.scale);
  wire(a, b);
  call('group.collapse', { ids: [a, b] });
  call('select.set', { ids: [] });
  undo();
  assert.equal(state.objects.size, 3);
  assert.equal(state.objects.get(a).space, null);
  undo();
  assert.equal(state.objects.size, 2);
});

test('smooth draws a curve through the points; simplify drops what the line does not need', async () => {
  const { smooth, simplify } = await import('../src/object.js');
  const pts = [[0, 0], [1, 1], [2, 0], [3, 1]];
  const curve = smooth(pts, 4);
  assert.equal(curve.length, 13);
  for (const p of pts) assert.ok(curve.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9), 'the curve passes through every point');
  assert.deepEqual(smooth([[0, 0], [1, 1]]), [[0, 0], [1, 1]], 'two points stay a straight line');
  assert.deepEqual(simplify([[0, 0], [1, 0.01], [2, 0], [3, 2], [4, 0]], 0.1), [[0, 0], [2, 0], [3, 2], [4, 0]]);
});

test('line.add reads points written as text and refuses what cannot be drawn', async () => {
  const { call, state } = await import('../src/space.js');
  call('space.clear');
  const id = call('line.add', { points: ['[-4, -1]', '[0, 1]', '[4, 0]'] });
  assert.deepEqual(state.objects.get(id).points, [[-4, -1], [0, 1], [4, 0]]);
  const n = state.objects.size;
  assert.throws(() => call('line.add', { points: [] }), /points must be a list/);
  assert.throws(() => call('line.add', { points: [[0, 0], ['a', 1]] }), /each point is \[x, y\]/);
  assert.equal(state.objects.size, n);
});

test('a take runs only the commands a take can hold', async () => {
  const { call, state, loadTake, define } = await import('../src/space.js');
  let ran = 0;
  define({ name: 'test.outside', record: false, doc: 'not part of a drawing', run: () => { ran++; } });
  loadTake({ type: 'underspace-take', clips: [
    { t: 0, name: 'line.add', args: { points: [[0, 0], [1, 1]] }, by: 'human' },
    { t: 1, name: 'test.outside', args: {}, by: 'human' }, // written into the file by hand
  ] });
  assert.equal(state.objects.size, 1);
  assert.equal(ran, 0);
  call('space.clear');
});
