import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webTools, offer, content } from '../src/webmcp.js';
import { call, tools, state } from '../src/space.js';

test('WebMCP: the commands as tools of the page, run through the guard', async () => {
  call('space.clear');
  const refused = [];
  const list = webTools(tools(), (n, a, by) => call(n, a, by), (args, name) => { if (name === 'object.remove' && args.ids?.includes('o99')) { refused.push(name); throw new Error('no object with id "o99"'); } });
  const add = list.find((t) => t.name === 'line_add');
  assert.ok(add && add.inputSchema.properties.points);
  const r = await add.execute({ points: [[0, 0], [1, 1]] });
  assert.deepEqual(r.content, [{ type: 'text', text: 'o1' }]);
  assert.equal(state.objects.size, 1);
  const bad = await list.find((t) => t.name === 'object_remove').execute({ ids: ['o99'] });
  assert.ok(bad.isError && /o99/.test(bad.content[0].text) && refused.length === 1);
  assert.deepEqual(content({ image: 'data:image/png;base64,AAAA', width: 2 })[0], { type: 'image', data: 'AAAA', mimeType: 'image/png' });

  // provideContext when the browser has it, else registerTool one by one
  const got = [];
  assert.equal(offer({ provideContext: ({ tools: t }) => got.push(t.length) }, list), 'provideContext');
  assert.equal(got[0], list.length);
  const reg = new Map();
  assert.equal(offer({ registerTool: (t) => reg.set(t.name, t), unregisterTool: (n) => reg.delete(n) }, list), 'registerTool');
  assert.equal(reg.size, list.length);
  assert.equal(offer(null, list), '');
});
