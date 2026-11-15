import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, toolset, asText, CORE } from '../src/agent.js';
import { state, call, tools } from '../src/space.js';

test('the tools a model is shown: a core by name, and call for the rest', () => {
  const { defs, resolve } = toolset(tools());
  assert.ok(defs.some((d) => d.function.name === 'line_add'));
  assert.ok(defs.length <= CORE.length + 1);
  assert.deepEqual(resolve('line_add', { points: [] }), { name: 'line.add', args: { points: [] } });
  assert.deepEqual(resolve('call', { name: 'target.set', args: { id: 'o1' } }), { name: 'target.set', args: { id: 'o1' } });
  assert.match(asText({ image: 'data:image/png;base64,AAAA', width: 2 }), /not shown/);
  assert.ok(asText('x'.repeat(9000)).length < 6200);
});

test('a turn: the model calls commands until it answers in words; errors go back to it', async () => {
  call('space.clear');
  const script = [
    { tool_calls: [{ id: 'a', name: 'line_add', arguments: '{"points":[[0,0],[2,1]]}' }, { id: 'b', name: 'call', arguments: { name: 'no.such', args: {} } }] },
    { content: 'A line.', tool_calls: [] },
  ];
  script.unshift({ content: 'I drew it.' }); // said, not done: it is told so once, and then does it
  const seen = [], events = [];
  const engine = { name: 'fake', complete: async ({ messages }) => { seen.push(messages.length); return script.shift(); } };
  const r = await runTurn({ text: 'draw a line', engine, by: 'fake', on: (e) => events.push(e), port: { call, tools, held: () => false } });
  assert.equal(r.say, 'A line.');
  assert.equal([...state.objects.values()].filter((o) => o.kind === 'line').length, 1);
  assert.deepEqual(events.filter((e) => e.type === 'result').map((e) => e.ok), [true, false]);
  assert.deepEqual(seen, [2, 4, 7]); // system + user; then the reply and two tool results
  assert.equal(r.messages.at(-1).content, 'A line.');
});

test('held: an agent\'s calls are refused, and it is told why', async () => {
  call('space.clear');
  const script = [{ tool_calls: [{ id: 'a', name: 'line_add', arguments: '{"points":[[0,0],[2,1]]}' }] }, { content: 'ok' }];
  const events = [];
  await runTurn({ text: 'x', engine: { complete: async () => script.shift() }, on: (e) => events.push(e), port: { call, tools, held: () => true } });
  assert.equal(state.objects.size, 0);
  assert.match(events.find((e) => e.type === 'result').text, /stopped by the person/);
});
