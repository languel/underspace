import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, searchTools, signature, brief, score } from '../src/catalog.js';
import { tools } from '../src/space.js';

const schema = (name) => tools().find((t) => t.name === name).inputSchema;

test('a typed line becomes a command\'s arguments', () => {
  assert.deepEqual(parseArgs('points=[[0,0],[2,1]] closed=true', schema('line.add')), { points: [[0, 0], [2, 1]], closed: true });
  assert.deepEqual(parseArgs('{"ids":["o1"]}', schema('object.remove')), { ids: ['o1'] });
  assert.deepEqual(parseArgs('o1, o2', schema('object.remove')), { ids: ['o1', 'o2'] }); // the one required argument, a list
  assert.deepEqual(parseArgs('id=o3 az=0.5 el=0', schema('target.set')), { id: 'o3', az: 0.5, el: 0 });
  assert.deepEqual(parseArgs('key=theme value=dark', { properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] }), { key: 'theme', value: 'dark' });
  assert.deepEqual(parseArgs('', schema('space.clear')), {});
});

test('commands are found by words in their name or what they do', () => {
  const found = searchTools(tools(), 'render target camera').map((t) => t.name);
  assert.ok(found.includes('target.set'), String(found));
  assert.equal(searchTools(tools(), 'line add')[0].name, 'line.add');
  assert.equal(searchTools(tools(), 'zzzz').length, 0);
  assert.match(signature(tools().find((t) => t.name === 'target.take')), /^target\.take {2}id ids \[out\] \[view\]$/);
});

test('an object in short says what and where it is', () => {
  const b = brief({ id: 'o1', kind: 'line', role: 'ink', space: null, points: [[0, 0], [2, 1]], closed: true }, () => ({ cx: 1, cy: 0.5, w: 2, h: 1 }));
  assert.deepEqual(b, { id: 'o1', kind: 'line', role: 'ink', space: null, box: [0, 0, 2, 1], points: 2, closed: true });
  assert.ok(score('la', 'line.add') > score('la', 'place a label'));
});
