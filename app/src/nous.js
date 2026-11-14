// Midinous projects in underspace (Midinous, and midinojs, its web port: a grid
// of nodes joined by paths; travelers run the paths a grid cell a beat and play
// the node they reach, which sends them on). Here:
//   node   a joint where its paths meet; its code is the node: it plays (note,
//          cc), counts, or stops, and sends the traveler on (robin, split, random,
//          portal) along the paths that leave it
//   path   a line from node to node, across first, up first or straight, as
//          Midinous drew it, so its length is the cells between them (time)
//   start  a node a traveler sets off from, one grid cell a beat
// Gates read the lights of their inputs (the nodes whose logic paths lead to them);
// LEDs, switches and notes light up. Not carried over: groups, relative ranges,
// repeat, slew. Parsing is Artist Model Studio's (src/score/import/nous.js).

const MIDINOUS_ORDER = ['Hirajoshi', 'Insen', 'Iwato', 'Pentatonic Major', 'Pentatonic Minor', 'Two Semitone Tritone', 'Aeolian', 'Dorian', 'Harmonic Major', 'Harmonic Minor', 'Ionian', 'Locrian', 'Lydian', 'Mixolydian', 'Phrygian', 'Altered', 'Half Diminished', 'Locrian Major', 'Lydian Augmented', 'Melodic Minor', 'Ukrainian Dorian', 'Augmented', 'Blues', 'Flamenco', 'Hungarian', 'Persian', 'Prometheus', 'Chromatic', 'Octatonic Whole', 'Octatonic Half', 'Tritone', 'Whole Tone'];

const GRID = 144;   // the Midinous grid, in its own units
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r = (v, d = 2) => { const k = 10 ** d; return Math.round(v * k) / k; };
const q = v => JSON.stringify(v);
const MODES = ['robin', 'split', 'portal', 'random'];

const LEGACY = [['_note_points', 'note'], ['_cc_points', 'cc'], ['_gate_points', 'gate'], ['_LED_points', 'led'], ['_counter_points', 'counter'], ['_switch_points', 'switch'], ['_terminator_points', 'terminator']];

function readColor(c) {
  if (c && typeof c === 'object') return `#${[c.R, c.G, c.B].map(v => Math.max(0, Math.min(255, num(v))).toString(16).padStart(2, '0')).join('')}`;
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
}

function readNode(d, type) {
  let x = d.x, y = d.y;
  if ((x === undefined || y === undefined) && typeof d.Origin === 'string') { const [a, b] = d.Origin.split(','); x = parseFloat(a); y = parseFloat(b); }
  const mode = d._Mode ?? d.playMode;
  const path = d.PathMode ?? d.pathMode;
  const midi = d.midi_data || {}, rel = d.relative_midi_data || {};
  const legacy = d.Origin !== undefined;
  return {
    id: d.id, type: d.type || type || 'note', label: d.label || '', color: readColor(d.color),
    x: num(x), y: num(y),
    note: num(midi.Primary ?? d.note, 60), velocity: num(midi.Secondary ?? d.velocity, 100), channel: Math.max(1, Math.min(16, num(midi.Channel ?? d.channel, 1))),
    duration: Math.max(0.0625, num(midi.Duration ?? d.duration, 1)), repeat: Math.max(0, Math.round(num(midi.Repeat ?? d.repeat, 0))),
    scale: midi.Scale, root: midi.Root,
    relative: d.useRelative ?? (legacy && num(rel.Primary) !== 0),
    offset: num(rel.Primary), pass: Boolean(rel.Pass?.Primary), relScale: rel.Scale, relRoot: rel.Root,
    chance: d.probability ?? d.chance ?? 100, forceScale: d.force_scale ?? d.forceScale ?? true, mute: Boolean(d.mute),
    start: Boolean(d.Start ?? d.isStart),
    mode: typeof mode === 'string' ? Math.max(0, MODES.indexOf(mode)) : num(mode, 0),
    pathMode: typeof path === 'string' ? ({ horz: 0, vert: 1, line: 2 }[path] ?? 0) : num(path, 0),
    to: [...(d.SerializablePathTo || d.to || [])], weights: {},
    countMax: d.CountLimit ?? d.countMax, ccNum: d.ccNum, ccValue: d.ccValue, gateType: d.gateType,
    isPass: Boolean(d.pass ?? d.isPass),
    range: rel.RangeFields?.Primary ? (rel.RangeFields.Primary.Up && rel.RangeFields.Primary.Down ? 'both' : rel.RangeFields.Primary.Up ? 'up' : rel.RangeFields.Primary.Down ? 'down' : null) : null,
    gateIndex: d._Type, negated: Boolean(d.negated), slew: d.slew_mode ? num(d.slew_value, 0) : 0,
    maxCount: num(d.MaxCount, 0), bypass: Boolean(d.Bypass), logicTo: [...(d.SerializableLogicPathTo || [])]
  };
}

