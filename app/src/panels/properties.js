// Properties: the selection, or with nothing selected, the look that new
// lines and shapes will take.

import { h, row, section, glyphButton, numberField, textField, colorField, syncParams } from '../controls.js';
import { ROLES, blanketOf, hasCode, isTarget } from '../object.js';
import { settings, setSetting } from '../settings.js';

const ROLE_ICON = { ink: 'ink', connector: 'connector', path: 'path', visual: 'visual', target: 'target', code: 'box', score: 'score', note: 'note' };
const ROLE_TITLE = { ink: 'Ink', connector: 'Connector', path: 'Path', visual: 'Visual', target: 'Render target', code: 'Code container', score: 'Score', note: 'Note' };
const shared = (list, get) => { const v = get(list[0]); return list.every((o) => get(o) === v) ? v : undefined; };

export function propertiesPanel(el, app) {
  const body = h('div', 'panel-body'), live = h('div', 'params');
  el.append(body);
  let sig = null;

  function build(sel) {
    const ids = sel.map((o) => o.id), one = sel.length === 1 ? sel[0] : null;
    const style = (patch) => app.call('object.style', { ids, style: patch });
    const out = [];
    if (!sel.length) {
      out.push(section('New marks',
        row('stroke', colorField(settings.stroke, (c) => setSetting('stroke', c))),
        row('fill', colorField(settings.fill, (c) => setSetting('fill', c))),
        row('width', numberField(settings.width, (v) => setSetting('width', Math.max(0.5, v)), { step: 0.2, min: 0.5 }))));
      return out;
    }
    if (one) out.push(section('', row('name', textField(one.name, (name) => app.call('object.name', { id: one.id, name }), blanketOf(one)?.name || one.role || one.kind))));
    else out.push(section('', h('p', 'muted', `${sel.length} objects`)));

    const kind = shared(sel, (o) => o.kind);
    if (ROLES[kind]) {
      const role = shared(sel, (o) => o.role), bar = h('div', 'glyph-row');
      bar.append(...ROLES[kind].map((r) => glyphButton(ROLE_ICON[r], ROLE_TITLE[r], () => app.setRole(sel, r), r === role)));
      out.push(section('Role', bar));
    }
    if (sel.some((o) => !o.bind && o.kind !== 'group')) {
      out.push(section('Look',
        row('stroke', colorField(shared(sel, (o) => o.style?.stroke ?? null), (c) => style({ stroke: c }))),
        row('fill', colorField(shared(sel, (o) => o.style?.fill ?? null), (c) => style({ fill: c }))),
        row('width', numberField(shared(sel, (o) => o.style?.width ?? 2.2), (v) => style({ width: Math.max(0, v) }), { step: 0.2, min: 0 })),
        row('opacity', numberField(shared(sel, (o) => o.style?.opacity ?? 1), (v) => style({ opacity: Math.max(0, Math.min(1, v)) }), { step: 0.1, min: 0, max: 1 }))));
    }
    if (one?.rect) {
      const r = one.rect, set = (k) => (v) => app.call('object.resize', { id: one.id, rect: { ...one.rect, [k]: v } });
      const grid = h('div', 'grid4');
      for (const [k, label] of [['cx', 'x'], ['cy', 'y'], ['w', 'w'], ['h', 'h']]) grid.append(row(label, numberField(+r[k].toFixed(3), set(k), { step: 0.1 })));
      out.push(section('Place', grid));
    }
    if (one && hasCode(one)) out.push(section('Parameters', live));
    if (one?.role === 'note') {
      const text = h('textarea', 'note-text');
      text.value = one.text ?? ''; text.spellcheck = false;
      text.addEventListener('change', () => app.call('object.text', { id: one.id, text: text.value }));
      out.push(section('Text', text));
    }
    if (one && isTarget(one)) {
      const bar = h('div', 'glyph-row text');
      for (const p of ['view', 'front', 'top', 'side']) { const b = h('button', '', p); b.type = 'button'; b.title = `Draw on the ${p} plane`; b.setAttribute('aria-pressed', String((one.plane ?? 'view') === p)); b.onclick = () => app.call('target.set', { id: one.id, plane: p }); bar.append(b); }
      out.push(section('Drawing plane', bar));
    }
    const bar = h('div', 'glyph-row');
    bar.append(
      glyphButton('hide', 'Hide', () => app.call('object.flag', { ids, hidden: true })),
      glyphButton('lock', 'Lock', () => app.call('object.flag', { ids, locked: true })),
      glyphButton('front', 'Bring to front', () => app.call('object.order', { ids, to: 'front' })),
      glyphButton('back', 'Send to back', () => app.call('object.order', { ids, to: 'back' })),
      glyphButton('copy', 'Duplicate', () => app.runAction('copy')),
      glyphButton('remove', 'Delete', () => app.runAction('remove')));
    out.push(section('', bar));
    return out;
  }

  return {
    update() {
      const sel = [...app.state.selection].map(app.get).filter(Boolean), one = sel.length === 1 ? sel[0] : null;
      if (one && hasCode(one)) syncParams(live, one, blanketOf(one), app.onParam);
      const next = `${app.state.version}|${sel.map((o) => o.id).join()}|${settings.stroke}|${settings.fill}|${settings.width}`;
      const typing = body.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (next === sig || typing) return;
      sig = next;
      body.replaceChildren(...build(sel));
    },
  };
}
