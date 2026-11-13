// The sidebar: the selected object's code and parameters, the same ones its
// face shows on the canvas. Empty unless exactly one code object is selected.

import { h, syncParams, codeArea, syncCode } from './controls.js';

export function createSide(el, { onParam, onCode, presets }) {
  const head = h('div', 'side-head'), name = h('span', 'name');
  const pick = h('select');
  pick.title = 'Preset';
  pick.append(new Option('·', ''), ...Object.keys(presets).map((k) => new Option(k, k)));
  const params = h('div', 'params'), code = codeArea(onCode), error = h('p', 'error');
  head.append(name, pick);
  el.append(head, params, code, error);
  let id = null;
  pick.addEventListener('change', () => { if (id && pick.value) onCode(id, presets[pick.value]); pick.value = ''; });

  function update(o, blanket, message) {
    el.classList.toggle('empty', !o);
    id = o?.id ?? null;
    if (!o) return;
    name.textContent = blanket.name || o.kind;
    syncParams(params, o, blanket, onParam);
    syncCode(code, o);
    error.textContent = message ?? '';
  }
  return { update };
}
