// Outliner: every object, nested by the space it is in. Click to select
// (Shift adds), double-click to go to it; the glyphs on the right hide and lock.

import { h, glyphButton } from '../controls.js';
import { blanketOf } from '../object.js';
import { icon } from '../icons.js';

const ICON = { event: 'event', traveler: 'traveler', ink: 'ink', connector: 'connector', path: 'path', visual: 'visual', target: 'target', code: 'box', score: 'score', note: 'note' };

export function outlinerPanel(el, app) {
  const list = h('div', 'tree');
  el.append(list);
  let sig = null;

  function rows(space, depth, out) {
    for (const o of app.state.objects.values()) {
      if (o.space !== space) continue;
      const row = h('div', 'tree-row' + (app.state.selection.has(o.id) ? ' on' : '') + (o.hidden ? ' off' : ''));
      row.style.paddingLeft = 6 + depth * 14 + 'px';
      const glyph = h('span', 'glyph'); glyph.innerHTML = icon(o.kind === 'group' ? 'collapse' : o.shape === 'ellipse' && o.role === 'visual' ? 'ellipse' : ICON[o.role] ?? 'ink');
      const label = h('span', 'label', o.name || blanketOf(o)?.name || (o.role === 'note' && o.text?.split('\n')[0]) || o.role || o.kind);
      row.append(glyph, label,
        glyphButton(o.locked ? 'lock' : 'unlock', o.locked ? 'Unlock' : 'Lock', (e) => { e.stopPropagation(); app.call('object.flag', { ids: [o.id], locked: !o.locked }); }, !!o.locked),
        glyphButton(o.hidden ? 'hide' : 'clean', o.hidden ? 'Show' : 'Hide', (e) => { e.stopPropagation(); app.call('object.flag', { ids: [o.id], hidden: !o.hidden }); }, !!o.hidden));
      row.addEventListener('click', (e) => {
        const ids = new Set(e.shiftKey ? app.state.selection : []);
        if (e.shiftKey && ids.has(o.id)) ids.delete(o.id); else ids.add(o.id);
        app.call('select.set', { ids: [...ids] });
      });
      row.addEventListener('dblclick', () => app.frameIds([o.id], o.rect ? 0.82 : 0.5));
      out.push(row);
      if (o.kind === 'group' || o.role === 'target') rows(o.id, depth + 1, out);
    }
    return out;
  }

  return {
    update() {
      if (sig === app.state.version) return;
      sig = app.state.version;
      const out = rows(null, 0, []);
      list.replaceChildren(...(out.length ? out : [h('p', 'muted', '·')]));
    },
  };
}
