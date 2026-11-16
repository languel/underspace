#!/usr/bin/env node
// An evaluation of brains: a set of requests, each with a check of what should be drawn after,
// run through the same loop the Assistant uses (agent.js) against a model server. No browser:
// the drawing's commands run in Node, so it tests what a model does with the tools, not the page.
//
//   node app/eval.mjs [--model lfm3:latest] [--base http://127.0.0.1:11434] [--only square] [--runs 1] [--quick] [--verbose]
//
// Prints a line a case (pass or fail, rounds, seconds, the commands it called) and a total.
// Add a case when a model gets something wrong that it should get right.

import { state, call, tools, define, batch, argTypes as T } from './src/space.js';
import { runTurn } from './src/agent.js';
import { searchTools, brief, describe } from './src/catalog.js';
import { endpointEngine, listModels } from './src/engines.js';
import { cases } from './src/evalcases.js';

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const base = opt('--base', 'http://127.0.0.1:11434'), only = opt('--only'), verbose = argv.includes('--verbose'), runs = Number(opt('--runs', 1)), quick = argv.includes('--quick'); // --quick: the short prompt and few tools of a quick turn
// the baseline is lfm3 when the server has it (the owner, 16 Nov 2026), else the first model listed
const model = opt('--model') ?? (await listModels(base).then((l) => l.find((m) => /^lfm3/i.test(m)) ?? l[0]));

// the commands the page adds that a model leans on, here without a page
define({ name: 'tools.search', record: false, doc: 'Find commands by what they do: words from a command\'s name or description.', args: { query: T.str }, run: (a) => searchTools(tools(), a.query, 8).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
define({ name: 'space.read', record: false, doc: 'What is drawn: every object in short; with ids, those in full.', args: { ids: T.ids }, run: (a) => (a.ids?.length ? { objects: a.ids.map((id) => state.objects.get(id)).filter(Boolean) } : { objects: [...state.objects.values()].map((o) => brief(o, (x) => x.rect ?? null)), selection: [...state.selection] }) });
define({ name: 'batch.run', record: false, doc: 'Run several commands as one step of undo: calls [{ name, args }].', args: { calls: { type: 'array' } }, required: ['calls'], run: (a, by) => { const out = []; batch(() => { for (const c of a.calls ?? []) out.push(call(c.name, c.args ?? {}, by)); }); return out; } });

const CASES = cases({ state, call });

const engine = endpointEngine({ base, model });
let passed = 0, total = 0;
console.log(`model ${model} at ${base}${quick ? ' (quick turns)' : ''}\n`);
for (const c of CASES.filter((x) => !only || x.name === only)) for (let r = 0; r < runs; r++) {
  call('space.clear'); c.setup?.();
  const called = [], t0 = Date.now();
  let say = '', rounds = 0, err = '';
  try {
    const out = await runTurn({ text: c.ask, quick, engine: { ...engine, complete: (x) => { rounds++; return engine.complete(x); } }, by: model, context: describe([...state.objects.values()], state.selection, (x) => x.rect ?? null), port: { call, tools, held: () => false, has: (id) => state.objects.has(id), objects: () => [...state.objects.values()], selection: () => [...state.selection] }, on: (e) => { if (e.type === 'call') called.push(e.name); if (verbose && (e.type === 'call' || e.type === 'result')) console.log('      ', e.type === 'call' ? `> ${e.name} ${JSON.stringify(e.args)}` : `< ${e.text.slice(0, 160)}`); } });
    say = out.say;
  } catch (e) { err = e.message; }
  const verdict = err ? `error: ${err}` : c.check(say), ok = verdict === true;
  total++; if (ok) passed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${c.name.padEnd(20)} ${String(rounds).padStart(2)} rounds ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${called.join(' ') || '(no calls)'}${ok ? '' : `\n      ${verdict}`}`);
}
console.log(`\n${passed} of ${total} passed`);
process.exit(passed === total ? 0 : 1);
