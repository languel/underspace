// Docs: what the objects are, how code is written, and every preset, brush
// and command. The lists are generated from the code, so they cannot go stale.

import { h } from '../controls.js';
import { CODE_DOC } from '../codedoc.js';

const OBJECTS = [
  ['line · ink', 'A drawing. It does nothing until it is given a role.'],
  ['line · connector', 'Carries a value from an output port to an input port. Draw from one port to the other, or press W on a line whose ends are near two ports. It keeps its drawn shape and follows its objects.'],
  ['line · path', 'A line with code that reads its own geometry (geom.points, geom.at(u)), or makes it by returning points. Its path output carries the line itself to any input that takes one.'],
  ['shape · visual', 'A rectangle or ellipse to look at, with stroke, fill and opacity.'],
  ['shape · code container', 'Holds a function body, or a whole p5.js or three.js sketch that runs as its face.'],
  ['shape · render target', 'A 3D space. Draw in it on its drawing plane; its spin and tilt inputs turn it.'],
  ['shape · score', 'A frame: the lines inside are played, across as time and up as pitch. Its code is a brush.'],
  ['shape · note', 'Text on the canvas.'],
  ['shape · traveler', 'Moves along a line while playing. Attach one with A on a selected line, or by right-clicking the line. Its outputs x, y and u follow it; dur is the beats for the whole line (0: from its grid), loop is 0 once, 1 loop, 2 there and back.'],
  ['shape · event', 'A region that fires when a traveler enters it, once until it leaves. Its code says what happens: by default a note whose pitch is how high on the path the traveler was. Outputs gate (1 while a traveler is inside) and count.'],
  ['group', 'Made by collapsing a selection. The connectors that were cut become its ports. Zoom in to see what is inside.'],
];
const CODE = `// name
// in: a b
// out: y
// param: gain 0.5
return { y: (inp.a + inp.b) * p.gain };`;
export function docsPanel(el, app) {
  const search = h('input'), body = h('div', 'docs');
  search.type = 'search'; search.placeholder = '⌕'; search.setAttribute('aria-label', 'Search');
  el.append(search, body);

  const topic = (title, ...children) => { const d = h('details'); d.append(h('summary', '', title), ...children); return d; };
  const pairs = (list) => { const dl = h('dl'); for (const [a, b] of list) dl.append(h('dt', '', a), h('dd', '', b)); return dl; };
  const source = (text) => h('pre', '', text);
  const add = (title, run) => { const b = h('button', 'link', title); b.type = 'button'; b.addEventListener('click', run); return b; };

  const topics = [
    topic('Objects', pairs(OBJECTS)),
    topic('Code', h('p', '', 'Code is plain JavaScript. A function body starts with comments that declare its ports and parameters:'), source(CODE), ...Object.entries(CODE_DOC).map(([role, d]) => topic(role, h('p', '', d.what), pairs(d.gets), pairs([['return', d.returns]])))),
    topic('Presets', ...Object.entries(app.PRESETS).map(([k, code]) => { const d = topic(k, source(code)); if (!['path', 'wave'].includes(k)) d.append(add('add', () => app.runAction('add.' + k))); return d; })),
    topic('Ink brushes', h('p', '', 'A line or a visual shape can be drawn by an ink brush (Properties, or the palette: "Brush: charcoal"). Each is a small program with a few bounded parameters.'),
      ...Object.entries(app.INK).map(([k, b]) => topic(b.label, h('p', '', b.doc), pairs(b.params.map((s) => [s.key, `${s.doc} (${s.min} to ${s.max})`]))))),
    topic('Sculpt tools', h('p', '', 'The sculpt tool (U) reshapes lines under its ring: the selected ones, or every line when none is selected. [ and ] set the radius, { and } the strength; Alt inverts.'),
      pairs(Object.values(app.SCULPTS).map((t) => [t.label, t.doc]))),
    topic('Sound brushes', h('p', '', 'A brush is the code of a score. It receives every line in the frame, already read into time and pitch.'), ...Object.entries(app.BRUSHES).map(([k, code]) => topic(k, source(code)))),
    topic('Commands', h('p', '', 'Everything is a command: underspace.call(name, args). The assistant and outside agents use the same ones.'),
      ...app.tools().map((t) => topic(t.name, h('p', '', t.description), pairs(Object.entries(t.inputSchema.properties).map(([k, v]) => [k + (t.inputSchema.required.includes(k) ? '' : '?'), v.description ?? (v.enum ? v.enum.join(' | ') : [v.type].flat().join(' | '))]))))),
  ];
  topics[0].open = true;
  body.append(...topics);

  // Search opens what matches and hides the rest.
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const d of body.querySelectorAll('details')) {
      const hit = !q || d.textContent.toLowerCase().includes(q);
      d.hidden = !hit;
      if (q) d.open = hit;
    }
  });
}
