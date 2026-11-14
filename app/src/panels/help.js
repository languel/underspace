// Help: every action and its key, from the same table the toolbar and menus
// read, and the gestures that have no key.

import { h } from '../controls.js';
import { icon } from '../icons.js';

const GESTURES = [
  ['Drag from a port', 'draw a connector, in any tool'],
  ['Drag the corner of the selection', 'resize'],
  ['Double-click an object', 'go into it'],
  ['Double-click the canvas', 'fit everything'],
  ['Alt-drag in a render target', 'turn it'],
  ['Wheel', 'pan'],
  ['Pinch, or ⌘ wheel', 'zoom'],
  ['Space-drag, or middle button', 'pan'],
  ['Tap Space', 'play or stop the scores'],
  ['Right-click', 'what can be done here'],
  ['Paste code on the canvas', 'a code container; a p5.js or three.js sketch runs'],
];
const GROUPS = { brush: 'Brushes', tool2: 'Object tools', history: 'History', tool: 'Tools', role: 'Roles', play: 'Sound', edit: 'Edit', plane: 'Drawing plane', add: 'Add', nav: 'Navigate', file: 'File', panel: 'Panels' };

export function helpPanel(el, app) {
  const search = h('input'), list = h('div', 'list');
  search.type = 'search'; search.placeholder = '⌕'; search.setAttribute('aria-label', 'Search');
  el.append(search, list);
  function render() {
    const q = search.value.trim().toLowerCase(), out = [];
    let group = null;
    for (const a of app.actions) {
      if (a.hidden || (q && !a.title.toLowerCase().includes(q))) continue;
      if (a.group !== group) { group = a.group; out.push(h('h3', '', GROUPS[group] ?? group)); }
      const row = h('div', 'menu-item'), glyph = h('span', 'glyph');
      glyph.innerHTML = a.icon ? icon(a.icon) : '';
      row.append(glyph, h('span', 'label', a.title), h('kbd', '', app.keysShown(a)));
      out.push(row);
    }
    const gestures = GESTURES.filter(([a, b]) => !q || (a + b).toLowerCase().includes(q));
    if (gestures.length) out.push(h('h3', '', 'Gestures'), ...gestures.map(([a, b]) => { const row = h('div', 'menu-item two'); row.append(h('span', 'label', a), h('span', 'muted', b)); return row; }));
    list.replaceChildren(...out);
  }
  search.addEventListener('input', render);
  render();
}
