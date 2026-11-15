// The evaluation's cases: requests a brain should get right, each with a check of what is drawn
// after. Used by app/eval.mjs (in Node, against a model server) and by the eval.run command (in
// the page, against whichever brain the Assistant is set to, the one in the browser included).
// Add a case when a model gets something wrong that it should get right.

// { state, call } from space.js -> [{ name, setup?(), ask, check(say) -> true | what is wrong }]
export function cases({ state, call }) {
  const all = () => [...state.objects.values()], lines = () => all().filter((o) => o.kind === 'line' && !o.bind), shapes = (role) => all().filter((o) => o.kind === 'shape' && (!role || o.role === role));
  const span = (o, k) => { const v = o.points.map((p) => p[k]); return Math.max(...v) - Math.min(...v); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

// { name, setup?(), ask, check() -> true | a string saying what is wrong }
  return [
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
}
