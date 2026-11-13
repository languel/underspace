// The parameter rows and the code area, used by the faces on the canvas and
// by the sidebar. Both edit the same object through the same commands.

export function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// Keeps `box` showing one number field per parameter of object `o`.
export function syncParams(box, o, blanket, onParam) {
  const sig = o.id + ':' + blanket.params.map((p) => p.name).join(' ');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren(...blanket.params.map((p) => {
      const row = h('label', 'param'), input = h('input');
      input.type = 'number'; input.step = 'any'; input.dataset.name = p.name; input.title = p.name;
      input.addEventListener('input', () => { const v = Number(input.value); if (input.value !== '' && Number.isFinite(v)) onParam(o.id, p.name, v); });
      row.append(h('span', '', p.name), input);
      return row;
    }));
  }
  for (const input of box.querySelectorAll('input')) {
    if (input === document.activeElement) continue;
    const p = blanket.params.find((q) => q.name === input.dataset.name);
    const v = String(o.params?.[p.name] ?? p.value);
    if (input.value !== v) input.value = v;
  }
}

// A plain code area. Edits are committed shortly after typing stops.
export function codeArea(onCode) {
  const area = h('textarea', 'code');
  area.spellcheck = false;
  let timer = 0;
  const commit = () => { clearTimeout(timer); timer = 0; if (area.dataset.id && area.value !== area.dataset.code) { area.dataset.code = area.value; onCode(area.dataset.id, area.value); } };
  area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(commit, 300); });
  area.addEventListener('blur', commit);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end'); area.dispatchEvent(new Event('input')); }
    if (e.key === 'Escape') area.blur();
  });
  return area;
}

export function syncCode(area, o) {
  if (area.dataset.id !== o.id) { area.dataset.id = o.id; area.dataset.code = ''; area.value = ''; }
  if (area === document.activeElement || area.dataset.code === o.code) return;
  area.dataset.code = o.code; area.value = o.code;
}
