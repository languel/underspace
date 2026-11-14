import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridAt, lengthBy, pathBeats, snapPoint, cellOf, fitScale, DEFAULT_GRID } from '../src/grid.js';
import { state, call } from '../src/space.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const params = (o) => { const p = {}; for (const m of (o.code ?? '').matchAll(/\/\/ param: (\w+) (-?[\d.]+)/g)) p[m[1]] = +m[2]; return { ...p, ...o.params }; };

test('a grid frame is the grid for what is inside it; the smallest wins; else the global grid', () => {
  call('space.clear');
  const big = call('shape.add', { role: 'grid', rect: { cx: 0, cy: 0, w: 20, h: 10 } });
  const small = call('shape.add', { role: 'grid', rect: { cx: 2, cy: 0, w: 4, h: 4 } });
  call('object.set', { id: small, name: 'cell', value: 0.5 });
  assert.equal(gridAt(state.objects, null, [2, 0], state.grid, params).frame, small);
  assert.equal(gridAt(state.objects, null, [-8, 0], state.grid, params).frame, big);
  const g = gridAt(state.objects, null, [50, 0], state.grid, params);
  assert.equal(g.frame, null); assert.equal(g.cell, DEFAULT_GRID.cell);
  assert.deepEqual(gridAt(state.objects, null, [2, 0], state.grid, params).origin, [0, -2]);
});

test('measuring a path: along it, at right angles, across; time in cells, rounded to bars', () => {
  const pts = [[0, 0], [3, 4]];
  close(lengthBy(pts, 0), 5); close(lengthBy(pts, 1), 7); close(lengthBy(pts, 2), 3);
  const g = { ...DEFAULT_GRID, cell: 0.5, beats: 1 };
  close(pathBeats(pts, g), 10);                    // 5 units = 10 cells = 10 beats
  close(pathBeats(pts, { ...g, bars: 4 }), 12);    // to whole bars of 4: 12
  close(pathBeats([[0, 0], [0.1, 0]], { ...g, bars: 4 }), 4); // at least one bar
  assert.equal(pathBeats(pts, { ...g, beats: 0 }), 0);
  close(fitScale(pts, g, 12), 1.2);
});

test('snapping and cells, from the grid\'s origin', () => {
  const g = { ...DEFAULT_GRID, cell: 1, sub: 2, origin: [0.25, 0] };
  assert.deepEqual(snapPoint([1.1, 0.8, 5], g), [1.25, 1, 5]);
  assert.deepEqual(cellOf([1.3, 2.5], { ...g, origin: [0, 0] }), [1, 2]);
});

test('a traveler with dur 0 takes whole bars from its grid; a grid with rows gives pitch by row', async () => {
  const { createPlay } = await import('../src/play.js');
  const { pitch, step } = await import('../src/music.js');
  call('space.clear');
  const fr = call('shape.add', { role: 'grid', rect: { cx: 5, cy: 2, w: 12, h: 6 } });
  call('object.set', { id: fr, name: 'bars', value: 4 });
  call('object.set', { id: fr, name: 'rows', value: 1 });
  // a line 5 cells long: 5 beats, rounded to 4 (one bar)
  const line = call('line.add', { points: [[0, 0], [5, 0]], style: { path: 'straight' } });
  const tr = call('traveler.add', { on: line, dur: 0, loop: 0 });
  const ev = call('shape.add', { role: 'event', rect: { cx: 4.5, cy: 0.4, w: 0.6, h: 2 } });
  call('object.code', { id: ev, code: 'note(pitch(ev.y), 100, 0.1); mem.cell = [ev.col, ev.row];' });
  const notes = [], m = { bpm: 60, meter: [4, 4], scale: 'Ionian', root: 60, low: 60, high: 72 };
  const hooks = { spb: 1, pointsOf: (l) => l.points, paramsOf: params, note: (n) => notes.push(n), gridAt: (space, p) => gridAt(state.objects, space, p, state.grid, params),
    pitch: (v) => pitch(v, m), step: (n, k) => step(n, k, m.scale, m.root) };
  const play = createPlay();
  let r;
  for (let t = 0; t <= 2.0001; t += 0.05) r = play.step(state.objects, t, true, hooks);
  close(r.moved.get(tr)[0], 2.5, 1e-6);   // 5 units in 4 s: half way at 2 s
  for (let t = 2.05; t <= 4; t += 0.05) r = play.step(state.objects, t, true, hooks);
  // reached at x = 4, in the frame's cell (3, 1) from its lower left (-1, -1): row 1 is a degree above the lowest note
  assert.deepEqual(notes, [62]);
});

test('every example builds, and the grid examples play notes', async () => {
  await import('../src/patch.js');
  const { EXAMPLES } = await import('../src/examples.js');
  const { createPlay } = await import('../src/play.js');
  const { pitch, step } = await import('../src/music.js');
  for (const ex of EXAMPLES) {
    call('space.clear');
    ex.build((n, a) => call(n, a, 'example'), [0, 0]);
    assert.ok(state.objects.size > 0, ex.title);
    assert.ok(ex.path, `${ex.title} has a place in the collection`);
    if (!ex.path.startsWith('Music/Grids')) continue;
    const notes = [], m = state.music, play = createPlay();
    const hooks = { spb: 0.5, grid: 1, pointsOf: (l) => l.points, paramsOf: params, note: (n) => notes.push(n), gridAt: (space, p) => gridAt(state.objects, space, p, state.grid, params), pitch: (v) => pitch(v, m), step: (n, k) => step(n, k, m.scale, m.root) };
    for (let t = 0; t <= 6; t += 1 / 60) play.step(state.objects, t, true, hooks);
    assert.ok(notes.length > 0, `${ex.title} plays`);
  }
});
