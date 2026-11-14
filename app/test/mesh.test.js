import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgesOf, boundary, weld, extrude, faceNormal } from '../src/mesh.js';
import { state, call, undo } from '../src/space.js';

const quad = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];

test('edges, the rim, a normal', () => {
  assert.equal(edgesOf([[0, 1, 2, 3]]).length, 4);
  assert.equal(boundary([[0, 1, 2], [0, 2, 3]]).length, 4, 'the diagonal is shared');
  assert.deepEqual(faceNormal(quad, [0, 1, 2, 3]), [0, 0, 1]);
});

test('weld merges corners that sit together; a face that collapses goes', () => {
  const w = weld([...quad, [1.00001, 1, 0]], [[0, 1, 2, 3], [1, 4, 2]], 1e-3);
  assert.equal(w.verts.length, 4);
  assert.deepEqual(w.faces, [[0, 1, 2, 3]]);
});

test('extruding an edge grows a quad beside the face, wound the same way', () => {
  const r = extrude(quad, [[0, 1, 2, 3]], 1, 2, [1, 0, 0]);
  assert.equal(r.verts.length, 6);
  assert.deepEqual(r.verts.slice(4), [[2, 0, 0], [2, 1, 0]]);
  assert.deepEqual(r.faces[1], [2, 1, 4, 5]);
  assert.deepEqual(faceNormal(r.verts, r.faces[1]), [0, 0, 1], 'the new face faces the same way as the first');
  assert.equal(boundary(r.faces).length, 6);
});

test('meshes are commands: built, changed, moved, undone', () => {
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 6 } });
  const m = call('mesh.add', { space: t, verts: quad });
  call('mesh.set', { id: m, faces: [[0, 1, 2, 3], [0, 1, 9]] });
  assert.deepEqual(state.objects.get(m).faces, [[0, 1, 2, 3]], 'a face with a corner that is not there is dropped');
  call('object.transform', { ids: [m], dz: 2 });
  assert.deepEqual(state.objects.get(m).verts[0], [0, 0, 2]);
  undo();
  assert.deepEqual(state.objects.get(m).verts[0], [0, 0, 0]);
});
