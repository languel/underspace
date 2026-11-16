// The catalog: everything the system can do, as commands. space.js has the commands that change
// the drawing; this file adds the rest of the system to the same registry, so a person at the
// palette and an agent outside the page reach the same things by the same names:
//   action.list, action.run     every key, menu and toolbar action, by id
//   setting.get, setting.set    what belongs to this browser (settings.js)
//   panel.show, panel.close     the side panel
//   space.read                  what is drawn, in short or (ids) in full
//   view.get, view.set, view.frame, view.look   where the view is, and a picture of it
//   example.list, example.add
//   tools.search                the commands themselves, found by what they do
// None of these is part of the take (record: false): they look, or they change the browser.
// The top of the file is pure (the palette's line of arguments, the short form of an object,
// the search); install(host) needs the page.

// ---- pure ---------------------------------------------------------------------

import { codeHelp, CODE_ROLES } from './codedoc.js';

// Letters of the query in order; earlier and tighter matches score higher. -1: no match.
export function score(query, text) {
  let i = 0, s = 0, last = -1;
  for (const ch of query) {
    const at = text.indexOf(ch, i);
    if (at < 0) return -1;
    s += at === last + 1 ? 3 : 1; if (at === 0 || ' .-_'.includes(text[at - 1])) s += 2;
    last = at; i = at + 1;
  }
  return s - text.length * 0.01;
}

// Commands found by words: those with the most of the words in their name or doc come first
// (the name counts more); a command with none of them is left out.
export function searchTools(tools, query, limit = 8) {
  const words = String(query ?? '').toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  if (!words.length) return tools.slice(0, limit);
  return tools.map((t) => {
    const name = t.name.toLowerCase(), doc = (t.description ?? '').toLowerCase();
    let s = 0, hits = 0;
    for (const w of words) { if (name.includes(w)) { s += 3; hits++; } else if (doc.includes(w)) { s += 1; hits++; } }
    return hits ? { t, s: s + hits * 4 - name.length * 0.001 } : null;
  }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, limit).map((r) => r.t);
}

const loose = (v) => { try { return JSON.parse(v); } catch { return v; } };
const typed = (v, type) => {
  const t = Array.isArray(type?.type) ? type.type[0] : type?.type;
  if (typeof v !== 'string') return v;
  if (t === 'string') return v;
  if (t === 'array') { const j = loose(v); return Array.isArray(j) ? j : v.split(',').map((x) => loose(x.trim())); }
  return loose(v);
};
// A line typed after a command's name, as its arguments: a JSON object; or name=value pairs
// (a value is JSON where it reads as JSON, else text, and runs to the next name=); or, with no
// name at all, the value of the one required argument ("assistant.ask two oscillators").
export function parseArgs(text, schema = { properties: {}, required: [] }) {
  const s = String(text ?? '').trim(), props = schema.properties ?? {};
  if (!s) return {};
  if (s.startsWith('{')) return JSON.parse(s);
  const out = {}, parts = s.split(/\s+(?=[A-Za-z_][\w]*=)/);
  if (!/^[A-Za-z_]\w*=/.test(parts[0])) {
    const only = (schema.required ?? [])[0] ?? Object.keys(props)[0];
    if (!only) throw new Error('this command takes no arguments');
    return { [only]: typed(s, props[only]) };
  }
  for (const part of parts) { const i = part.indexOf('='), k = part.slice(0, i); out[k] = typed(part.slice(i + 1).trim(), props[k]); }
  return out;
}
// "name(required, [optional])": what a command takes, in one line.
export const signature = (t) => {
  const req = new Set(t.inputSchema?.required ?? []), keys = Object.keys(t.inputSchema?.properties ?? {});
  return `${t.name}  ${keys.map((k) => (req.has(k) ? k : `[${k}]`)).join(' ')}`.trim();
};

