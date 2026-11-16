// Ask here (/): a field at the pointer that sends a sentence to the assistant (or whatever brain is
// set) with what is there as its starting point: the selection, or else what is under and near the
// pointer. "attach a traveler to this curve", "fill this shape with 20 notes of the scale". A
// quick turn first; it hands itself over to the whole loop when it needs more (agent.js).
// What the brain says shows under the field, then the field goes. Escape closes it.

// stage: the element it sits in; ask(text, here) -> Promise<what it says>, where
// here = { at: [x, y] (stage pixels), ids: the objects it starts from }; nearby(x, y) -> ids.
export function createAskHere({ stage, ask, nearby, selection }) {
  const box = document.createElement('div'), input = document.createElement('input'), note = document.createElement('p');
  box.id = 'askhere'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Ask here');
  input.type = 'text'; input.placeholder = '›'; input.setAttribute('aria-label', 'Ask here'); input.autocomplete = 'off'; input.spellcheck = false;
  note.className = 'palette-note';
  box.append(input, note);
  stage.append(box);
  const history = []; let back = -1, here = null, busy = false, timer = 0;

  function open(x, y) {
    clearTimeout(timer);
    const sel = selection();
    here = { at: [x, y], ids: sel.length ? sel : nearby(x, y) };
    const r = stage.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(x, r.width - 300)) + 'px';
    box.style.top = Math.max(8, Math.min(y + 12, r.height - 60)) + 'px';
    box.dataset.n = here.ids.length; // what it starts from, for the eye: a count in the corner
    box.title = here.ids.length ? here.ids.join(' ') : '';
    note.textContent = ''; box.hidden = false; input.value = ''; back = -1;
    input.focus();
  }
  function close() { box.hidden = true; busy = false; box.classList.remove('busy'); input.blur(); }

  input.addEventListener('keydown', async (e) => {
    e.stopPropagation(); // the canvas's keys are not for this field
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowUp' && history.length) { back = Math.min(history.length - 1, back + 1); input.value = history[history.length - 1 - back]; e.preventDefault(); return; }
    if (e.key !== 'Enter' || busy || !input.value.trim()) return;
    const text = input.value.trim();
    history.push(text); busy = true; box.classList.add('busy'); note.textContent = '…';
    try { note.textContent = (await ask(text, here)) || '✓'; } catch (err) { note.textContent = err?.message ?? String(err); }
    busy = false; box.classList.remove('busy'); input.value = '';
    timer = setTimeout(close, 3500);
  });
  input.addEventListener('blur', () => { if (!busy && !note.textContent) close(); });
  return { open, close, get open_() { return !box.hidden; } };
}

// What "here" means to a brain, in words: the pointer in canvas units, and what it starts from.
// describe(o) -> a short line for an object.
export function hereText(here, toWorld, describe) {
  if (!here) return '';
  const [x, y] = toWorld(...here.at).map((v) => Math.round(v * 100) / 100);
  return `Here: the person asked at the point (${x}, ${y}) on the canvas.` + (here.ids.length
    ? ` "This", "it", "these", "here" mean: ${here.ids.join(', ')} (use these ids).\n` + here.ids.map(describe).join('\n')
    : ' Nothing is there: "here" is that point.');
}
