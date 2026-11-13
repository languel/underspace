// patch.add: a whole subscene in one command. Nodes are laid out left to
// right by how far they are from a source, and linked with connectors. This is
// the narrow format the assistant writes, and it is as usable by hand.
//
//   { at: [x, y], nodes: [{ key, role, preset, code, params }], links: ['a.y -> b.x'], collapse, name }

import { state, define, exec, argTypes as T } from './space.js';
import { blanketOf, portPos, parseBlanket, TARGET_INS } from './object.js';
import { PRESETS } from './presets.js';

const SIZE = { code: [2.4, 1.6], target: [5, 3.8], visual: [2, 2] };
const GAP_X = 1.6, GAP_Y = 0.7;
const round = (v) => Math.round(v * 1e4) / 1e4;

// 'a.y -> b.x', 'a -> b' or [from, to]; a missing port means the first one.
export function parseLink(link) {
  const [from, to] = Array.isArray(link) ? link : String(link).split(/\s*(?:->|→|>)\s*/);
  const end = (s) => { const [key, port] = String(s ?? '').trim().split('.'); return { key, port }; };
  return { from: end(from), to: end(to) };
}

// Problems with a patch, as text an assistant can act on. Empty when fine.
export function checkPatch(a) {
  const problems = [], keys = new Set(), ports = new Map();
  if (!Array.isArray(a?.nodes) || !a.nodes.length) return ['nodes must be a non-empty array'];
  for (const n of a.nodes) {
    if (!n.key) problems.push('every node needs a key');
    if (keys.has(n.key)) problems.push(`duplicate key "${n.key}"`);
    keys.add(n.key);
    const role = n.role ?? 'code';
    if (!SIZE[role]) problems.push(`node "${n.key}": role must be code, target or visual`);
    if (role === 'code' && !n.code && !PRESETS[n.preset]) problems.push(`node "${n.key}": give code, or preset one of ${Object.keys(PRESETS).join(', ')}`);
    const b = role === 'target' ? { ins: TARGET_INS, outs: [] } : role === 'code' ? parseBlanket(String(n.code ?? PRESETS[n.preset] ?? '')) : { ins: [], outs: [] };
    if (role === 'code' && n.code && !b.outs.length && !b.ins.length) problems.push(`node "${n.key}": the code needs header comments declaring ports, like "// out: y"`);
    for (const m of String(n.code ?? '').matchAll(/\binp\.([A-Za-z_$][\w$]*)/g)) if (!b.ins.includes(m[1])) problems.push(`node "${n.key}": the code reads inp.${m[1]} but declares no input "${m[1]}"${m[1] === 't' ? ' (time is the variable t, not an input)' : ''}`);
    ports.set(n.key, b);
  }
  for (const l of a.links ?? []) {
    const { from, to } = parseLink(l);
    if (!keys.has(from.key)) problems.push(`link from unknown node "${from.key}"`);
    if (!keys.has(to.key)) problems.push(`link to unknown node "${to.key}"`);
    const src = ports.get(from.key), dst = ports.get(to.key);
    if (src && (from.port ? !src.outs.includes(from.port) : !src.outs.length)) problems.push(`"${from.key}" has no output "${from.port ?? ''}"; its outputs are: ${src.outs.join(', ') || 'none'}`);
    if (dst && (to.port ? !dst.ins.includes(to.port) : !dst.ins.length)) problems.push(`"${to.key}" has no input "${to.port ?? ''}"; its inputs are: ${dst.ins.join(', ') || 'none'}`);
  }
  return problems;
}

define({
  name: 'patch.add',
  doc: 'Add several objects at once, laid out and connected. nodes: [{ key, role: "code" | "target" | "visual", preset or code, params }]. links: ["a.y -> b.x"] (ports optional). collapse: fold the result into one group, named name.',
  args: {
    space: T.space, at: { type: 'array', description: '[x, y] centre of the patch' },
    nodes: { type: 'array', items: { type: 'object' } }, links: { type: 'array', items: { type: 'string' } },
    collapse: { type: 'boolean' }, name: T.str,
  },
  required: ['nodes'],
  run(a) {
    const problems = checkPatch(a);
    if (problems.length) throw new Error(problems.join('; '));
    const links = (a.links ?? []).map(parseLink), at = a.at ?? [0, 0], space = a.space ?? null;
    // column = longest chain of links leading to the node
    const col = new Map(a.nodes.map((n) => [n.key, 0]));
    for (let pass = 0; pass < a.nodes.length; pass++) for (const l of links) if (col.get(l.to.key) <= col.get(l.from.key) && l.from.key !== l.to.key) col.set(l.to.key, Math.min(a.nodes.length, col.get(l.from.key) + 1));
    const cols = [];
    for (const n of a.nodes) (cols[col.get(n.key)] ??= []).push(n);
    const used = cols.filter(Boolean), size = (n) => SIZE[n.role ?? 'code'];
    const widths = used.map((c) => Math.max(...c.map((n) => size(n)[0])));
    const total = widths.reduce((s, w) => s + w, 0) + GAP_X * (used.length - 1);
    const ids = {};
    let x = at[0] - total / 2;
    used.forEach((nodes, i) => {
      const tall = nodes.reduce((s, n) => s + size(n)[1], 0) + GAP_Y * (nodes.length - 1);
      let y = at[1] + tall / 2;
      for (const n of nodes) {
        const [w, h] = size(n), role = n.role ?? 'code';
        const id = exec('shape.add', { space, role, shape: n.shape, code: n.code, preset: n.preset, rect: { cx: round(x + widths[i] / 2), cy: round(y - h / 2), w, h } });
        for (const [name, value] of Object.entries(n.params ?? {})) exec('object.set', { id, name, value: Number(value) });
        ids[n.key] = id;
        y -= h + GAP_Y;
      }
      x += widths[i] + GAP_X;
    });
    for (const l of links) {
      const src = state.objects.get(ids[l.from.key]), dst = state.objects.get(ids[l.to.key]);
      const out = l.from.port || blanketOf(src)?.outs[0], inn = l.to.port || blanketOf(dst)?.ins[0];
      const p = portPos(src, 'outs', out), q = portPos(dst, 'ins', inn);
      if (!p || !q) continue; // no such port: the objects are still there to wire by hand
      const sag = Math.min(0.5, Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.12);
      const points = Array.from({ length: 12 }, (_, i) => { const u = i / 11; return [round(p[0] + (q[0] - p[0]) * u), round(p[1] + (q[1] - p[1]) * u + Math.sin(u * Math.PI) * sag)]; });
      exec('line.add', { space, points, tol: 0.02 });
    }
    let group = null;
    if (a.collapse) group = exec('group.collapse', { ids: Object.values(ids), name: a.name });
    else state.selection = new Set(Object.values(ids));
    return { ids, group };
  },
});
