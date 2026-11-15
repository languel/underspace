// The agent port: what every brain goes through, in the page or outside it.
//   - commands by which an agent works with the person: user.say, user.ask, user.pick, user.show
//   - batch.run: several commands as one step of undo
//   - presence: a mark while an agent is acting, with its name; a click holds every agent
//     (their calls are refused until it is clicked again)
//   - run(text, engine): the loop of a brain in the page. An engine is anything with
//       complete({ messages, tools, signal }) -> { content, tool_calls: [{ id, name, arguments }] }
//     (engines.js has them: a local endpoint, a model in this browser). The loop gives the model
//     a short core of tools and tools.search for the rest: a small model cannot hold them all.
// A turn of the loop is one step of undo. Everything is open while this is built (HANDOFF).

const OUTSIDE = new Set(['human', 'palette', 'example', 'demo', 'assistant']); // callers that are not agents

// The tools a model is shown from the start (the rest it finds with tools.search and runs with `call`).
export const CORE = ['space.read', 'tools.search', 'line.add', 'shape.add', 'patch.add', 'object.move', 'object.style', 'object.remove', 'object.code', 'select.set', 'music.set', 'play.toggle', 'action.run', 'batch.run', 'user.ask'];
export const SYSTEM = `You work inside underspace, a drawing-first environment: lines, shapes, 3D frames ("targets"), scores (frames whose lines play as sound) and code objects on an infinite canvas. You act only through tools. The person sees everything you do, at once, and can undo it.
How to work:
- What is drawn is listed below under "Now" (ids, kinds, boxes [x0, y0, x1, y1] in canvas units, y up); space_read gives it again, or objects in full by id. Use the ids from there.
- You have a few tools listed. Every other command is found with tools_search {query} and run with call {name, args}. action_run {id} does anything a key or menu does (find ids with call {name: "action.list", args: {query}}).
- Make several changes in one batch_run when you can.
- Do exactly what was asked and nothing more: no extra shapes, no decoration, no moving the view unless asked. Then stop.
- Do the thing; do not describe plans. When something is unclear and it matters, ask with user_ask (give choices). Otherwise choose sensibly.
- Nothing changes unless you call a tool: never say you drew or changed something you did not call a tool for.
- When you are done, reply with one short sentence and no tool call.
Examples of calls:
- a straight line: line_add {"points": [[0, 0], [2, 0]], "style": {"path": "straight"}}
- a closed shape (a triangle): line_add {"points": [[0, 0], [2, 0], [1, 1.7]], "closed": true, "style": {"path": "straight"}}
- a square 4 wide: line_add {"points": [[0, 0], [4, 0], [4, 4], [0, 4]], "closed": true, "style": {"path": "straight"}}
- a curve is a line with several points and no "path" in its style.
- make a line red: object_style {"ids": ["o1"], "style": {"stroke": "#ff0000"}}
- A drawn figure (a triangle, a square, any outline) is line_add with "closed": true. shape_add is for frames that hold code, scores, 3D scenes or notes.`;

// The quick turn (after Artist Model Studio's flow prompt): a sentence typed while drawing, not a
// conversation. A few tools that draw and change, a few lines of prompt, no history, no questions.
// A small model given the whole prompt is slow and loses the thread; given this it mostly acts at once.
export const QUICK = ['line.add', 'shape.add', 'object.style', 'object.move', 'object.transform', 'object.remove', 'music.set', 'play.toggle'];
export const QUICK_SYSTEM = `You change a drawing in underspace, at once, through tools. Never ask a question: when something is unclear, choose the most sensible reading and do it. Undo is one key away.
- What is drawn is listed under "Now" (ids, kinds, boxes [x0, y0, x1, y1] in canvas units, y up). Use the ids from there; "it" and "this" are what is selected.
- Nothing changes unless you call a tool: to make or change anything, call the tools now, all of it in one reply (several calls when it takes several), and nothing more than was asked.
- Only a question about the drawing is answered in words, from "Now", with no tool.
- A drawn figure (a line, a triangle, a square, any outline) is line_add; shape_add is for frames: a score (its lines play as sound), a target (a 3D frame), a note (text), code.
Examples of calls:
- a straight line: line_add {"points": [[0, 0], [2, 0]], "style": {"path": "straight"}}
- a triangle: line_add {"points": [[0, 0], [2, 0], [1, 1.7]], "closed": true, "style": {"path": "straight"}}
- a curve: line_add {"points": [[0, 0], [1, 1], [2, 0], [3, 1]]}
- make a line red: object_style {"ids": ["o1"], "style": {"stroke": "#ff0000"}}
- move it right by 5: object_move {"ids": ["o1"], "dx": 5, "dy": 0}
- twice as big: object_transform {"ids": ["o1"], "sx": 2, "sy": 2}
- a score 10 wide and 4 tall at the origin with a line in it (the line lies inside the frame's box): shape_add {"role": "score", "rect": {"cx": 0, "cy": 0, "w": 10, "h": 4}} and line_add {"points": [[-4, -1], [0, 1], [4, 0]]}`;

