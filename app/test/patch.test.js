import test from 'node:test';
import assert from 'node:assert/strict';
import { state, call, undo, redo, batch, take, tools } from '../src/space.js';
import { checkPatch, parseLink } from '../src/patch.js';
import { scripted } from '../src/assistant.js';

const fresh = () => { call('space.clear'); take.clips.length = 0; take.undone.length = 0; };
const wires = () => [...state.objects.values()].filter((o) => o.bind);

test('a link names ports, or leaves them to the first one', () => {
  assert.deepEqual(parseLink('a.y -> b.x'), { from: { key: 'a', port: 'y' }, to: { key: 'b', port: 'x' } });
  assert.equal(parseLink('a -> b').to.port, undefined);
});

test('patch.add lays out nodes and connects them in one step', () => {
  fresh();
  const r = call('patch.add', { nodes: [{ key: 'a', preset: 'osc' }, { key: 'b', preset: 'scale' }, { key: 'v', role: 'target' }], links: ['a -> b', 'b.y -> v.spin'] });
  assert.equal(state.objects.size, 5);
  assert.equal(wires().length, 2);
  const a = state.objects.get(r.ids.a), b = state.objects.get(r.ids.b), v = state.objects.get(r.ids.v);
  assert.ok(a.rect.cx < b.rect.cx && b.rect.cx < v.rect.cx, 'left to right');
  assert.equal(take.clips.length, 1, 'one clip');
  undo();
  assert.equal(state.objects.size, 0);
  redo();
  assert.equal(state.objects.size, 5);
});

test('a bad patch is refused with reasons', () => {
  assert.ok(checkPatch({ nodes: [{ key: 'a', preset: 'nope' }], links: ['a -> z'] }).length >= 2);
  fresh();
  assert.throws(() => call('patch.add', { nodes: [] }));
});

test('patch.add can fold the result into a named group', () => {
  fresh();
  const r = call('patch.add', { nodes: [{ key: 'a', preset: 'osc' }, { key: 'b', preset: 'scale' }], links: ['a -> b'], collapse: true, name: 'lfo' });
  assert.equal(state.objects.get(r.group).name, 'lfo');
  assert.equal(state.objects.get(r.ids.a).space, r.group);
});

test('roles: a shape and a line change what they are, in place', () => {
  fresh();
  const s = call('shape.add', { rect: { cx: 0, cy: 0, w: 2, h: 2 } });
  assert.equal(state.objects.get(s).role, 'visual');
  call('object.role', { id: s, role: 'code' });
  assert.ok(state.objects.get(s).code);
  call('object.role', { id: s, role: 'target' });
  assert.equal(state.objects.get(s).role, 'target');
  assert.equal(call('object.role', { id: s, role: 'path' }), false, 'a shape cannot be a path');

  const o = call('shape.add', { rect: { cx: -4, cy: 0, w: 2, h: 2 }, role: 'code', preset: 'osc' });
  const l = call('line.add', { points: [[-2.6, 0.1], [-1.6, 0.4], [-1.3, 0.3]] });
  assert.equal(call('object.role', { id: l, role: 'connector' }), true, 'binds to the ports near its ends');
  assert.equal(state.objects.get(l).bind.to.port, 'spin');
  call('object.role', { id: s, role: 'visual' }); // the port goes, the connector lets go
  assert.equal(state.objects.get(l).role, 'ink');
  call('object.role', { id: l, role: 'path' });
  assert.equal(state.objects.get(l).role, 'path');
  void o;
});

test('a batch is one step for undo', () => {
  fresh();
  batch(() => { call('shape.add', { rect: { cx: 0, cy: 0, w: 1, h: 1 } }); call('shape.add', { rect: { cx: 2, cy: 0, w: 1, h: 1 } }); });
  call('shape.add', { rect: { cx: 4, cy: 0, w: 1, h: 1 } });
  undo(); assert.equal(state.objects.size, 2);
  undo(); assert.equal(state.objects.size, 0);
});

test('every command is described as a tool', () => {
  const t = tools();
  assert.ok(t.find((x) => x.name === 'patch.add').inputSchema.properties.nodes);
  assert.ok(t.every((x) => x.description));
});

test('the scripted assistant turns a chain into a patch', () => {
  const plan = scripted('osc -> scale -> target');
  assert.equal(plan.commands[0].name, 'patch.add');
  assert.equal(plan.commands[0].args.nodes.length, 3);
  assert.equal(plan.commands[0].args.links.length, 2);
  assert.equal(scripted('2 osc, ramp into mix').commands[0].args.nodes.length, 4);
  assert.equal(scripted('please write me a poem'), null);
});

test('a score reads the lines in its frame: across is time, up is pitch', async () => {
  const { read } = await import('../src/score.js');
  const rect = { cx: 0, cy: 0, w: 8, h: 4 };
  const r = read([{ id: 'a', points: [[-4, -2], [0, 0], [4, 2]] }, { id: 'out', points: [[9, 9]] }], rect, { bpm: 120, beats: 8, low: 48, high: 72 });
  assert.equal(r.duration, 4);
  assert.equal(r.voices.length, 1, 'a line outside the frame is not heard');
  assert.deepEqual(r.voices[0].events.map((e) => [e.time, e.midi]), [[0, 48], [2, 60], [4, 72]]);
  const snapped = read([{ id: 'a', points: [[-3.7, -1.9]] }], rect, { bpm: 120, beats: 8, low: 48, high: 72, scale: 2, grid: 1 });
  assert.equal(snapped.voices[0].events[0].time, 0);
  assert.equal(snapped.voices[0].events[0].midi, 48, 'snapped to C major');
});

test('object.copy duplicates objects with the connectors between them', () => {
  fresh();
  const r = call('patch.add', { nodes: [{ key: 'a', preset: 'osc' }, { key: 'b', preset: 'scale' }], links: ['a -> b'] });
  const made = call('object.copy', { ids: [r.ids.a, r.ids.b], dx: 1, dy: -1 });
  assert.equal(made.length, 2);
  assert.equal(wires().length, 2);
  const w = wires()[1];
  assert.deepEqual([w.bind.from.id, w.bind.to.id], made, 'the copy is wired to the copies');
  assert.equal(state.objects.get(made[0]).rect.cx, state.objects.get(r.ids.a).rect.cx + 1);
  undo();
  assert.equal(state.objects.size, 3);
});

test('a role keeps its own code when a shape changes role and back', () => {
  fresh();
  const s = call('shape.add', { rect: { cx: 0, cy: 0, w: 4, h: 2 }, role: 'code', preset: 'osc' });
  call('object.role', { id: s, role: 'score' });
  assert.match(state.objects.get(s).code, /^\/\/ glissando/);
  call('object.role', { id: s, role: 'code' });
  assert.match(state.objects.get(s).code, /^\/\/ osc/);
});