const r3 = (x) => Math.round(x * 1000) / 1000;
// An object in a few fields: enough to know what and where it is without its points.
export function brief(o, rectOf, blanketOf) {
  const b = { id: o.id, kind: o.kind, ...(o.role ? { role: o.role } : {}), space: o.space ?? null };
  if (o.name) b.name = o.name;
  const r = rectOf?.(o);
  if (r) b.box = [r3(r.cx - r.w / 2), r3(r.cy - r.h / 2), r3(r.cx + r.w / 2), r3(r.cy + r.h / 2)];
  if (o.points) b.points = o.points.length;
  if (o.verts) { b.verts = o.verts.length; b.faces = o.faces.length; }
  if (o.closed) b.closed = true;
  if (o.brush?.id) b.brush = o.brush.id;
  if (o.text) b.text = String(o.text).slice(0, 80);
  if (typeof o.code === 'string') b.code = o.code.split('\n').filter((l) => /^\/\/ /.test(l)).slice(0, 4).map((l) => l.slice(3)).join(' | ');
  const bl = blanketOf?.(o);
  if (bl?.ins?.length) b.ins = bl.ins.map((p) => p.name ?? p);
  if (bl?.outs?.length) b.outs = bl.outs.map((p) => p.name ?? p);
  if (o.params && Object.keys(o.params).length) b.params = o.params;
  if (o.preset) b.preset = o.preset;
  if (o.on) b.on = o.on;
  if (o.at) b.at = o.at.map((q) => q.id);
  if (o.bind) b.wire = `${o.bind.from.id}.${o.bind.from.port} -> ${o.bind.to.id}.${o.bind.to.port}`;
  return b;
}

// What a brain is told of the moment, in words: what is drawn (in short, the first `max`), and what is selected.
export function describe(objects, selection, rectOf, blanketOf, max = 30) {
  const list = objects.filter((o) => !o.bind && o.kind !== 'joint'), sel = list.filter((o) => selection.has(o.id));
  const row = (o) => JSON.stringify(brief(o, rectOf, blanketOf));
  return (list.length ? `Drawn now (${list.length} objects${list.length > max ? `, the first ${max}` : ''}):\n` + list.slice(0, max).map(row).join('\n') : 'Nothing is drawn yet.')
    + (sel.length ? `\nSelected ("it", "this", "these"): ${sel.map((o) => o.id).join(', ')}` : '\nNothing is selected.');
}

// ---- the page -----------------------------------------------------------------