// A small model names things by word where an id is wanted ("note", "line", "selected", "all"). In a
// quick turn such a word stands for what it plainly means: -> ids, or null when it is no such word.
// objects: [{ id, kind, role }]; selection: ids.
export function wordIds(word, objects, selection = []) {
  const w = String(word).toLowerCase().replace(/s$/, '');
  if (['selected', 'selection', 'it', 'thi', 'these'].includes(w)) return [...selection];
  if (['all', 'everything'].includes(w)) return objects.map((o) => o.id);
  const hit = objects.filter((o) => o.role === w || o.kind === w || (w === 'frame' && ['score', 'target', 'grid'].includes(o.role)));
  return hit.length ? hit.map((o) => o.id) : null;
}
// The ids in a call's arguments, with words put into ids (only where the command means objects).
function withWords(args, schema, port) {
  if (!port.objects || !args || typeof args !== 'object') return args;
  const objects = port.objects(), has = new Set(objects.map((o) => o.id)), sel = port.selection?.() ?? [];
  const means = (k) => /^object ids?$/.test(schema?.properties?.[k]?.description ?? '');
  const out = { ...args };
  if (means('ids') && (Array.isArray(out.ids) || typeof out.ids === 'string')) out.ids = [...new Set([out.ids].flat().flatMap((id) => (has.has(id) ? [id] : wordIds(id, objects, sel) ?? [id])))];
  if (means('id') && typeof out.id === 'string' && !has.has(out.id)) { const ids = wordIds(out.id, objects, sel); if (ids?.length === 1) out.id = ids[0]; }
  return out;
}

// A command given an id that names nothing does nothing and says nothing, which reads as success.
// For an agent that is the worst answer, so its calls are checked first: -> a message, or ''.
// schema: the command's own (its inputSchema). Some commands take an `id` that is not an object's
// (an action's, a panel's, a brush's): only what the schema calls an object id is checked.
export function missingIds(args, has, schema) {
  const names = (k) => !schema || /^object ids?$/.test(schema.properties?.[k]?.description ?? '') || (k === 'on' && !!schema.properties?.on);
  const ids = [...(Array.isArray(args?.ids) && names('ids') ? args.ids : []), ...['id', 'on'].filter(names).map((k) => args?.[k]).filter((v) => typeof v === 'string')];
  const bad = ids.filter((id) => typeof id !== 'string' || !has(id));
  return bad.length ? `no object with id ${bad.map((x) => JSON.stringify(x)).join(', ')}. Ids look like "o3"; they are listed under "Now" and by space_read.` : '';
}

const mcp = (n) => n.replaceAll('.', '_');
const schemaOf = (tools, name) => tools.find((t) => t.name === name || mcp(t.name) === name)?.inputSchema;
// The tools for a model, in the OpenAI shape, and the way back from its names to ours.
// defers: for a model whose chat template knows deferred tools (LFM3): every other command is given
// too, marked defer_loading, so it stays out of the prompt until tools_search names it; then the
// model calls it by its own name, and `call` is not needed.
export function toolset(all, core = CORE, defers = false, rest = true) {
  const fn = (t, extra = {}) => ({ type: 'function', ...extra, function: { name: mcp(t.name), description: (t.description ?? '').slice(0, 500), parameters: t.inputSchema ?? { type: 'object', properties: {} } } });
  const pick = core.map((n) => all.find((t) => t.name === n)).filter(Boolean);
  const defs = pick.map((t) => fn(t));
  if (defers) for (const t of all) { if (!core.includes(t.name)) defs.push(fn(t, { defer_loading: true })); }
  else if (rest) defs.push({ type: 'function', function: { name: 'call', description: 'Run any command by its name (from tools_search), with its arguments.', parameters: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] } } });
  const names = new Map(all.map((t) => [mcp(t.name), t.name]));
  return { defs, resolve: (n, a) => (n === 'call' ? { name: a?.name, args: a?.args ?? {} } : { name: names.get(n) ?? n, args: a ?? {} }) };
}
// What a command returned, as text a model can read (a picture is named, not sent: text models cannot see it).
export function asText(r, max = 6000) {
  if (r === undefined || r === null) return 'done';
  if (typeof r?.image === 'string') return JSON.stringify({ ...r, image: '(a picture; not shown to you)' });
  const s = typeof r === 'string' ? r : JSON.stringify(r);
  return s.length > max ? s.slice(0, max) + ` … (${s.length - max} more characters; narrow what you ask for)` : s;
}
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}'); } catch { return {}; } };

