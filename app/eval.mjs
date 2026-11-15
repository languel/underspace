#!/usr/bin/env node
// An evaluation of brains: a set of requests, each with a check of what should be drawn after,
// run through the same loop the Assistant uses (agent.js) against a model server. No browser:
// the drawing's commands run in Node, so it tests what a model does with the tools, not the page.
//
//   node app/eval.mjs --model lfm2.5-thinking:latest [--base http://127.0.0.1:11434] [--only square] [--runs 1] [--verbose]
//
// Prints a line a case (pass or fail, rounds, seconds, the commands it called) and a total.
// Add a case when a model gets something wrong that it should get right.

import { state, call, tools, define, batch, argTypes as T } from './src/space.js';
import { runTurn } from './src/agent.js';
import { searchTools, brief, describe } from './src/catalog.js';
import { endpointEngine, listModels } from './src/engines.js';

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const base = opt('--base', 'http://127.0.0.1:11434'), only = opt('--only'), verbose = argv.includes('--verbose'), runs = Number(opt('--runs', 1));
const model = opt('--model') ?? (await listModels(base))[0];

// the commands the page adds that a model leans on, here without a page
define({ name: 'tools.search', record: false, doc: 'Find commands by what they do: words from a command\'s name or description.', args: { query: T.str }, run: (a) => searchTools(tools(), a.query, 8).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
define({ name: 'space.read', record: false, doc: 'What is drawn: every object in short; with ids, those in full.', args: { ids: T.ids }, run: (a) => (a.ids?.length ? { objects: a.ids.map((id) => state.objects.get(id)).filter(Boolean) } : { objects: [...state.objects.values()].map((o) => brief(o, (x) => x.rect ?? null)), selection: [...state.selection] }) });
define({ name: 'batch.run', record: false, doc: 'Run several commands as one step of undo: calls [{ name, args }].', args: { calls: { type: 'array' } }, required: ['calls'], run: (a, by) => { const out = []; batch(() => { for (const c of a.calls ?? []) out.push(call(c.name, c.args ?? {}, by)); }); return out; } });

const all = () => [...state.objects.values()], lines = () => all().filter((o) => o.kind === 'line' && !o.bind), shapes = (role) => all().filter((o) => o.kind === 'shape' && (!role || o.role === role));
const span = (o, k) => { const v = o.points.map((p) => p[k]); return Math.max(...v) - Math.min(...v); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// { name, setup?(), ask, check() -> true | a string saying what is wrong }
const CASES = [
  { name: 'line', ask: 'draw a straight line from (0, 0) to (4, 2)', check: () => { const l = lines(); return l.length === 1 && l[0].points.length === 2 && near(span(l[0], 0), 4, 0.01) && near(span(l[0], 1), 2, 0.01) || `lines: ${JSON.stringify(l.map((x) => x.points))}`; } },
  { name: 'square', ask: 'draw a square 4 units wide, as one closed straight line', check: () => { const l = lines(); return l.length === 1 && !!l[0].closed && l[0].points.length === 4 && near(span(l[0], 0), 4, 0.01) && near(span(l[0], 1), 4, 0.01) || `lines: ${JSON.stringify(l.map((x) => [x.points, x.closed]))}`; } },
  { name: 'triangle', ask: 'draw a triangle', check: () => { const l = lines(); return l.length === 1 && !!l[0].closed && l[0].points.length === 3 || `lines: ${JSON.stringify(l.map((x) => [x.points.length, x.closed]))}`; } },
  { name: 'only-what-was-asked', ask: 'draw one short line', check: () => all().length === 1 && lines().length === 1 || `${all().length} objects`, },
  { name: 'score', ask: 'make a score frame 10 wide and 4 tall at the origin, with two wavy lines inside it', check: () => { const s = shapes('score')[0]; if (!s) return 'no score'; const inside = lines().filter((l) => l.points.length >= 3 && l.points.every((p) => Math.abs(p[0] - s.rect.cx) <= s.rect.w / 2 + 0.01 && Math.abs(p[1] - s.rect.cy) <= s.rect.h / 2 + 0.01)); return inside.length === 2 || `${inside.length} lines inside the score of ${lines().length}`; } },
  { name: 'target', ask: 'add a 3D frame (a render target) 6 by 4', check: () => shapes('target').length === 1 || `targets: ${shapes('target').length}` },
  { name: 'delete', setup: () => { call('line.add', { points: [[0, 0], [1, 1]] }); call('line.add', { points: [[3, 0], [4, 1]] }); call('shape.add', { role: 'note', rect: { cx: 0, cy: 3, w: 3, h: 1 }, text: 'keep me' }); }, ask: 'delete all the lines, keep everything else', check: () => lines().length === 0 && shapes('note').length === 1 || `lines ${lines().length}, notes ${shapes('note').length}` },
  { name: 'colour', setup: () => { call('line.add', { points: [[0, 0], [2, 1], [4, 0]] }); }, ask: 'make the line red', check: () => /^(#f00|#ff0000|red|#e\w{5}|#d\w{5}|#c\w{5})$/i.test(lines()[0]?.style?.stroke ?? '') || `stroke: ${lines()[0]?.style?.stroke}` },
  { name: 'move', setup: () => { call('shape.add', { role: 'note', rect: { cx: 0, cy: 0, w: 3, h: 1 }, text: 'a' }); }, ask: 'move the note 5 units to the right', check: () => near(shapes('note')[0]?.rect.cx, 5, 0.01) || `cx: ${shapes('note')[0]?.rect.cx}` },
  { name: 'tempo', ask: 'set the tempo to 90 bpm', check: () => state.music.bpm === 90 || `bpm: ${state.music.bpm}` },
  { name: 'answer', setup: () => { for (let i = 0; i < 3; i++) call('line.add', { points: [[i, 0], [i, 1]] }); }, ask: 'how many lines are there? answer with the number', check: (say) => /\b(3|three)\b/i.test(say) && lines().length === 3 || `said: ${say.slice(0, 80)}` },
];

const engine = endpointEngine({ base, model });
let passed = 0, total = 0;
console.log(`model ${model} at ${base}\n`);
for (const c of CASES.filter((x) => !only || x.name === only)) for (let r = 0; r < runs; r++) {
  call('space.clear'); c.setup?.();
  const called = [], t0 = Date.now();
  let say = '', rounds = 0, err = '';
  try {
    const out = await runTurn({ text: c.ask, engine: { ...engine, complete: (x) => { rounds++; return engine.complete(x); } }, by: model, context: describe([...state.objects.values()], state.selection, (x) => x.rect ?? null), port: { call, tools, held: () => false, has: (id) => state.objects.has(id) }, on: (e) => { if (e.type === 'call') called.push(e.name); if (verbose && (e.type === 'call' || e.type === 'result')) console.log('      ', e.type === 'call' ? `> ${e.name} ${JSON.stringify(e.args)}` : `< ${e.text.slice(0, 160)}`); } });
    say = out.say;
  } catch (e) { err = e.message; }
  const verdict = err ? `error: ${err}` : c.check(say), ok = verdict === true;
  total++; if (ok) passed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${c.name.padEnd(20)} ${String(rounds).padStart(2)} rounds ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${called.join(' ') || '(no calls)'}${ok ? '' : `\n      ${verdict}`}`);
}
console.log(`\n${passed} of ${total} passed`);
process.exit(passed === total ? 0 : 1);
