import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nousPlan, applyNous, nodeCodeFor } from '../src/nous.js';
import { state, call } from '../src/space.js';

const params = (o) => { const p = {}; for (const m of (o.code ?? '').matchAll(/\/\/ param: (\w+) (-?[\d.]+)/g)) p[m[1]] = +m[2]; return { dur: 8, loop: 0, start: 0, at: 0, speed: 0, drawn: 0, ...(o.kind === 'joint' ? {} : {}), ...p, ...o.params }; };
async function run(project, seconds) {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  applyNous(nousPlan(project, { cell: 1 }), call);
  const notes = [], play = createPlay(), hooks = { spb: 1, grid: 1, pointsOf: (l) => l.points, paramsOf: params, note: (m) => notes.push(m) };
  let r;
  for (let t = 0; t <= seconds; t += 1 / 60) r = play.step(state.objects, t, true, hooks);
  return { notes, r };
}

test('a switch lets every other traveler on', async () => {
  // a start node that splits each lap: one way two cells down to a switch and a note, the other two cells
  // across and back (a lap of four seconds), so a traveler reaches the switch every four seconds
  const { notes } = await run({ points: [
    { id: 1, x: 0, y: 0, type: 'anchor', isStart: true, playMode: 'split', to: [2, 4] },
    { id: 2, x: 0, y: 288, type: 'switch', to: [3] },
    { id: 3, x: 0, y: 576, type: 'note', note: 72, to: [] },
    { id: 4, x: 288, y: 0, type: 'anchor', to: [1] },
  ] }, 21);
  // the switch at 2, 6, 10, 14, 18 s: on, off, on, off, on; the note two seconds after each on
  assert.deepEqual(notes, [72, 72, 72]);
});

test('a gate opens only while its input is lit', async () => {
  const open = await run({ points: [
    { id: 1, x: 0, y: 0, type: 'note', note: 60, duration: 8, isStart: true, to: [2], SerializableLogicPathTo: [2] },
    { id: 2, x: 288, y: 0, type: 'gate', to: [3] },
    { id: 3, x: 576, y: 0, type: 'note', note: 67, to: [] },
  ] }, 6);
  assert.deepEqual(open.notes, [60, 67], 'the start note is still sounding (lit) when the traveler reaches the gate');
  const shut = await run({ points: [
    { id: 1, x: 0, y: 0, type: 'note', note: 60, duration: 1, isStart: true, to: [2], SerializableLogicPathTo: [2] },
    { id: 2, x: 432, y: 0, type: 'gate', to: [3] },
    { id: 3, x: 720, y: 0, type: 'note', note: 67, to: [] },
  ] }, 8);
  assert.deepEqual(shut.notes, [60], 'a beat later the light is out: the gate stops it');
});

test('an LED toggles, and its light is what the view shows', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [4, 0]], style: { path: 'straight' } });
  const led = call('joint.add', { at: [{ id: line, u: 0.5 }], node: true, glyph: 'led', code: nodeCodeFor('led') });
  call('object.set', { id: led, name: 'toggle', value: 1 });
  call('traveler.add', { on: line, dur: 4, loop: 1 });
  const play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: params, note() {} };
  let r;
  for (let t = 0; t <= 3; t += 1 / 60) r = play.step(state.objects, t, true, hooks);
  assert.ok(r.lit.has(led), 'on after the first pass');
  for (let t = 3; t <= 7; t += 1 / 60) r = play.step(state.objects, t, true, hooks);
  assert.ok(!r.lit.has(led), 'off after the second');
});

test('a traveler placed by hand drives on past a counter; a terminator ends it', async () => {
  const { createPlay } = await import('../src/play.js');
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [10, 0]], style: { path: 'straight' } });
  call('joint.add', { at: [{ id: line, u: 0.2 }], node: true, glyph: 'counter', code: nodeCodeFor('counter') });
  const end = call('joint.add', { at: [{ id: line, u: 0.8 }], node: true, glyph: 'terminator', code: nodeCodeFor('terminator') });
  const tr = call('traveler.add', { on: line, dur: 10, loop: 0 });
  const play = createPlay(), hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: params, note() {} };
  let r;
  for (let t = 0; t <= 9.5; t += 1 / 60) r = play.step(state.objects, t, true, hooks);
  assert.ok(Math.abs(r.moved.get(tr)[0] - 8) < 0.05, `past the counter, stopped at the terminator: ${r.moved.get(tr)}`);
  assert.ok(end);
});

test('a node slides along its line, and the line stays where it is', () => {
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [8, 0]], style: { path: 'straight' } });
  const n = call('joint.add', { at: [{ id: line, u: 0.2 }], node: true, glyph: 'note' });
  call('joint.slide', { id: n, u: 0.625 });
  assert.equal(state.objects.get(n).at[0].u, 0.625);
  assert.deepEqual(state.objects.get(line).points, [[0, 0], [8, 0]]);
  assert.ok(Math.abs(state.objects.get(n).pos[0] - 5) < 1e-6, 'its position follows');
});