// One turn: the person's words in, tool calls until the model answers in words.
// port: { call(name, args, by) (may be async), tools(), held() }; on(event): what happens, for the panel
//   { type: 'call', name, args } | { type: 'result', name, text, ok } | { type: 'stream', text (so far) } | { type: 'say', text } | { type: 'error', text }
// Is it a question? (In a quick turn a question answered in words is an answer, not a model that forgot to act.)
export const asks = (text) => /\?\s*$|\?\s|^\s*(how|what|which|where|who|why|is|are|does|do|can)\b/i.test(String(text));
// quick: the short prompt and the few tools of QUICK, no history, at most six rounds.
export async function runTurn({ text, history = [], engine, port, by = 'assistant', context = '', signal, on = () => {}, rounds = 16, quick = false }) {
  if (quick) { history = []; rounds = Math.min(rounds, 6); }
  const { defs, resolve } = quick ? toolset(port.tools(), QUICK, false, false) : toolset(port.tools(), engine.sees ? [...CORE, 'view.look'] : CORE, !!engine.defers);
  const system = quick ? QUICK_SYSTEM : engine.defers ? SYSTEM.replace('Every other command is found with tools_search {query} and run with call {name, args}.', 'Every other command is found with tools_search {query}; the tools it finds can then be called by their own names.').replace('call {name: "action.list", args: {query}}', 'tools_search') : SYSTEM;
  const messages = [{ role: 'system', content: system + (context ? '\n\nNow:\n' + context : '') }, ...history, { role: 'user', content: text }];
  let used = false, nudged = false;
  const pictures = [];
  const seen = new Map();
  for (let round = 0; round < rounds; round++) {
    if (signal?.aborted) throw new Error('stopped');
    const reply = await engine.complete({ messages, tools: defs, signal, onText: (t) => on({ type: 'stream', text: t }) });
    const calls = reply.tool_calls ?? [];
    messages.push({ role: 'assistant', content: reply.content ?? '', ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) } })) } : {}) });
    if (!calls.length) {
      const say = (reply.content ?? '').trim();
      // A small model will say it has done a thing without doing it. Once a turn, when it has used no tool, it is told so.
      if (!used && !nudged && round < rounds - 1 && !(quick && asks(text))) { nudged = true; messages.push({ role: 'user', content: 'You have not called any tool, so nothing has changed. If something was to be made or changed, call the tools now. If only an answer was wanted, give it again.' }); continue; }
      on({ type: 'say', text: say }); return { say, messages: messages.slice(1) };
    }
    used = true;
    if (reply.content?.trim()) on({ type: 'say', text: reply.content.trim() });
    let wrong = 0;
    for (const c of calls) {
      let { name, args } = resolve(c.name, parse(c.arguments));
      if (quick) args = withWords(args, schemaOf(port.tools(), name), port);
      on({ type: 'call', name, args });
      let out, ok = true;
      // a small model will make the right call and then make it again: an exact repeat is not run. The
      // second time it is told the thing is done, the third the turn ends.
      const key = name + JSON.stringify(args), times = (seen.get(key) ?? 0) + 1; seen.set(key, times);
      if (times === 2) { out = 'Not run: you already made this exact call in this turn and it worked. Do not repeat it. If the task is done, answer in one short sentence with no tool call.'; on({ type: 'result', name, text: out, ok: false }); messages.push({ role: 'tool', tool_call_id: c.id, content: out }); continue; }
      if (times > 2) { on({ type: 'say', text: '…' }); return { say: '', messages: messages.slice(1) }; }
      let picture = null, raw;
      try {
        if (signal?.aborted || port.held()) throw new Error('stopped by the person');
        const miss = port.has ? missingIds(args, port.has, schemaOf(port.tools(), name)) : ''; if (miss) throw new Error(miss);
        const r = await port.call(name, args, by); raw = r;
        if (engine.sees && typeof r?.image === 'string') { picture = r.image; out = JSON.stringify({ ...r, image: '(the picture follows)' }); } else out = 'OK. Result: ' + asText(r);
      } catch (e) { ok = false; out = 'Error: ' + (e?.message ?? e); }
      on({ type: 'result', name, text: out, ok });
      if (!ok) wrong++;
      // a model with deferred tools is handed what a search found as references: its template then shows it those tools
      const found = engine.defers && ok && name === 'tools.search' && Array.isArray(raw) ? raw.map((t) => mcp(t.name)) : null;
      messages.push({ role: 'tool', tool_call_id: c.id, content: found ? [{ type: 'text', text: `Found ${found.length} tools: ${found.join(', ')}.` }, ...found.map((n) => ({ type: 'tool_reference', name: n }))] : out });
      if (picture) pictures.push(picture);
    }
    // a quick turn is over when what it called worked: the model is not asked again (half the wait, and a
    // small model asked again does the thing again). Only a call that failed goes back to it, to be put right.
    if (quick && !wrong) return { say: (reply.content ?? '').trim(), messages: messages.slice(1) };
    // a model that can see is shown the pictures its calls returned (a tool result cannot carry one, so they come as the person's)
    if (pictures.length) { messages.push({ role: 'user', content: [{ type: 'text', text: 'The picture you asked for:' }, ...pictures.map((url) => ({ type: 'image_url', image_url: { url } }))] }); pictures.length = 0;
    }
  }
  on({ type: 'say', text: '…' });
  return { say: '', messages: messages.slice(1) };
}

