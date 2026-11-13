// Examples: click one to add it to the canvas.

import { h } from '../controls.js';
import { icon } from '../icons.js';
import { EXAMPLES } from '../examples.js';

export function examplesPanel(el, app) {
  const list = h('div', 'list');
  for (const ex of EXAMPLES) {
    const row = h('button', 'menu-item'), glyph = h('span', 'glyph');
    row.type = 'button'; glyph.innerHTML = icon(ex.icon);
    row.append(glyph, h('span', 'label', ex.title));
    row.addEventListener('click', () => app.addExample(ex));
    list.append(row);
  }
  el.append(list);
}
