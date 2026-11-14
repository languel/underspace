// Examples: a collection in nested categories (an example's `path`, 'Music/Grids').
// Click one to add it below what is there, or drag it onto the canvas; it comes in selected.
// Type to find one.

import { h } from '../controls.js';
import { icon } from '../icons.js';
import { EXAMPLES } from '../examples.js';

export function examplesPanel(el, app) {
  const search = h('input'), list = h('div', 'list examples');
  search.type = 'search'; search.placeholder = '⌕'; search.setAttribute('aria-label', 'Search');
  el.append(search, list);
  const open = new Set(['Music', 'Music/Grids']);
  function render() {
    const q = search.value.trim().toLowerCase();
    // a tree of categories: { name, path, kids: Map, items: [] }
    const root = { kids: new Map(), items: [] };
    for (const ex of EXAMPLES) {
      if (q && !`${ex.path ?? ''} ${ex.title}`.toLowerCase().includes(q)) continue;
      let node = root, path = '';
      for (const part of (ex.path ?? 'Other').split('/')) {
        path = path ? `${path}/${part}` : part;
        if (!node.kids.has(part)) node.kids.set(part, { name: part, path, kids: new Map(), items: [] });
        node = node.kids.get(part);
      }
      node.items.push(ex);
    }
    const build = (node, into) => {
      for (const kid of node.kids.values()) {
        const d = h('details', 'cat'), s = h('summary', '', kid.name);
        d.open = !!q || open.has(kid.path);
        d.addEventListener('toggle', () => { if (q) return; if (d.open) open.add(kid.path); else open.delete(kid.path); });
        d.append(s);
        build(kid, d);
        into.append(d);
      }
      for (const ex of node.items) {
        const row = h('button', 'menu-item'), glyph = h('span', 'glyph');
        row.type = 'button'; glyph.innerHTML = icon(ex.icon);
        row.append(glyph, h('span', 'label', ex.title));
        row.addEventListener('click', () => app.addExample(ex));
        // or dragged onto the canvas, to land where it is dropped
        row.draggable = true;
        row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/underspace-example', String(EXAMPLES.indexOf(ex))); e.dataTransfer.effectAllowed = 'copy'; });
        into.append(row);
      }
    };
    list.replaceChildren();
    build(root, list);
  }
  search.addEventListener('input', render);
  render();
}
