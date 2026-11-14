import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, crossings, waysAt, measure } from '../src/joints.js';
import { state, call, undo } from '../src/space.js';

const near = (a, b, tol = 1e-3) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${a} vs ${b}`));
const line = (id, points, extra = {}) => [id, { id, kind: 'line', role: 'ink', space: null, points, off: [0, 0], style: { path: 'straight' }, ...extra }];

test('a joint brings an end onto a curve, and the curve keeps its shape', () => {
  const objects = new Map([line('a', [[0, 0], [4, 0]]), line('b', [[2, 1], [3, 3], [2, 5]]),
    ['j', { id: 'j', kind: 'joint', space: null, at: [{ id: 'b', u: 0 }, { id: 'a', u: 0.5, slide: true }], pos: [2, 0] }]]);
  const { points, joints } = solve(objects, { hold: new Set(['a']) });
  assert.ok(!points.has('a'));
  const b = points.get('b');
  near(b[0], [2, 0]);
  // the same shape: distances between its points keep their proportions (it may turn and scale, as a wire does)
  const d = (i, k) => Math.hypot(b[i][0] - b[k][0], b[i][1] - b[k][1]);
  near([d(1, 0) / d(2, 0), d(2, 1) / d(2, 0)], [Math.hypot(1, 2) / 4, Math.hypot(1, 2) / 4], 1e-6);
  near(b[2], [2, 5], 1e-2); // the far end stays: the least change
  near(joints.get('j').pos, [2, 0]);
});

test('3D: two curves welded end to end follow each other', () => {
  const objects = new Map([line('a', [[0, 0, 0], [1, 1, 1]]), line('b', [[1.2, 1, 1], [3, 0, 2]]),
    ['j', { id: 'j', kind: 'joint', space: null, at: [{ id: 'b', u: 0 }, { id: 'a', u: 1 }], pos: [1, 1, 1] }]]);
  const { points } = solve(objects, { hold: new Set(['a']) });
  near(points.get('b')[0], [1, 1, 1]);
});

test('commands: drawn, joined, then moving one line carries the other; undo replays the same', () => {
  call('space.clear');
  const a = call('line.add', { points: [[0, 0], [4, 0]], style: { path: 'straight' } });
  const b = call('line.add', { points: [[2, 0.3], [2, 4]], style: { path: 'straight' } });
  const j = call('joint.add', { at: [{ id: b, u: 0 }, { id: a, u: 0.5, slide: true }] });
  near(state.objects.get(b).points[0], [2, 0]);
  call('object.move', { ids: [a], dx: 0, dy: 3 });
  near(state.objects.get(b).points[0], [2, 3], 2e-3);
  near(state.objects.get(j).pos, [2, 3], 2e-3);
  const before = JSON.stringify(state.objects.get(b).points);
  call('object.move', { ids: [a], dx: 1, dy: 0 });
  undo();
  assert.equal(JSON.stringify(state.objects.get(b).points), before);
  call('object.remove', { ids: [a] });
  assert.ok(!state.objects.has(j), 'a joint goes with its line');
});

test('pins and level lines', () => {
  call('space.clear');
  const a = call('line.add', { points: [[0, 0], [4, 0.5]], style: { path: 'straight' } });
  call('joint.add', { at: [{ id: a, u: 0 }], fix: true, pos: [0, 0] });
  call('line.keep', { ids: [a], horv: true });
  const p = state.objects.get(a).points;
  near(p[0], [0, 0]);
  assert.ok(Math.abs(p[1][1]) < 2e-3, 'level');
});

test('crossings and the ways on from a junction', () => {
  const c = crossings([[0, 0], [4, 0]], [[1, -1], [1, 1]]);
  assert.equal(c.length, 1);
  near([c[0].ua, c[0].ub], [0.25, 0.5]);
  const m = new Map([['a', measure([[0, 0], [4, 0]])], ['b', measure([[1, -1], [1, 1]])]]);
  const ways = waysAt({ at: [{ id: 'a', u: 0.25 }, { id: 'b', u: 0.5 }] }, 'a', 1, [1, 0, 0], (id) => m.get(id));
  assert.equal(ways[0].line, 'a'); // straight on first
  assert.equal(ways.length, 3);    // and left, and right
  assert.ok(ways.some((w) => w.line === 'b' && w.turn > 0) && ways.some((w) => w.line === 'b' && w.turn < 0));
});

test('a traveler runs through a junction onto the next line', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const a = call('line.add', { points: [[0, 0], [4, 0]], style: { path: 'straight' } });
  const b = call('line.add', { points: [[4, 0], [4, 4]], style: { path: 'straight' } });
  call('joint.add', { at: [{ id: b, u: 0 }, { id: a, u: 1 }] });
  const tr = call('traveler.add', { on: a, dur: 4, loop: 0 });
  const play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => ({ dur: 4, loop: 0, start: 0, ...o.params }), note() {} };
  let r;
  for (let t = 0; t <= 6; t += 0.05) r = play.step(state.objects, t, true, hooks);
  near(r.moved.get(tr), [4, 2], 0.05); // 4 units along a, then 2 up b
});

test('a stroke turned event or traveler keeps its shape', () => {
  call('space.clear');
  const a = call('line.add', { points: [[0, 0], [4, 0]] });
  const s = call('line.add', { points: [[1, 1], [1.2, 1.4], [0.9, 1.6]] });
  const before = JSON.stringify(state.objects.get(s).points);
  assert.ok(call('traveler.attach', { id: s, on: a, u: 0.2 }));
  assert.equal(state.objects.get(s).role, 'traveler');
  assert.equal(JSON.stringify(state.objects.get(s).points), before);
  const e = call('line.add', { points: [[2, -1], [2, 1]] });
  assert.ok(call('object.role', { id: e, role: 'event' }));
  assert.equal(state.objects.get(e).kind, 'line');
});

const T_HOOKS = { spb: 1, pointsOf: (l) => l.points, paramsOf: (o) => { const p = { dur: 2, loop: 0, start: 0 }; for (const m of (o.code ?? '').matchAll(/\/\/ param: (\w+) ([\d.]+)/g)) p[m[1]] = +m[2]; return { ...p, ...o.params }; }, note() {} };
// A T: a stem coming down onto a bar; travelers set off down the stem.
async function tee(junctionCode) {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const bar = call('line.add', { points: [[-4, 0], [4, 0]], style: { path: 'straight' } });
  const stem = call('line.add', { points: [[0, 4], [0, 0]], style: { path: 'straight' } });
  const j = call('joint.add', { at: [{ id: stem, u: 1 }, { id: bar, u: 0.5 }] });
  if (junctionCode) call('object.code', { id: j, code: junctionCode });
  return { createPlay, bar, stem, j };
}
const run = (play, until, dt = 0.05) => { let r; for (let t = 0; t <= until + 1e-9; t += dt) r = play.step(state.objects, t, true, T_HOOKS); return r; };

test('round robin: travelers arriving one after another take turns', async () => {
  const { createPlay, stem } = await tee();
  const a = call('traveler.add', { on: stem, dur: 2, loop: 0 }), b = call('traveler.add', { on: stem, dur: 2, loop: 0, u: 0 });
  const r = run(createPlay(), 3); // 4 down, then 2 along the bar
  const xs = [r.moved.get(a)[0], r.moved.get(b)[0]].sort((p, q) => p - q);
  assert.ok(xs[0] < -1 && xs[1] > 1, `one went each way: ${xs}`);
});

test('a junction that splits sends copies every way', async () => {
  const { JUNCTIONS } = await import('../src/joints.js');
  const { createPlay, stem } = await tee(JUNCTIONS.split);
  const a = call('traveler.add', { on: stem, dur: 2, loop: 0 });
  const r = run(createPlay(), 3);
  assert.equal(r.ghosts.length, 1);
  assert.ok(Math.sign(r.ghosts[0].pos[0]) === -Math.sign(r.moved.get(a)[0]), 'the copy went the other way');
});

test('an event can send a traveler back, and a shape made an event keeps its look', async () => {
  const { createPlay, EVENTS } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [10, 0]], style: { path: 'straight' } });
  const tr = call('traveler.add', { on: line, dur: 10, loop: 0 });
  const wall = call('line.add', { points: [[6, -1], [6, 1]] });
  call('object.role', { id: wall, role: 'event' });
  call('object.code', { id: wall, code: EVENTS.reflect });
  const r = run(createPlay(), 8, 0.1); // to 6, then back 2
  assert.ok(Math.abs(r.moved.get(tr)[0] - 4) < 0.15, `came back: ${r.moved.get(tr)}`);
  const v = call('shape.add', { rect: { cx: 0, cy: 0, w: 1, h: 1 }, style: { stroke: '#123456' } });
  call('object.role', { id: v, role: 'event' });
  assert.equal(state.objects.get(v).keeps, true);
  assert.equal(state.objects.get(v).style.stroke, '#123456');
});

test('reflect on a smooth line, in uneven steps, does not stick at the event', async () => {
  const { createPlay, EVENTS } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [3, 0.2], [7, -0.1], [10, 0]] });
  const tr = call('traveler.add', { on: line, dur: 10, loop: 0 });
  const wall = call('line.add', { points: [[6.03, -1], [6.11, 1]] });
  call('object.role', { id: wall, role: 'event' });
  call('object.code', { id: wall, code: EVENTS.reflect });
  const { smooth } = await import('../src/object.js');
  const hooks = { ...T_HOOKS, pointsOf: (l) => smooth(l.points), paramsOf: (o) => ({ dur: 10, loop: 0, start: 0, ...o.params }) };
  const play = createPlay();
  let r;
  for (let t = 0, k = 0; t <= 9; t += 0.037 + (k++ % 3) * 0.031) r = play.step(state.objects, t, true, hooks);
  const x = r.moved.get(tr)[0];
  assert.ok(x < 4.5, `went back past the start of its return: ${x}`);
});