// The nodes and settings of a midinojs project ({ points, settings }) or an original Midinous one
// (_note_points, _cc_points, … and _paths).
export function parseNous(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  const nodes = [];
  let settings = {};
  if (Array.isArray(data?.points)) {
    settings = { tempo: data.settings?.tempo, beats: data.settings?.beats, scale: data.settings?.scale, root: data.settings?.rootNote };
    for (const p of data.points) nodes.push(readNode(p));
  } else if (data && (data._note_points || data._version)) {
    const perf = data._performance_data || {};
    settings = { tempo: perf.tempo, scale: MIDINOUS_ORDER[perf.doc_scale], root: perf.doc_root };
    for (const [key, type] of LEGACY) for (const p of Object.values(data[key] || {})) nodes.push(readNode(p, type));
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const p of Object.values(data._paths || {})) {
      const src = byId.get(p.key?.source_id);
      if (!src) continue;
      if (p.logic) { if (!src.logicTo.includes(p.key.target_id)) src.logicTo.push(p.key.target_id); continue; }
      if (!src.to.includes(p.key.target_id)) src.to.push(p.key.target_id);
      src.weights[p.key.target_id] = p.weight;
    }
  } else throw new Error('Not a Midinous or midinojs project');
  return { nodes, settings };
}


// A path drawn as Midinous drew it: across first (0), up first (1), or straight (2).
function edgePoints(a, b, mode) {
  if (mode === 2 || a[0] === b[0] || a[1] === b[1]) return [a, b];
  return mode === 1 ? [a, [a[0], b[1]], b] : [a, [b[0], a[1]], b];
}

// The code of a node of a kind, with Midinous's defaults (a point placed on a line).
export const nodeCodeFor = (type, note = 60) => nodeCode({ type, note, velocity: 100, channel: 1, duration: 1, chance: 100, mode: 0, ccNum: 1, ccValue: 64, countMax: 2 });

const GATES = ['and', 'or', 'xor', 'nand', 'nor', 'xnor'];

// The code of a node: what it plays or decides, then where it sends the traveler. Lights (light, lit)
// are what gates read: a note is lit while it sounds, an LED for its beats (or on and off), a switch
// while it is on, a counter or an anchor for a moment as a traveler goes on.

export function nodeCode(n, ctx = {}) {
  const lines = [`// ${n.type}${n.label ? ' ' + n.label : ''}`, '// out: count'];
  const body = [];
  const scaleOf = (i) => (i === undefined || i === null || i < 0 ? null : MIDINOUS_ORDER[i] ?? null);
  if (n.type === 'note') {
    lines.push(`// param: note ${n.note}`, `// param: vel ${n.velocity}`, `// param: ch ${n.channel}`, `// param: beats ${n.duration}`, `// param: chance ${n.chance ?? 100}`);
    if (n.relative) { lines.push(`// param: by ${n.pass ? 0 : n.offset}`); body.push('// relative: a number of steps of the scale from the note this traveler played last', 'const m = step(ev.last, p.by);'); }
    else body.push(n.forceScale && (scaleOf(n.scale) || ctx.scale) ? 'const m = snap(p.note);' : 'const m = p.note;');
    if (!n.mute) body.push('if (rng() * 100 < p.chance) { note(m, p.vel, p.beats * ev.spb, p.ch); light(p.beats); }');
  } else if (n.type === 'cc') {
    lines.push(`// param: cc ${n.ccNum ?? n.note}`, `// param: value ${n.ccValue ?? n.velocity}`, `// param: ch ${n.channel}`);
    if (!n.mute) body.push('cc(p.cc, p.value, p.ch);');
  } else if (n.type === 'counter') {
    lines.push(`// param: every ${Math.max(1, num(n.countMax, 1))}`);
    body.push('// only every nth traveler goes on', "mem.k = (mem.k ?? 0) + 1;", "if (mem.k % p.every) return 'stop';", 'light(0.25);');
  } else if (n.type === 'led') {
    lines.push(`// param: beats ${n.duration ?? 1}`, `// param: toggle ${n.toggle ? 1 : 0}`);
    body.push('// lights up as a traveler passes: for its beats, or (toggle 1) on and off in turn', 'if (p.toggle) light(!lit(ev.self)); else light(p.beats);');
  } else if (n.type === 'switch') {
    lines.push(`// param: block ${n.block === false ? 0 : 1}`);
    body.push('// on and off in turn; while off (block 1), a traveler stops here', 'mem.on = !mem.on;', 'light(mem.on);', "if (p.block && !mem.on) return 'stop';");
  } else if (n.type === 'gate') {
    const type = GATES.indexOf(n.gateName ?? 'and');
    lines.push(`// param: type ${Math.max(0, type)}`);
    body.push(`// a logic gate: it reads the lights of its inputs (their names) and lets a traveler on`,
      `// only when they say so. type: ${GATES.map((g, i) => `${i} ${g}`).join(', ')}`,
      `const inputs = ${JSON.stringify(ctx.inputs ?? [])};`,
      'const k = inputs.filter((name) => lit(name)).length, all = inputs.length > 0 && k === inputs.length, any = k > 0, odd = k % 2 === 1;',
      "if (![all, any, odd, !all, !any, !odd][p.type]) return 'stop';", 'light(0.25);');
  } else if (n.type === 'anchor') {
    body.push('light(0.25);');
  } else if (n.type === 'terminator') {
    return [...lines, '// stops whatever reaches it, drivers too', "return 'end';"].join('\n');
  }
  // where it goes: the paths that leave this node
  // the paths that leave this node; a node in the middle of a line also lets the traveler go on along it
  body.push("const out = ways.filter((w) => (w.dir === 1 && w.u < 0.001) || w.line === ev.from);", "if (!out.length) return 'stop';");
  const mode = MODES[n.mode] ?? 'robin';
  if (mode === 'split') body.push('// split: every way at once', 'return out.map((w) => ways.indexOf(w));');
  else if (mode === 'random' || mode === 'portal') body.push(`// ${mode}: one way, by chance`, 'return ways.indexOf(out[Math.floor(rng() * out.length)]);');
  else body.push('// robin: each traveler the next way, in turn', 'mem.n = (mem.n ?? -1) + 1;', 'return ways.indexOf(out[mem.n % out.length]);');
  return [...lines, ...body].join('\n');
}