// ---- the page -----------------------------------------------------------------

// host: { define, T, call, batch, beginStep, endStep, tools, state, get, view, stage, frameIds, toCanvas(px, py), onCall(fn), icon(name) }
export function install(h) {
  const { define, T } = h, ui = { record: false };
  let held = false, active = null, idle = 0;
  const doc = h.stage.ownerDocument;
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // presence: the mark, lit while an agent's calls arrive, held when the person stops them
  const mark = el('button', 'agentmark'); mark.hidden = true; mark.innerHTML = h.icon('ask');
  const card = el('div', 'agentcard'); card.hidden = true;
  h.stage.append(mark, card);
  const show = () => { mark.hidden = !active && !held; mark.dataset.state = held ? 'held' : 'on'; mark.title = held ? 'Agents are held. Click to let them go on' : `${active} is working. Click to stop`; };
  mark.addEventListener('pointerdown', (e) => e.stopPropagation());
  mark.addEventListener('click', () => { held = !held; if (held) settle(null); show(); listeners.forEach((fn) => fn({ type: 'held', held })); });
  h.onCall((name, by) => {
    if (OUTSIDE.has(by)) return;
    active = by; show();
    clearTimeout(idle); idle = setTimeout(() => { active = null; show(); }, 2500);
  });
  const listeners = new Set();

  // the card: what an agent says, or asks; one at a time
  let waiting = null; // { resolve } of the question that is up
  const settle = (v) => { if (waiting) { const w = waiting; waiting = null; card.hidden = true; w.resolve(v); } };
  let sayTimer = 0;
  function say(text) { if (waiting) return; clearTimeout(sayTimer); card.replaceChildren(el('p', '', String(text).slice(0, 400))); card.hidden = false; sayTimer = setTimeout(() => { if (!waiting) card.hidden = true; }, Math.min(12000, 2500 + String(text).length * 50)); }
  function ask(question, choices, free) {
    settle(null); clearTimeout(sayTimer);
    return new Promise((resolve) => {
      waiting = { resolve };
      const row = el('div', 'choices');
      for (const c of choices) { const b = el('button', '', c); b.type = 'button'; b.onclick = () => settle(c); row.append(b); }
      const parts = [el('p', '', question), row];
      if (free || !choices.length) {
        const input = el('input'); input.type = 'text'; input.spellcheck = false;
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && input.value.trim()) settle(input.value.trim()); if (e.key === 'Escape') settle(null); });
        parts.push(input); setTimeout(() => input.focus(), 0);
      }
      const no = el('button', 'close', '×'); no.type = 'button'; no.title = 'Dismiss'; no.onclick = () => settle(null);
      card.replaceChildren(no, ...parts); card.hidden = false;
    });
  }
  card.addEventListener('pointerdown', (e) => e.stopPropagation());

  define({ ...ui, name: 'user.say', doc: 'Tell the person something in a short line on the canvas (it fades). For what you did or noticed, not for questions.', args: { text: T.str }, required: ['text'], run: (a) => { say(a.text); listeners.forEach((fn) => fn({ type: 'say', text: a.text })); } });
  define({ ...ui, name: 'user.ask', doc: 'Ask the person a question on the canvas and wait for the answer. choices: the answers to offer as buttons (keep them short); free: true also lets them type one. Returns the answer, or null when they dismiss it.', args: { question: T.str, choices: { type: 'array', items: { type: 'string' } }, free: { type: 'boolean' } }, required: ['question'], run: (a) => ask(a.question, (a.choices ?? []).map(String).slice(0, 8), !!a.free) });
  define({ ...ui, name: 'user.pick', doc: 'Ask the person to show you something and wait: what "objects" (they select one or more; returns their ids) or "point" (they click a place; returns [x, y] in canvas units). prompt: a few words saying what for. Null when dismissed.', args: { what: { enum: ['objects', 'point'] }, prompt: T.str }, required: ['what'],
    run(a) {
      settle(null);
      return new Promise((resolve) => {
        const before = [...h.state.selection].join(), stop = [];
        const done = (v) => { stop.forEach((fn) => fn()); settle(null); resolve(v); };
        waiting = { resolve: () => { stop.forEach((fn) => fn()); resolve(null); } };
        const no = el('button', 'close', '×'); no.type = 'button'; no.onclick = () => settle(null);
        card.replaceChildren(no, el('p', '', a.prompt || (a.what === 'point' ? '⌖' : '▢'))); card.hidden = false;
        if (a.what === 'point') {
          const click = (e) => { if (card.contains(e.target) || mark.contains(e.target)) return; e.stopPropagation(); e.preventDefault(); waiting = null; card.hidden = true; done(h.toCanvas(e.clientX, e.clientY)); };
          h.stage.addEventListener('pointerdown', click, true); stop.push(() => h.stage.removeEventListener('pointerdown', click, true));
        } else {
          let t = 0;
          const off = h.onChange(() => { clearTimeout(t); t = setTimeout(() => { const now = [...h.state.selection]; if (now.length && now.join() !== before) { waiting = null; card.hidden = true; done(now); } }, 700); });
          stop.push(off, () => clearTimeout(t));
        }
      });
    } });
  define({ ...ui, name: 'user.show', doc: 'Show the person these objects: the view moves to them and they are selected. text: a short line to go with it.', args: { ids: T.ids, text: T.str }, required: ['ids'], run(a) { const ids = a.ids.filter((id) => h.get(id)); if (!ids.length) return false; h.call('select.set', { ids }); h.frameIds(ids, 0.6); if (a.text) say(a.text); return true; } });
  define({ ...ui, name: 'batch.run', doc: 'Run several commands as one step of undo, in order: calls [{ name, args }]. Returns what each returned; stops at the first that fails and says which.', args: { calls: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] } } }, required: ['calls'],
    run(a, by) {
      const out = [];
      h.batch(() => { for (const [i, c] of (a.calls ?? []).entries()) { try { out.push(h.call(c.name, c.args ?? {}, by)); } catch (e) { throw new Error(`call ${i} (${c.name}): ${e.message}`); } } });
      return out;
    } });

  // ---- a turn of a brain in the page -------------------------------------------
  let running = null, history = [];
  const emit = (e) => listeners.forEach((fn) => fn(e));
  async function run(text, engine, { context = '', quick = false } = {}) {
    if (running) throw new Error('the assistant is busy');
    const ac = new AbortController();
    running = ac; held = false; show(); emit({ type: 'begin', text });
    h.beginStep();
    try {
      const r = await runTurn({ text, history, engine, quick, by: engine.name ?? 'assistant', context, signal: ac.signal, on: emit, port: { call: h.call, tools: h.tools, held: () => held, has: (id) => !!h.get(id), objects: () => [...h.state.objects.values()], selection: () => [...h.state.selection] } });
      if (!quick) history = r.messages.slice(-24); // what was said and done, for the next turn (a quick turn leaves none)
      return r.say;
    } catch (e) { emit({ type: 'error', text: e?.message ?? String(e) }); throw e; }
    finally { h.endStep(); running = null; emit({ type: 'end' }); }
  }
  return {
    run, say, emit,
    // an agent's call from outside the page (the relay, WebMCP): refused while held, and checked for ids that name nothing
    guard(args, name) { if (held) throw new Error('stopped by the person: agents are held until they let them go on'); const miss = missingIds(args, (id) => !!h.get(id), name ? schemaOf(h.tools(), name) : undefined); if (miss) throw new Error(miss); },
    stop() { running?.abort(); settle(null); },
    forget() { history = []; },
    busy: () => !!running, held: () => held,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
