// The assistant: text in, a plan of commands out. Engines share one shape,
//   plan(text, ctx) -> { commands: [{ name, args }], say } | null
// scripted needs no model; endpoint asks a local OpenAI-compatible server
// (Ollama, LM Studio) for one narrow thing: the arguments of patch.add.

import { PRESETS } from './presets.js';
import { checkPatch } from './patch.js';

const ALIAS = { scene: 'target', '3d': 'target', view: 'target', target: 'target', rect: 'visual', box: 'visual', square: 'visual', visual: 'visual', ellipse: 'ellipse', circle: 'ellipse', code: 'blank' };

// "osc -> scale -> target", "2 osc, ramp into mix", "add a target".
export function scripted(text) {
  const stages = text.toLowerCase().replace(/^\s*(add|make|create|new)\s+/, '').split(/\s*(?:->|→|=>|>|\binto\b|\bto\b|\bthen\b)\s*/).filter(Boolean);
  const nodes = [], cols = [];
  for (const stage of stages) {
    const col = [];
    for (const part of stage.split(/\s*(?:,|\+|\band\b)\s*/).filter(Boolean)) {
      const m = part.match(/^(?:(\d+)\s+|an?\s+|the\s+)?([a-z0-9]+?)s?$/);
      const word = m && (PRESETS[m[2]] || ALIAS[m[2]] ? m[2] : m[2] + 's');
      if (!m || !(PRESETS[word] || ALIAS[word])) return null;
      for (let i = 0; i < Math.min(12, Number(m[1] ?? 1)); i++) {
        const key = word + (nodes.filter((n) => n.key.startsWith(word)).length + 1), kind = ALIAS[word];
        const node = PRESETS[word] ? { key, preset: word } : kind === 'target' ? { key, role: 'target' } : kind === 'blank' ? { key, preset: 'blank' } : { key, role: 'visual', shape: kind === 'ellipse' ? 'ellipse' : 'rect' };
        nodes.push(node); col.push(node);
      }
    }
    cols.push(col);
  }
  if (!nodes.length) return null;
  const links = [];
  for (let i = 0; i + 1 < cols.length; i++) for (const a of cols[i]) for (const b of cols[i + 1]) if (a.role !== 'visual' && b.role !== 'visual') links.push([a, b]);
  // several sources into one node go to its inputs in order
  const count = new Map(), ins = (n) => (n.preset ? (PRESETS[n.preset].match(/^\/\/ in:\s*(.*)$/m)?.[1].trim().split(/\s+/) ?? []) : n.role === 'target' ? ['spin', 'tilt'] : []);
  const wired = links.map(([a, b]) => { const i = count.get(b.key) ?? 0, port = ins(b)[i]; count.set(b.key, i + 1); return port ? `${a.key} -> ${b.key}.${port}` : null; }).filter(Boolean);
  return { commands: [{ name: 'patch.add', args: { nodes, links: wired } }], say: nodes.map((n) => n.key).join(', ') };
}

const SYSTEM = `You build small patches for a visual programming canvas. Reply with one JSON object and nothing else:
{"say": "a few words", "nodes": [{"key": "a", "role": "code", "preset": "osc", "params": {"hz": 0.5}}], "links": ["a.y -> b.x"], "collapse": false, "name": ""}

Rules:
- role is "code" (default), "target" (a 3D view; its only inputs are "spin" and "tilt", it has no outputs) or "visual" (no ports).
- When no preset does what is asked, write "code" for the node yourself.
- A code node has either "preset" or "code". Presets: ${Object.entries(PRESETS).map(([k, v]) => `${k} (${v.split('\n').filter((l) => /\/\/ (in|out|param):/.test(l)).map((l) => l.slice(3)).join('; ')})`).join(', ')}.
- "code" is a JavaScript function body. Its header comments declare ports, for example:
// pulse
// in: x
// out: y
// param: rate 2
return { y: inp.x * (Math.floor(t * p.rate) % 2) };
The first comment is a short name you choose. Header lines hold names only, no notes. The body uses these variables: inp (the declared inputs), p (the declared parameters), t (time in seconds, always available, never an input), mem (an object that persists). Values are numbers.
- links connect an output to an input: "key.out -> key.in". Use only ports that exist.
- "collapse" and "name" belong to the whole reply, not to a node. Set "collapse": true with a "name" only when asked for one reusable thing.`;

export async function listModels(base) {
  const r = await fetch(base.replace(/\/$/, '') + '/v1/models');
  return (await r.json()).data.map((m) => m.id);
}

// One request, and up to two repair rounds if the patch does not check out.
export async function endpoint(text, { base, model }) {
  const url = base.replace(/\/$/, '') + '/v1/chat/completions';
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }];
  for (let round = 0; round < 3; round++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0, response_format: { type: 'json_object' } }) });
    if (!r.ok) throw new Error(`${r.status} from ${base}`);
    const content = (await r.json()).choices?.[0]?.message?.content ?? '';
    let patch, problems;
    try { patch = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)); problems = checkPatch(patch); }
    catch (e) { problems = ['the reply was not JSON: ' + e.message]; }
    if (!problems.length) { const { say, ...args } = patch; return { commands: [{ name: 'patch.add', args }], say: say || '' }; }
    messages.push({ role: 'assistant', content }, { role: 'user', content: 'That has problems: ' + problems.join('; ') + '. Reply with the corrected JSON only.' });
  }
  throw new Error('the model did not produce a usable patch');
}
