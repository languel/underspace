// Code: the selected object's code and parameters, the same ones its face
// shows on the canvas.

import { h, syncParams, codeArea, syncCode, choice } from '../controls.js';
import { blanketOf, hasCode } from '../object.js';

export function codePanel(el, app) {
  const head = h('div', 'panel-head'), name = h('span', 'name'), params = h('div', 'params'), code = codeArea(app.onCode), error = h('p', 'error');
  let pick = h('span'), id = null, role = null;
  head.append(name, pick);
  el.append(head, params, code, error);
  return {
    update() {
      const one = app.state.selection.size === 1 ? app.get([...app.state.selection][0]) : null, o = one && hasCode(one) ? one : null;
      el.classList.toggle('empty', !o);
      id = o?.id ?? null;
      if (!o) return;
      const b = blanketOf(o);
      name.textContent = o.name || b.name || o.role;
      if (o.role !== role) { // each role has its own presets
        role = o.role;
        const list = app.presetsFor(o), next = choice([['', '·'], ...Object.keys(list).map((k) => [k, k])], '', (k) => { if (id && k) app.onCode(id, list[k]); next.value = ''; });
        next.title = 'Preset'; pick.replaceWith(next); pick = next;
      }
      syncParams(params, o, b, app.onParam);
      syncCode(code, o);
      error.textContent = app.run()?.errors.get(o.id) ?? '';
    },
  };
}
