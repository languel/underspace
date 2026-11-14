// IanniX scores in underspace. A .iannix file is JavaScript that makes a score
// with run("add curve 1000")-style commands. It is run (trusted code: your own
// file, not a sandbox), its commands are collected into objects, and those
// become underspace objects:
//   curve    a line (Bézier controls sampled; ellipses, point lists, equations too)
//   cursor   a traveler on its curve: setSpeed (auto N: N seconds a lap; else IanniX
//            units a second), setPattern (once, loop, there and back)
//   trigger  an event, a small circle at setPos; its messages (note, notef, cc, ccf)
//            become its code. IanniX's trigger_value_x/y, where the trigger sits in the
//            cursor's bounds, is ev.x/ev.y here; the default message is IanniX's:
//            notef 1 trigger_value_y trigger_value_x trigger_duration
// Not carried over (listed in warnings): OSC and direct:// messages, cursor messages,
// textures, 3D depth, bounds set by hand.
//
// The command collector and the object model are Artist Model Studio's
// (src/score/import/iannix.js), a port of Underscores's iannixScript.js.

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const TOKEN = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+)/g;
export function tokenize(command) {
  const out = [];
  const src = String(command || '').trim();
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\([\\"'])/g, '$1'));
  return out;
}

function splitTopLevel(source) {
  const values = [];
  let start = 0, depth = 0, quote = null;
  const text = String(source || '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { values.push(text.slice(start, i).trim()); start = i + 1; }
  }
  values.push(text.slice(start).trim());
  return values;
}

function seeded(seed) {
  let v = (Number(seed) || 1) >>> 0;
  return () => {
    v = (v + 0x6d2b79f5) >>> 0;
    let r = v;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// The command collector: run("…") calls become operations.
export function createCollector() {
  const st = { currentId: null, lastCurveId: null, ops: [], unsupported: new Map() };
  const target = v => (!v || v.toLowerCase() === 'current' ? st.currentId : v.toLowerCase() === 'lastcurve' ? st.lastCurveId : String(v));
  const run = source => {
    const raw = String(source || '').trim();
    const tk = tokenize(raw);
    if (!tk.length) return null;
    const cmd = tk[0].toLowerCase(), args = tk.slice(1);
    if (cmd === 'speed' && args.length === 1) { st.globalSpeed = Math.max(0.001, num(args[0], 1)); return true; }   // (the whole score's rate)
    if (cmd === 'add' && ['curve', 'cursor', 'trigger'].includes(args[0]?.toLowerCase())) {
      const role = args[0].toLowerCase();
      const id = String(args[1] ?? `${role}-${st.ops.length + 1}`);
      st.currentId = id;
      if (role === 'curve') st.lastCurveId = id;
      st.ops.push({ type: 'add', role, id });
      return id;
    }
    if (cmd === 'clear') { st.ops.push({ type: 'clear' }); st.currentId = st.lastCurveId = null; return true; }
    const id = target(args[0]);
    const push = op => { st.ops.push({ id, ...op }); return true; };
    if (['setpointat', 'setsmoothpointat'].includes(cmd) && id) {
      const v = args.slice(2).map(x => num(x));
      const d3 = v.length >= 9, d2 = !d3 && v.length >= 6;
      return push({ type: 'point', index: Math.max(0, Math.round(num(args[1]))), point: [v[0] || 0, v[1] || 0],
        c1: d3 ? [v[3] || 0, v[4] || 0] : d2 ? [v[2] || 0, v[3] || 0] : [0, 0], c2: d3 ? [v[6] || 0, v[7] || 0] : d2 ? [v[4] || 0, v[5] || 0] : [0, 0], smooth: cmd === 'setsmoothpointat' });
    }
    if (cmd === 'setpointslines' && id) {
      const v = args.slice(2).map(x => num(x)), pts = [];
      for (let i = 0; i + 1 < v.length; i += 3) pts.push([v[i], v[i + 1]]);
      return push({ type: 'points', points: pts, closed: num(args[1]) === 1 });
    }
    if (cmd === 'setpointsellipse' && id) return push({ type: 'ellipse', radii: [Math.abs(num(args[1], 1)), Math.abs(num(args[2], num(args[1], 1)))] });
    if (cmd === 'setequation' && id) {
      const ex = splitTopLevel(args.slice(2).join(' '));
      if (ex.length !== 3 || ex.some(x => !x)) { st.unsupported.set('setEquation', 'an equation needs three coordinate expressions'); return null; }
      return push({ type: 'equation', kind: String(args[1] || 'cartesian').toLowerCase(), expressions: ex });
    }
    if (cmd === 'setequationparam' && id) return push({ type: 'equationParam', name: String(args[1] || ''), value: num(args[2]) });
    if (['setequationnbpoints', 'setequationpoints'].includes(cmd) && id) return push({ type: 'equationPoints', value: Math.min(10000, Math.max(2, Math.round(num(args[1], 400)))) });
    if (cmd === 'setpos' && id) return push({ type: 'position', value: [num(args[1]), num(args[2])] });
    if (cmd === 'setcurve' && id) return push({ type: 'curve', value: target(args[1]) });
    if (cmd === 'setspeed' && id) return push({ type: 'speed', value: Math.max(0.001, num(args[2] ?? args[1], 5)), mode: args.length > 2 ? args[1].toLowerCase() : 'absolute' });
    if (cmd === 'setboundssource' && id) return push({ type: 'boundsSource', value: args.slice(1, 5).map(x => num(x)) });
    if (cmd === 'setwidth' && id) return push({ type: 'width', value: Math.max(0, num(args[1], 1)) });
    if (cmd === 'setsize' && id) return push({ type: 'size', value: Math.max(0, num(args[1], 1)) });
    if (cmd === 'setgroup' && id) return push({ type: 'group', value: args.slice(1).join(' ') });
    if (['setlabel', 'setname'].includes(cmd) && id) return push({ type: 'label', value: args.slice(1).join(' ') });
    if (cmd === 'setactive' && id) return push({ type: 'active', value: !['0', 'false', 'off'].includes(String(args[1]).toLowerCase()) });
    if (['setcolor', 'setcolorhue', 'setcoloractive'].includes(cmd) && id) return push({ type: cmd === 'setcolorhue' ? 'colorHue' : 'color', value: args.slice(1, 5).map(x => num(x)) });
    if (cmd === 'setpattern' && id) return push({ type: 'pattern', value: args.slice(1).join(' ') });
    if (cmd === 'setmessage' && id) return push({ type: 'message', value: args.slice(1).join(' ') });
    if (cmd === 'settriggeroff' && id) return push({ type: 'triggerOff', value: !['0', 'false', 'off'].includes(String(args[1]).toLowerCase()) });
    if (['center', 'zoom', 'rotate', 'setdepth', 'setcolorinactive', 'setoffset', 'setspeedf', 'setboundssourcemode', 'setboundstarget'].includes(cmd)) return true;   // (not used here)
    if (cmd === 'registertexture') { st.unsupported.set(tk[0], 'background images are not imported'); return null; }
    if (cmd === 'setpointstxt') { st.unsupported.set(tk[0], 'text as a curve (setPointsTxt) is not imported'); return null; }
    st.unsupported.set(tk[0], `unsupported command ${tk[0]}`);
    return null;
  };
  return { run, state: st };
}

const helpers = rand => {
  const linexp = (v, f) => (!f ? v : (Math.exp(f * v - f) - Math.exp(-f)) / (1 - Math.exp(-f)));
  const norm = (v, lo, hi, f) => (hi === lo ? 0 : linexp((v - lo) / (hi - lo), f));
  const range = (v, lo, hi, f) => lo + linexp(v, f) * (hi - lo);
  return {
    PI: Math.PI, TWO_PI: Math.PI * 2, HALF_PI: Math.PI / 2, THIRD_PI: Math.PI / 3, QUARTER_PI: Math.PI / 4,
    random: (lo, hi) => (lo === undefined || hi === undefined ? rand() : lo + rand() * (hi - lo)),
    range, norm, linexp,
    rangeMid: (v, lo, mid, hi, f) => { const s = linexp(v, f); return s < 0.5 ? s * 2 * (mid - lo) + lo : (s - 0.5) * 2 * (hi - mid) + mid; },
    map: (v, lo1, hi1, lo2, hi2, f) => range(norm(v, lo1, hi1, f), lo2, hi2),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, atan2: Math.atan2, ceil: Math.ceil, cos: Math.cos, exp: Math.exp,
    floor: Math.floor, log: Math.log, min: Math.min, max: Math.max, pow: Math.pow, round: Math.round, sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan
  };
};

// Run the score's JavaScript and collect what it asked for.
export function runIannixScript(source, { seed = 1, files = {}, parameters = {} } = {}) {
  const collector = createCollector();
  const rand = seeded(seed);
  const h = helpers(rand);
  const math = Object.create(null, Object.getOwnPropertyDescriptors(Math));
  Object.defineProperty(math, 'random', { value: rand, enumerable: false, configurable: true });
  const load = f => { if (!(f in files)) throw new Error(`load(): no bundled file ${f}`); return files[f]; };
  const scope = Object.assign(Object.create(null), parameters);
  let title = '';
  const asked = [];
  const ask = (category, label, variable, def) => {
    const key = String(variable || '').trim();
    if (!key) return def;
    const value = Object.prototype.hasOwnProperty.call(parameters, key) ? parameters[key] : def;
    scope[key] = value; asked.push({ category, label, variable: key, value });
    return value;
  };
  const names = Object.keys(h);
  // eslint-disable-next-line no-new-func
  const factory = new Function('scope', 'run', 'ask', 'title', 'load', 'loadJSON', 'sessionTime', 'Math', ...names,
    `with (scope) {\n${source}\nif (typeof askUserForParameters === "function") askUserForParameters();\nif (typeof makeWithScript === "function") makeWithScript();\nif (typeof madeThroughGUI === "function") madeThroughGUI();\n}`);
  factory(scope, collector.run, ask, v => { title = String(v || ''); return title; }, load, f => JSON.parse(load(f)), 0, math, ...names.map(n => h[n]));
  return { ops: collector.state.ops, unsupported: collector.state.unsupported, title, asked, speed: collector.state.globalSpeed ?? 1 };
}

// The objects the commands made.
export function buildModel(ops) {
  const objects = new Map();
  const colorOps = [];
  const ensure = id => { if (!objects.has(id)) objects.set(id, { id, role: null, position: [0, 0], points: [], controls: [], size: 1, width: null, active: true, params: {} }); return objects.get(id); };
  for (const op of ops) {
    if (op.type === 'clear') { objects.clear(); colorOps.length = 0; continue; }
    if (op.type === 'color' || op.type === 'colorHue') { colorOps.push(op); continue; }
    const o = ensure(op.id);
    switch (op.type) {
      case 'add': o.role = op.role; if (op.role === 'curve' && !o.points.length) o.points[0] = [0, 0]; break;
      case 'point': o.points[op.index] = op.point; o.controls[op.index] = { c1: op.c1, c2: op.c2, smooth: op.smooth }; break;
      case 'points': o.points = op.points; o.controls = []; o.closed = op.closed; break;
      case 'ellipse': o.ellipse = op.radii; break;
      case 'equation': o.equation = { kind: op.kind, expressions: op.expressions }; break;
      case 'equationParam': o.params[op.name] = op.value; break;
      case 'equationPoints': o.equationPoints = op.value; break;
      case 'position': o.position = op.value; break;
      case 'curve': o.curve = op.value; break;
      case 'speed': o.speed = op.value; o.speedMode = op.mode; break;
      case 'boundsSource': o.bounds = op.value; break;
      case 'width': o.width = op.value; break;
      case 'size': o.size = op.value; break;
      case 'group': o.group = op.value; break;
      case 'label': o.label = op.value; break;
      case 'active': o.active = op.value; break;
      case 'pattern': o.pattern = op.value; break;
      case 'message': o.messages = [...(o.messages || []), op.value]; break;
      case 'triggerOff': o.triggerOff = op.value; break;
      default: break;
    }
  }
  // Colours: a group's colour is the default for its members; an object's own wins.
  const ids = new Set(objects.keys());
  const apply = (o, op) => { o[op.type] = op.value; delete o[op.type === 'color' ? 'colorHue' : 'color']; };
  for (const op of colorOps.filter(c => !ids.has(c.id))) for (const o of objects.values()) if (o.group === op.id) apply(o, op);
  for (const op of colorOps.filter(c => ids.has(c.id))) apply(objects.get(op.id), op);
  // Equations become points.
  for (const o of objects.values()) {
    if (o.role !== 'curve' || !o.equation) continue;
    const names = Object.keys(o.params), vals = names.map(n => o.params[n]);
    const fns = o.equation.expressions.map(ex => new Function('t', ...names, `with (Math) { return Number(${ex}); }`));   // eslint-disable-line no-new-func
    const n = Math.min(10000, Math.max(2, Math.round(o.equationPoints ?? 400)));
    o.points = []; o.controls = [];
    for (let i = 0; i <= n; i++) {
      const v = fns.map(f => f(i / n, ...vals));
      if (!v.every(Number.isFinite)) throw new Error(`curve ${o.id}: the equation is not finite at t=${(i / n).toFixed(3)}`);
      o.points.push(o.equation.kind === 'polar' ? [v[0] * Math.sin(v[1]) * Math.cos(v[2]), v[0] * Math.cos(v[1])] : [v[0], v[1]]);
    }
  }
  // Smooth points get automatic tangents.
  for (const o of objects.values()) {
    if (o.role !== 'curve' || !o.controls.some(c => c?.smooth)) continue;
    const P = o.points;
    const loop = P.length > 2 && P[0] && P.at(-1) && Math.abs(P[0][0] - P.at(-1)[0]) < 1e-6 && Math.abs(P[0][1] - P.at(-1)[1]) < 1e-6;
    const f = 5, vec = (a, b) => [(b[0] - a[0]) / f, (b[1] - a[1]) / f];
    for (let i = 0; i < P.length; i++) {
      if (!P[i] || !o.controls[i]?.smooth) continue;
      if (i === 0 && P[1]) { o.controls[1] ||= { c1: [0, 0], c2: [0, 0] }; o.controls[1].c1 = vec(loop ? P.at(-2) : P[0], P[1]); }
      else if (i === P.length - 1 && P[i - 1]) { const t = vec(P[i - 1], loop ? P[1] : P[i]); o.controls[i].c2 = [-t[0], -t[1]]; }
      else if (P[i - 1] && P[i + 1]) {
        const t = vec(P[i - 1], P[i + 1]);
        o.controls[i].c2 = [-t[0], -t[1]];
        o.controls[i + 1] ||= { c1: [0, 0], c2: [0, 0] };
        o.controls[i + 1].c1 = t;
      }
    }
  }
  return [...objects.values()].filter(o => o.role);
}

// A curve's points in IanniX units, controls sampled, with its own position added.
export function curvePoints(o, samples = 16) {
  const [px, py] = o.position;
  let pts = [];
  if (o.ellipse) {
    const [rx, ry] = o.ellipse, n = 96;
    for (let i = 0; i <= n; i++) pts.push([rx * Math.cos((i / n) * Math.PI * 2), ry * Math.sin((i / n) * Math.PI * 2)]);
  } else {
    const idx = o.points.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
    for (let k = 0; k < idx.length; k++) {
      const p2 = o.points[idx[k]];
      if (k === 0) { pts.push(p2); continue; }
      const p1 = o.points[idx[k - 1]], c = o.controls[idx[k]];
      const a = c ? [p1[0] + c.c1[0], p1[1] + c.c1[1]] : p1, b = c ? [p2[0] + c.c2[0], p2[1] + c.c2[1]] : p2;
      const flat = !c || (!c.c1[0] && !c.c1[1] && !c.c2[0] && !c.c2[1]);
      if (flat) { pts.push(p2); continue; }
      for (let s = 1; s <= samples; s++) {
        const t = s / samples, u = 1 - t;
        pts.push([u * u * u * p1[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p2[1]]);
      }
    }
    if (o.closed && pts.length > 2) pts.push(pts[0]);
  }
  return pts.map(([x, y]) => [x + px, y + py]);
}

const pathLength = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// IanniX setPattern: the first two numbers are easing; the rest is the traversal. Cyclic unless it ends in 0; a negative pass goes back.
export function loopOf(pattern) {
  const v = String(pattern || '').trim().split(/\s+/).map(Number).filter(Number.isFinite).slice(2);
  if (v.some(x => x < 0)) return 'pingpong';
  if (v.length && !v.includes(0)) return 'loop';
  return 'once';
}


const MESSAGE = /^midi:\/\/[^/\s]+\/(note|notef|cc|ccf)\s+(.*)$/i;
export const DEFAULT_TRIGGER_MESSAGE = 'midi://midi_out/notef 1 trigger_value_y trigger_value_x trigger_duration';

// A trigger's messages as event code. notef's pitch, 0..1 over all 128 notes, is kept
// to `range` (an instrument's compass; IanniX leaves that to the synth).
export function codeFor(messages, warn, range = [36, 96]) {
  const list = (messages?.length ? messages : [DEFAULT_TRIGGER_MESSAGE]).flatMap((m) => String(m).replace(/^\s*\d+\s*,/, '').split(',')).map((s) => s.trim()).filter(Boolean);
  const value = (t) => ({ trigger_value_x: 'ev.x', trigger_value_y: 'ev.y', cursor_value_x: 'ev.x', cursor_value_y: 'ev.y', trigger_duration: '0.35' }[t] ?? (Number.isFinite(Number(t)) ? String(Number(t)) : null));
  const lines = [];
  for (const m of list) {
    const match = m.match(MESSAGE);
    if (!match) { warn(`message not imported: ${m.slice(0, 60)}`); continue; }
    const a = match[2].trim().split(/\s+/).map(value);
    if (a.includes(null)) { warn(`message has an unknown value: ${m.slice(0, 60)}`); continue; }
    const [ch = '1', x = '60', y = '100', d = '0.35'] = a, kind = match[1].toLowerCase();
    if (kind === 'note') lines.push(`note(${x}, ${y}, ${d}, ${ch});`);
    else if (kind === 'notef') lines.push(`note(Math.round(${range ? `${range[0]} + (${x}) * ${range[1] - range[0]}` : `(${x}) * 127`}), Math.round((${y}) * 127), ${d}, ${ch});`);
    else if (kind === 'cc') lines.push(`cc(${x}, ${y}, ${ch});`);
    else lines.push(`cc(${x}, Math.round((${y}) * 127), ${ch});`);
  }
  return lines.length ? `// trigger\n// out: gate count\n// from IanniX: ${list[0].slice(0, 70)}\n${lines.join('\n')}` : null;
}

// The whole score as a plan for underspace, fitted to `width` canvas units, centred on `at`:
// { title, curves: [{ key, points, closed, color }], cursors: [{ curve, seconds, loop, width }],
//   triggers: [{ at, d, code, color }], warnings, stats }
export function iannixPlan(source, { width = 24, at = [0, 0], seed = 1, files, parameters, range } = {}) {
  const run = runIannixScript(source, { seed, files, parameters });
  const objects = buildModel(run.ops);
  const warnings = [...run.unsupported.values()].map((w) => `IanniX: ${w}`);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const curves = objects.filter((o) => o.role === 'curve'), cursors = objects.filter((o) => o.role === 'cursor'), triggers = objects.filter((o) => o.role === 'trigger');
  const cpts = new Map(curves.map((c) => [c.id, curvePoints(c)]));
  const all = [...cpts.values()].flat().concat(triggers.map((t) => t.position));
  const plan = { title: run.title || 'IanniX score', curves: [], cursors: [], triggers: [], warnings, asked: run.asked };
  if (!all.length) { warnings.push('IanniX: the score has nothing to draw'); plan.stats = { curves: 0, cursors: 0, triggers: 0 }; return plan; }
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  const S = width / Math.max(1e-6, x1 - x0, (y1 - y0) * 1.4), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const place = (p) => [r4(at[0] + (p[0] - cx) * S), r4(at[1] + (p[1] - cy) * S)]; // IanniX is y up, as underspace is
  const color = (o) => (o.color ? '#' + o.color.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('') : null);
  for (const c of curves) {
    const pts = cpts.get(c.id);
    if (pts.length < 2) continue;
    plan.curves.push({ key: c.id, points: pts.map(place), closed: !!(c.closed || c.ellipse), color: color(c) });
  }
  const has = new Set(plan.curves.map((c) => c.key));
  let widest = 0;
  for (const o of cursors) {
    const curve = byId.get(o.curve);
    if (!o.active || !curve || !has.has(curve.id)) { if (!curve) warnings.push(`IanniX: cursor ${o.id} has no curve`); continue; }
    const len = pathLength(cpts.get(curve.id));
    const lap = o.speed == null ? Math.max(0.05, len) : ['auto', 'autolock'].includes(o.speedMode) ? o.speed : Math.max(0.05, len / Math.max(0.001, o.speed));
    const loop = loopOf(o.pattern);
    widest = Math.max(widest, (o.width ?? 1) * S);
    plan.cursors.push({ curve: curve.id, seconds: Math.max(0.05, lap / (run.speed || 1)), loop: loop === 'pingpong' ? 2 : loop === 'loop' ? 1 : 0, width: (o.width ?? 1) * S, color: color(o) });
  }
  const warned = new Set(), warn = (m) => { if (!warned.has(m)) { warned.add(m); warnings.push(`IanniX: ${m}`); } };
  for (const o of triggers) {
    if (!o.active) continue;
    const code = codeFor(o.messages, warn, range === undefined ? [36, 96] : range);
    if (!code) continue;
    // a cursor touches what its bar passes: a trigger is as wide as the widest cursor reaches
    plan.triggers.push({ at: place(o.position), d: r4(Math.max((o.size ?? 1) * S * 0.25, widest, width / 200)), code, color: color(o) });
  }
  if (!plan.cursors.length) warnings.push('IanniX: the score has no cursors, so nothing moves');
  plan.stats = { curves: plan.curves.length, cursors: plan.cursors.length, triggers: plan.triggers.length };
  return plan;
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Make the plan with commands (one batch is the caller's): curves as lines, cursors as
// travelers (a lap in beats at spb seconds a beat), triggers as events. Returns the new ids.
export function applyPlan(plan, call, spb = 0.5, space = null) {
  const ids = new Map(), made = [];
  for (const c of plan.curves) {
    const id = call('line.add', { space, points: c.points, ...(c.closed ? { closed: true } : {}), style: { path: 'straight', width: 1.4, ...(c.color ? { stroke: c.color } : {}) } });
    ids.set(c.key, id); made.push(id);
  }
  for (const t of plan.cursors) {
    const on = ids.get(t.curve);
    if (!on) continue;
    made.push(call('traveler.add', { on, dur: r4(t.seconds / spb), loop: t.loop, size: r4(Math.max(0.2, Math.min(0.6, t.width))) }));
  }
  for (const g of plan.triggers) made.push(call('shape.add', { space, role: 'event', shape: 'ellipse', rect: { cx: g.at[0], cy: g.at[1], w: g.d, h: g.d }, code: g.code, ...(g.color ? { style: { stroke: g.color } } : {}) }));
  return made.filter(Boolean);
}
