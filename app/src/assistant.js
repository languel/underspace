// The scripted assistant: text in, a plan of commands out, with no model:
//   scripted(text) -> { commands: [{ name, args }], say } | null
// It reads patches written as words ("2 osc into mix into target"). Anything else goes to a
// brain that works through the commands (agent.js, engines.js).

import { PRESETS } from './presets.js';

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