// host: { define, T, tools, state, get, rectOf, actions, context, allowed, keysShown,
//         settings, setSetting, DEFAULTS, panels, PANELS, view, frameIds, fit, stage,
//         EXAMPLES, addExample }
export function install(h) {
  const { define, T } = h, ui = { record: false };
  const action = (id) => h.actions.find((a) => a.id === id);

  define({ ...ui, name: 'tools.search', doc: 'Find commands by what they do: words from a command\'s name or description (the more of them match, the higher it comes). Returns each with its arguments. Use it before guessing a name.', args: { query: T.str, limit: T.num }, run: (a) => searchTools(h.tools(), a.query, a.limit > 0 ? a.limit : 8).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });

  define({ ...ui, name: 'action.list', doc: 'Every action a key, a menu or a toolbar can do, with its id, title and key; available: whether it applies to what is selected or under the pointer now. query: words to find.', args: { query: T.str, available: { type: 'boolean' } },
    run(a) {
      const c = h.context(), q = String(a.query ?? '').toLowerCase();
      return h.actions.filter((x) => !x.hidden).map((x) => ({ id: x.id, title: x.title, ...(h.keysShown(x) ? { key: h.keysShown(x) } : {}), ...(x.group ? { group: x.group } : {}), available: h.allowed(x, c) }))
        .filter((x) => (!q || q.split(/\s+/).every((w) => (x.id + ' ' + x.title).toLowerCase().includes(w))) && (!a.available || x.available));
    } });
  define({ ...ui, name: 'action.run', doc: 'Do an action by its id (action.list), as its key would: on the selection, at the pointer. False when it does not apply now.', args: { id: T.str }, required: ['id'],
    run(a) { const x = action(a.id), c = h.context(); if (!x) throw new Error(`no action: ${a.id}`); if (!h.allowed(x, c)) return false; x.run(c); return true; } });

  define({ ...ui, name: 'setting.get', doc: 'The settings of this browser (the look of new marks, tools, grid, theme, the assistant): one by key, or all.', args: { key: T.str }, run: (a) => (a.key ? h.settings[a.key] : { ...h.settings }) });
  define({ ...ui, name: 'setting.set', doc: 'Set a setting of this browser (setting.get lists them). It is not part of the drawing.', args: { key: T.str, value: {} }, required: ['key', 'value'],
    run(a) { if (!(a.key in h.DEFAULTS)) throw new Error(`no setting: ${a.key}`); h.setSetting(a.key, a.value); return h.settings[a.key]; } });

  define({ ...ui, name: 'panel.show', doc: 'Open the side panel on one of: ' + h.PANELS.map((p) => p.id).join(', ') + '.', args: { id: { enum: h.PANELS.map((p) => p.id) } }, required: ['id'], run: (a) => { h.panels().show(a.id); } });
  define({ ...ui, name: 'panel.close', doc: 'Close the side panel.', run: () => { h.panels().close(); } });

  define({ ...ui, name: 'space.read', doc: 'What is drawn. Without ids: every object in short (id, kind, role, the space it is in, its box [x0, y0, x1, y1], counts), the selection, the music and the grid; space: only what is in that space (null or "root" for the canvas, or a target\'s or group\'s id). With ids: those objects in full, points and code and all.', args: { ids: T.ids, space: { type: ['string', 'null'] } },
    run(a) {
      if (a.ids?.length) return { objects: a.ids.map(h.get).filter(Boolean).map((o) => structuredClone(o)) };
      const all = [...h.state.objects.values()], inSpace = a.space === undefined ? all : all.filter((o) => (o.space ?? null) === (a.space === 'root' ? null : a.space));
      return { objects: inSpace.map((o) => brief(o, h.rectOf, h.blanketOf)), selection: [...h.state.selection], music: h.state.music, grid: h.state.grid };
    } });

  const where = () => ({ cx: r3(h.view.cam.cx), cy: r3(h.view.cam.cy), zoom: r3(h.view.cam.zoom), width: h.view.size.w, height: h.view.size.h, unitsPerPx: h.view.unitsPerPx() });
  define({ ...ui, name: 'view.get', doc: 'Where the canvas view is: its middle (cx, cy, canvas units), zoom, size in pixels and canvas units per pixel.', run: where });
  define({ ...ui, name: 'view.set', doc: 'Move the canvas view: its middle (cx, cy) and zoom.', args: { cx: T.num, cy: T.num, zoom: T.num },
    run(a) { const c = h.view.cam; if (Number.isFinite(a.cx)) c.cx = a.cx; if (Number.isFinite(a.cy)) c.cy = a.cy; if (a.zoom > 0) c.zoom = Math.min(200, Math.max(0.02, a.zoom)); return where(); } });
  define({ ...ui, name: 'view.frame', doc: 'Show these objects filling the view; with no ids, everything.', args: { ids: T.ids }, run(a) { if (a.ids?.length) h.frameIds(a.ids, a.ids.length === 1 ? 0.82 : 0.6); else h.fit(); return where(); } });
  define({ ...ui, name: 'view.look', doc: 'A picture of the view as it is now (PNG): the ink, brushed strokes and 3D scenes, with code objects and frames outlined and titled, and the text of a note written in it. (Code is read with space.read, not from the picture.) width: its width in pixels (default 900).', args: { width: T.num },
    run(a) {
      const src = h.view.grab(), box = h.stage.getBoundingClientRect(), k = Math.min(2, Math.max(0.1, (a.width > 0 ? a.width : 900) / box.width));
      const c = document.createElement('canvas'), g = c.getContext('2d'), css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
      c.width = Math.round(box.width * k); c.height = Math.round(box.height * k);
      g.fillStyle = v('--bg') || '#111'; g.fillRect(0, 0, c.width, c.height);
      for (const under of h.stage.querySelectorAll(':scope > canvas')) if (under !== src && under.width) g.drawImage(under, 0, 0, c.width, c.height); // the brushed ink is its own canvas, under the lines
      g.drawImage(src, 0, 0, c.width, c.height);
      const size = Math.max(9, 11 * k), lh = size * 1.25;
      g.font = `${size}px ui-monospace, monospace`; g.textBaseline = 'top'; g.lineWidth = 1;
      for (const el of h.stage.querySelectorAll('.face')) { // faces are DOM: drawn here as what they are, a frame and its words
        const r = el.getBoundingClientRect();
        if (!r.width || r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
        const x = (r.left - box.left) * k, y = (r.top - box.top) * k, w = r.width * k, ht = r.height * k;
        if (!el.classList.contains('kind-line')) { g.strokeStyle = el.classList.contains('sel') ? v('--accent') : v('--line'); g.strokeRect(x + 0.5, y + 0.5, w, ht); }
        // its title, then what is written in it (a note's text, a code object's code), as many lines as fit
        const title = (el.head?.textContent || '').trim().slice(0, 40), per = Math.max(8, Math.floor((w - 8) / (size * 0.6)));
        const wrap = (t) => { const out = []; for (const para of t.split('\n')) { let line = ''; for (const word of para.split(/\s+/)) { if ((line + ' ' + word).trim().length > per && line) { out.push(line); line = word; } else line = (line + ' ' + word).trim(); } out.push(line); } return out; };
        const lines = [title, ...wrap((el.note?.innerText || '').trim())].filter((t) => t.trim());
        g.save(); g.beginPath(); g.rect(x, y, w, ht); g.clip();
        lines.slice(0, Math.max(1, Math.floor((ht - 4) / lh))).forEach((t, i) => { g.fillStyle = i === 0 && title ? v('--muted') || '#999' : v('--ink') || '#ddd'; g.fillText(t.slice(0, 120), x + 4, y + 3 + i * lh); });
        g.restore();
      }
      return { image: c.toDataURL('image/png'), width: c.width, height: c.height, view: where() };
    } });

  define({ ...ui, name: 'code.help', doc: 'How things are made here, and what object code is given. Call it with no arguments before building anything that plays, moves or runs code: it returns short recipes (how sound is made, a score of glissandi, triggers on a line, a graph that plays such as a Markov chain or a drum loop, how to check the result) and the kinds of code. role: what that code gets (ev, ways, voices, note(), pitch() ...), what it returns and the names of its presets. role and preset: that preset\'s source, to copy and change.', args: { role: { enum: CODE_ROLES }, preset: T.str },
    run: (a) => codeHelp(a.role, a.preset) });

  define({ ...ui, name: 'example.list', doc: 'The examples that can be added, each with its index, path and title.', run: () => h.EXAMPLES.map((e, i) => ({ index: i, path: e.path, title: e.title })) });
  define({ name: 'example.add', record: false, doc: 'Add an example by its index or its title (example.list), below what is drawn or at a canvas point. Its commands are recorded in the take.', args: { index: T.num, title: T.str, at: { type: 'array' } },
    run(a) { const e = Number.isInteger(a.index) ? h.EXAMPLES[a.index] : h.EXAMPLES.find((x) => x.title.toLowerCase().includes(String(a.title ?? '\n').toLowerCase())); if (!e) throw new Error('no such example'); h.addExample(e, Array.isArray(a.at) ? a.at : null); return e.title; } });

  // ---- the palette's other rows: commands, settings, objects, examples ----------
  // q: what is typed (lower case). -> [{ title, icon, keys, kind, s, run | fill }]; fill: a line to put in the field.
  function rows(q, kinds = ['command', 'setting', 'object', 'example']) {
    const out = [], add = (kind, text, row) => { const s = q ? score(q, text.toLowerCase()) : 0; if (s >= 0) out.push({ kind, s, ...row }); };
    if (kinds.includes('command')) for (const t of h.tools()) {
      const takes = Object.keys(t.inputSchema.properties ?? {}).length > 0;
      add('command', t.name + ' ' + (t.description ?? '').slice(0, 60), { title: t.name, sub: (t.description ?? '').split(/(?<=\.)\s/)[0], icon: 'code', keys: takes ? '…' : '', ...(takes ? { fill: '!' + t.name + ' ' } : { line: '!' + t.name }) });
    }
    if (kinds.includes('setting')) for (const k of Object.keys(h.DEFAULTS)) {
      const val = h.settings[k];
      if (val !== null && typeof val === 'object') continue;
      add('setting', k, { title: k, icon: 'gear', keys: typeof val === 'boolean' ? (val ? '●' : '○') : String(val ?? '–').slice(0, 14), ...(typeof val === 'boolean' ? { run: () => h.setSetting(k, !val), stay: true } : { fill: `!setting.set key=${k} value=` }) });
    }
    if (kinds.includes('object')) for (const o of h.state.objects.values()) {
      if (o.bind || o.kind === 'joint') continue;
      add('object', `${o.name ?? ''} ${o.role ?? o.kind} ${o.id}`, { title: `${o.name ?? o.role ?? o.kind}`, icon: 'target', keys: o.id, run: () => { h.call('select.set', { ids: [o.id] }); h.frameIds([o.id]); } });
    }
    if (kinds.includes('example')) h.EXAMPLES.forEach((e) => add('example', e.title + ' ' + e.path, { title: e.title, icon: e.icon ?? 'examples', keys: e.path.split('/')[0], run: () => h.addExample(e) }));
    return out;
  }
  // "!name the rest": run a command from a typed line. -> what it returned, as short text.
  async function line(text) {
    const m = String(text).replace(/^!/, '').trim().match(/^(\S+)\s*([\s\S]*)$/);
    if (!m) return '';
    const t = h.tools().find((x) => x.name === m[1]);
    if (!t) throw new Error(`no command: ${m[1]}`);
    const r = await h.call(t.name, parseArgs(m[2], t.inputSchema), 'palette');
    if (r === undefined || r === null) return '';
    if (r?.image) return `${r.width}×${r.height}`;
    const s = typeof r === 'string' ? r : JSON.stringify(r);
    return s.length > 600 ? s.slice(0, 600) + ' …' : s;
  }
  const hint = (text) => { const name = String(text).replace(/^!/, '').trim().split(/\s/)[0], t = h.tools().find((x) => x.name === name); return t ? signature(t) : ''; };
  return { rows, line, hint };
}
