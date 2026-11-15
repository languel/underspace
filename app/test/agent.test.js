import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, toolset, asText, CORE } from '../src/agent.js';
import { state, call, tools } from '../src/space.js';
import { parseToolCalls } from '../src/engines.js';

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

test('what a model in the page wrote is read as words and tool calls', () => {
  const a = parseToolCalls('I will draw it.\n<tool_call>\n<function=line_add>\n<parameter=points>\n[[0, 0], [2, 1]]\n</parameter>\n<parameter=closed>\ntrue\n</parameter>\n</function>\n</tool_call><|im_end|>');
  assert.equal(a.content, 'I will draw it.');
  assert.deepEqual(a.tool_calls, [{ id: 'call0', name: 'line_add', arguments: { points: [[0, 0], [2, 1]], closed: true } }]);
  const b = parseToolCalls('<think>hm</think><tool_call>{"name": "space_read", "arguments": {}}</tool_call>');
  assert.deepEqual(b.tool_calls, [{ id: 'call0', name: 'space_read', arguments: {} }]);
  assert.deepEqual(parseToolCalls('Done.<|im_end|>'), { content: 'Done.', tool_calls: [] });
});

test('a model that repeats a call is told once, then the turn ends', async () => {
  call('space.clear');
  const again = { tool_calls: [{ id: 'a', name: 'tools_search', arguments: { query: 'line' } }] };
  const events = [];
  const r = await runTurn({ text: 'x', engine: { complete: async () => structuredClone(again) }, on: (e) => events.push(e), port: { call, tools: () => [...tools(), { name: 'tools.search', description: '', inputSchema: { type: 'object', properties: {} } }], held: () => false } }).catch((e) => ({ err: e.message }));
  assert.equal(r.say, '');
  assert.equal(events.filter((e) => e.type === 'call').length, 3);
  assert.equal(events.filter((e) => e.type === 'result' && e.ok).length + events.filter((e) => e.type === 'result' && /^Error/.test(e.text)).length, 1); // run once only
  assert.match(events.filter((e) => e.type === 'result')[1].text, /already made this exact call/);
});

test('an id that names nothing is refused, but only where the command means an object', async () => {
  const { missingIds } = await import('../src/agent.js');
  const { tools } = await import('../src/space.js');
  const schema = (n) => tools().find((t) => t.name === n).inputSchema, has = (id) => id === 'o1';
  assert.match(missingIds({ id: 'o9', code: '' }, has, schema('object.code')), /no object with id "o9"/);
  assert.equal(missingIds({ id: 'o1', code: '' }, has, schema('object.code')), '');
  assert.match(missingIds({ on: 'o9' }, has, schema('traveler.add')), /"o9"/);
  assert.match(missingIds({ ids: ['o1', 'o7'] }, has, schema('object.remove')), /"o7"/);
  // an action's, a panel's or a brush's id is not an object's
  assert.equal(missingIds({ id: 'undo' }, has, { properties: { id: { type: 'string' } } }), '');
  assert.equal(missingIds({ id: 'mine', code: '' }, has, schema('brush.define')), '');
  assert.match(missingIds({ id: 'o9' }, has), /"o9"/); // no schema known: checked as before
});

test('a quick turn: few tools, a short prompt, over when its calls worked, words for ids', async () => {
  const { QUICK, wordIds, asks } = await import('../src/agent.js');
  call('space.clear');
  const note = call('shape.add', { role: 'note', rect: { cx: 0, cy: 0, w: 3, h: 1 }, text: 'a' }), line = call('line.add', { points: [[0, 0], [1, 1]] });
  const objects = () => [...state.objects.values()];
  assert.deepEqual(wordIds('note', objects()), [note]);
  assert.deepEqual(wordIds('lines', objects()), [line]);
  assert.deepEqual(wordIds('all', objects()), [note, line]);
  assert.deepEqual(wordIds('selected', objects(), [line]), [line]);
  assert.equal(wordIds('o77', objects()), null);
  assert.ok(asks('how many lines are there? answer with the number') && asks('is it red?') && !asks('draw one short line') && !asks('can you make it red?'));

  const got = [], rounds = [];
  const engine = { name: 'fake', complete: async ({ messages, tools: defs }) => { got.push({ system: messages[0].content, tools: defs?.map((d) => d.function.name), n: messages.length }); return rounds.shift(); } };
  const port = { call, tools, held: () => false, has: (id) => state.objects.has(id), objects, selection: () => [...state.selection] };
  // the model names the note by word; the call works, so it is not asked again
  rounds.push({ content: '', tool_calls: [{ id: 'a', name: 'object_move', arguments: { ids: ['note'], dx: 5, dy: 0 } }] });
  await runTurn({ text: 'move the note 5 to the right', quick: true, history: [{ role: 'user', content: 'earlier' }], engine, port });
  assert.equal(state.objects.get(note).rect.cx, 5);
  assert.equal(got.length, 1);
  assert.equal(got[0].n, 2); // the prompt and the request: no history
  assert.deepEqual(got[0].tools, QUICK.filter((n) => tools().some((t) => t.name === n)).map((n) => n.replace('.', '_')).concat('more_tools')); // play.toggle is the page's
  assert.ok(got[0].system.length < 2600, String(got[0].system.length));
  // a call that fails goes back to the model to be put right
  rounds.push({ content: '', tool_calls: [{ id: 'b', name: 'object_remove', arguments: { ids: ['o99'] } }] }, { content: '', tool_calls: [{ id: 'c', name: 'object_remove', arguments: { ids: [line] } }] });
  await runTurn({ text: 'delete the line', quick: true, engine, port });
  assert.equal(got.length, 3);
  assert.ok(!state.objects.has(line));
  // a question answered in words is an answer: no "you have not called a tool"
  rounds.push({ content: '1', tool_calls: [] });
  const r = await runTurn({ text: 'how many objects are there?', quick: true, engine, port });
  assert.equal(r.say, '1');
  assert.equal(got.length, 4);
  assert.equal(got[3].tools, undefined); // and it is given no tools to misuse
});

test('a quick turn hands a request it cannot do over to the whole loop', async () => {
  call('space.clear');
  const line = call('line.add', { points: [[0, 0], [4, 0]] });
  const got = [], events = [];
  const rounds = [
    { content: '', tool_calls: [{ id: 'a', name: 'more_tools', arguments: {} }] },
    { content: '', tool_calls: [{ id: 'b', name: 'call', arguments: { name: 'traveler.add', args: { on: line } } }] },
    { content: 'A traveler is on the line.', tool_calls: [] },
  ];
  const engine = { name: 'fake', complete: async ({ tools: defs }) => { got.push(defs.map((d) => d.function.name)); return rounds.shift(); } };
  const r = await runTurn({ text: 'put a traveler on the line', quick: true, engine, on: (e) => events.push(e.type), port: { call, tools, held: () => false, has: (id) => state.objects.has(id) } });
  assert.ok(got[0].includes('more_tools') && !got[0].includes('call'));
  assert.ok(got[1].includes('call') && got[1].includes('object_code') && !got[1].includes('more_tools'));
  assert.ok(events.includes('handover'));
  assert.equal([...state.objects.values()].filter((o) => o.role === 'traveler' && o.on === line).length, 1);
  assert.equal(r.say, 'A traveler is on the line.');
});
