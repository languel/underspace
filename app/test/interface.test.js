import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, call, undo } from '../src/space.js';
import { publishedOf, paramsOf } from '../src/publish.js';
import { faceOf, levelsOf, FAR } from '../src/levels.js';

const box = (cx, name, code) => { const id = call('shape.add', { role: 'code', rect: { cx, cy: 0, w: 2, h: 1 } }); call('object.code', { id, code }); if (name) call('object.name', { id, name }); return id; };

test('publish: a parameter shows one level up, and again from there, and is one value', () => {
  call('space.clear');
  const f = box(0, 'filter', '// filter\n// param: cutoff 800\n// param: q 1\nreturn {};');
  const g = box(4, 'other', '// other\n// param: cutoff 200\nreturn {};');
  assert.throws(() => call('object.publish', { id: f, name: 'nope' }), /no parameter "nope".*cutoff, q/);
  assert.deepEqual(call('object.publish', { id: f, name: 'cutoff' }), { publish: ['cutoff'], can: ['cutoff', 'q'] });
  call('object.publish', { id: g }); // all of them
  const voice = call('group.collapse', { ids: [f, g], name: 'voice' });
  const pub = publishedOf(state.objects, voice);
  assert.deepEqual(pub.map((p) => [p.name, p.value, p.id, p.param]), [['cutoff', 800, f, 'cutoff'], ['other.cutoff', 200, g, 'cutoff']]);
  // a group has nothing of its own: what it can publish is what is published to it
  assert.deepEqual(paramsOf(state.objects, state.objects.get(voice)).map((p) => p.name), ['cutoff', 'other.cutoff']);
  call('object.publish', { id: voice, name: 'cutoff' });
  const inst = call('group.collapse', { ids: [voice], name: 'instrument' });
  const top = publishedOf(state.objects, inst);
  assert.deepEqual(top.map((p) => [p.name, p.id, p.param]), [['cutoff', f, 'cutoff']]);
  // set from the top: object.set on the owner, seen at every level
  call('object.set', { id: top[0].id, name: top[0].param, value: 1200 });
  assert.equal(publishedOf(state.objects, inst)[0].value, 1200);
  assert.equal(publishedOf(state.objects, voice)[0].value, 1200);
  // taken off inside, it is gone from every level above
  call('object.publish', { id: f, name: 'cutoff', on: false });
  assert.equal(state.objects.get(f).publish, undefined);
  assert.deepEqual(publishedOf(state.objects, inst), []);
  undo();
  assert.equal(publishedOf(state.objects, inst).length, 1);
  assert.throws(() => call('object.publish', { id: inst, name: 'q' }), /no parameter "q"/);
});

test('publish: an out part publishes its channel and gain when it is made', () => {
  call('space.clear');
  const out = call('shape.add', { rect: { cx: 0, cy: 0, w: 2, h: 1 } });
  call('synth.make', { id: out, kind: 'out' });
  assert.deepEqual(state.objects.get(out).publish, ['channel', 'gain']);
  const g = call('group.collapse', { ids: [out], name: 'instrument' });
  assert.deepEqual(publishedOf(state.objects, g).map((p) => p.name), ['channel', 'gain']);
});

test('levels: glyph, interface or inside by size, each object on its own', () => {
  call('space.clear');
  const size = { w: 1000, h: 800 }, o = state.objects.get(call('shape.add', { role: 'code', rect: { cx: 0, cy: 0, w: 2, h: 1 } }));
  assert.equal(faceOf(o, { w: FAR - 1, h: 10 }, size), 'far');
  assert.equal(faceOf(o, { w: 200, h: 100 }, size), 'mid');
  assert.equal(faceOf(o, { w: 421, h: 100 }, size), 'near');
  assert.equal(Math.round(levelsOf(o, { w: 200, h: 100 }, size).near), 420);
  assert.equal(call('object.levels', { ids: [o.id], far: 150, near: 600 }), 1);
  assert.equal(faceOf(o, { w: 140, h: 70 }, size), 'far');
  assert.equal(faceOf(o, { w: 500, h: 250 }, size), 'mid'); // shut where others have opened
  assert.equal(faceOf(o, { w: 600, h: 300 }, size), 'near');
  call('object.levels', { ids: [o.id], far: 0, near: 100000 }); // always its interface
  assert.equal(faceOf(o, { w: 3, h: 2 }, size), 'mid');
  assert.equal(faceOf(o, { w: 5000, h: 4000 }, size), 'mid');
  call('object.levels', { ids: [o.id], near: 0 }); // its inside at any size
  assert.equal(faceOf(o, { w: 3, h: 2 }, size), 'near');
  call('object.levels', { ids: [o.id], far: 80, near: 20 }); // near is never under far
  assert.deepEqual(o.levels, { far: 80, near: 80 });
  assert.throws(() => call('object.levels', { ids: [o.id], far: -1 }), /0 or more/);
  call('object.levels', { ids: [o.id], far: null, near: null });
  assert.equal(o.levels, undefined);
  undo();
  assert.deepEqual(state.objects.get(o.id).levels, { far: 80, near: 80 });
});