// The project as a plan, a grid cell `cell` canvas units, centred on `at`:
// { nodes: [{ key, at, code, start }], edges: [{ from, to, points }], settings, warnings, stats }
export function nousPlan(input, { cell = 1, at = [0, 0] } = {}) {
  const { nodes, settings } = parseNous(input);
  const warnings = [];
  const scale = settings.scale ?? null;
  const ctx = { scale, root: settings.root };
  const plan = { nodes: [], edges: [], settings: { bpm: num(settings.tempo, 0) || null, scale, root: settings.root != null ? 60 + (num(settings.root) % 12) : null }, warnings };
  if (!nodes.length) { warnings.push('Midinous: no nodes'); plan.stats = { nodes: 0, paths: 0 }; return plan; }
  const xs = nodes.map((n) => n.x / GRID), ys = nodes.map((n) => n.y / GRID);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const place = (n) => [r(at[0] + (n.x / GRID - cx) * cell, 4), r(at[1] - (n.y / GRID - cy) * cell, 4)]; // Midinous is y down
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    // a gate's inputs: the nodes whose logic paths lead to it (named n<id> when imported)
    if (n.type === 'gate') { const t = typeof n.gateType === 'string' ? n.gateType.toLowerCase() : GATES[num(n.gateIndex, 0)] ?? 'and'; n.gateName = n.negated ? { and: 'nand', or: 'nor', xor: 'xnor', nand: 'and' }[t] ?? t : t; }
    const inputs = nodes.filter((m) => m.logicTo.includes(n.id)).map((m) => 'n' + m.id);
    plan.nodes.push({ key: n.id, at: place(n), code: nodeCode(n, { ...ctx, inputs }), start: n.start, color: n.color, type: n.type });
    for (const id of n.to) {
      const t = byId.get(id);
      if (!t || t === n) continue;
      plan.edges.push({ from: n.id, to: id, points: edgePoints(place(n), place(t), n.pathMode), color: n.color });
    }
  }
  if (!nodes.some((n) => n.start)) warnings.push('Midinous: no start node, so nothing sets off');
  plan.stats = { nodes: plan.nodes.length, paths: plan.edges.length };
  return plan;
}

// Make the plan with commands: paths as lines, nodes as joints holding their ends (a node
// with one path is a pin), a traveler from each start node, a grid cell a beat
// (speed 1, with `cell` the timeline's grid size). Returns the new ids.
export function applyNous(plan, call, space = null) {
  const lines = plan.edges.map((e) => ({ e, id: call('line.add', { space, points: e.points, style: { path: 'straight', width: 1.6, ...(e.color ? { stroke: e.color } : {}) } }) }));
  const made = lines.map((l) => l.id);
  for (const n of plan.nodes) {
    const at = [...lines.filter((l) => l.e.from === n.key).map((l) => ({ id: l.id, u: 0 })), ...lines.filter((l) => l.e.to === n.key).map((l) => ({ id: l.id, u: 1 }))];
    if (!at.length) continue;
    const j = call('joint.add', { at, code: n.code, glyph: n.type ?? 'note', ...(at.length < 2 ? { node: true } : {}) });
    if (j) { made.push(j); if (n.key != null) call('object.name', { id: j, name: 'n' + n.key }); }
    if (n.start) for (const l of lines.filter((x) => x.e.from === n.key).slice(0, 1)) {
      const t = call('traveler.add', { on: l.id, loop: 0, size: 0.35 });
      // a signal, a grid cell a beat: what a start node sends out (switches, counters and gates stop it)
      if (t) { call('object.set', { id: t, name: 'speed', value: 1 }); call('object.set', { id: t, name: 'drives', value: 0 }); made.push(t); }
    }
  }
  return made.filter(Boolean);
}
