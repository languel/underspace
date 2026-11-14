// Properties: the selection, or with nothing selected, the settings of the
// active tool. The same two builders fill the panel and the small copy that
// opens at the pointer (Alt+right-click).

import { h, row, section, glyphButton, numberField, textField, colorField, syncParams, choice } from '../controls.js';
import { ROLES, blanketOf, hasCode, isTarget } from '../object.js';
import { settings, setSetting } from '../settings.js';
import { POINT_KINDS, GLYPH_TITLE } from '../glyphs.js';

const ROLE_ICON = { event: 'event', traveler: 'traveler', ink: 'ink', connector: 'connector', path: 'path', visual: 'visual', target: 'target', code: 'box', score: 'score', grid: 'grid', note: 'note' };
const ROLE_TITLE = { event: 'Event', traveler: 'Traveler', ink: 'Ink', connector: 'Connector', path: 'Path', visual: 'Visual', target: 'Render target', code: 'Code container', score: 'Score', grid: 'Grid frame', note: 'Note' };
// Choose an ink brush and set its parameters. `role` is 'line' or 'plane'.
function brushSection(app, role, id, params, onBrush, onParam) {
  const rows = [row('brush', choice([['', 'plain'], ...app.brushesFor(role).map((b) => [b, app.INK[b].label])], id ?? '', (v) => onBrush(v || null)))];
  for (const s of app.INK[id]?.params ?? []) {
    const r = row(s.label.toLowerCase(), numberField(params?.[s.key] ?? s.default, (v) => onParam(s.key, Math.min(s.max, Math.max(s.min, v))), { step: s.step, min: s.min, max: s.max }));
    r.title = s.doc;
    rows.push(r);
  }
  return section('Brush', ...rows);
}

const shared = (list, get) => { const v = get(list[0]); return list.every((o) => get(o) === v) ? v : undefined; };

const TOOL_TITLE = { point: 'Point', polyline: 'Polyline', polygon: 'Polygon', sculpt: 'Sculpt', select: 'Select', pan: 'Pan', draw: 'Draw', line: 'Straight line', rect: 'Rectangle', ellipse: 'Ellipse', note: 'Note', code: 'Code container', target: 'Render target', score: 'Score' };

// What the active tool will make, and how.
export function toolProps(app, tool) {
  const out = [], check = (key) => { const c = h('input'); c.type = 'checkbox'; c.checked = settings[key]; c.addEventListener('change', () => setSetting(key, c.checked)); return c; };
  const look = [];
  if (['draw', 'line', 'rect', 'ellipse', 'point', 'polyline', 'polygon'].includes(tool)) look.push(row('stroke', colorField(settings.stroke, (c) => setSetting('stroke', c))));
  if (tool === 'point') {
    // the glyph a point is placed with: plain marks, and Midinous's kinds (on a line, a node of that kind)
    const bar = h('div', 'glyph-row');
    bar.append(...POINT_KINDS.map((k) => glyphButton('g.' + k, GLYPH_TITLE[k], () => { setSetting('pointGlyph', k); for (const b of bar.children) b.setAttribute('aria-pressed', String(b.title === GLYPH_TITLE[k])); }, settings.pointGlyph === k)));
    look.push(bar, row('size', numberField(settings.pointSize, (v) => setSetting('pointSize', Math.max(3, Math.min(200, v))), { step: 1, min: 3 })));
  }
  if (tool === 'polygon') look.push(row('sides', numberField(settings.polySides, (v) => setSetting('polySides', Math.max(3, Math.min(24, Math.round(v)))), { step: 1, min: 3, max: 24 })), row('star', check('polyStar')));
  if (['rect', 'ellipse', 'polygon'].includes(tool)) look.push(row('fill', colorField(settings.fill, (c) => setSetting('fill', c))));
  if (tool === 'draw') look.push(row('smooth', check('smooth')), row('simplify', numberField(settings.simplify, (v) => setSetting('simplify', Math.max(0, v)), { step: 0.5, min: 0 })));
  if (look.length) look.push(row('width', numberField(settings.width, (v) => setSetting('width', Math.max(0.5, v)), { step: 0.2, min: 0.5 })));
  if (tool === 'code') look.push(row('preset', choice(Object.keys(app.PRESETS).filter((k) => !['path', 'wave'].includes(k)), settings.codePreset, (v) => setSetting('codePreset', v))));
  if (tool === 'score') look.push(row('brush', choice(Object.keys(app.BRUSHES), settings.scoreBrush, (v) => setSetting('scoreBrush', v))));
  if (tool === 'target') look.push(row('plane', choice(['view', 'front', 'top', 'side'], settings.targetPlane, (v) => setSetting('targetPlane', v))));
  if (tool === 'sculpt') {
    const id = settings.sculpt, t = app.SCULPTS[id], vals = settings.sculptParams[id] ?? {};
    look.push(row('tool', choice(Object.entries(app.SCULPTS).map(([k, v]) => [k, v.label]), id, (v) => setSetting('sculpt', v))),
      row('radius', numberField(settings.sculptRadius, (v) => setSetting('sculptRadius', Math.max(6, Math.min(400, v))), { step: 2, min: 6, max: 400 })),
      row('strength', numberField(settings.sculptStrength, (v) => setSetting('sculptStrength', Math.max(0.05, Math.min(1, v))), { step: 0.05, min: 0.05, max: 1 })));
    for (const s of t?.params ?? []) { const r = row(s.label.toLowerCase(), numberField(vals[s.key] ?? s.default, (v) => setSetting('sculptParams', { ...settings.sculptParams, [id]: { ...vals, [s.key]: Math.min(s.max, Math.max(s.min, v)) } }), { step: s.step, min: s.min, max: s.max })); r.title = s.doc; look.push(r); }
  }
  const brushKey = tool === 'draw' ? 'brush' : ['rect', 'ellipse'].includes(tool) ? 'planeBrush' : null;
  if (look.length) out.push(section(TOOL_TITLE[tool] ?? tool, ...look));
  if (brushKey) {
    const id = settings[brushKey] || null;
    out.push(brushSection(app, brushKey === 'brush' ? 'line' : 'plane', id, settings.brushParams[id], (v) => setSetting(brushKey, v ?? ''), (k, v) => setSetting('brushParams', { ...settings.brushParams, [id]: { ...settings.brushParams[id], [k]: v } })));
  }
  else out.push(section(TOOL_TITLE[tool] ?? tool));
  // the global grid (part of the drawing: grid.set) and how it is shown (a preference)
  const g = app.state.grid, set = (k) => (v) => app.call('grid.set', { [k]: v });
  out.push(section('Grid', row('show', check('grid')), row('snap', check('snap')),
    row('cell', numberField(g.cell, set('cell'), { step: 0.25, min: 0.05 })), row('sub', numberField(g.sub, set('sub'), { step: 1, min: 1 })),
    row('beats a cell', numberField(g.beats, set('beats'), { step: 0.25, min: 0 })), row('bars', numberField(g.bars, set('bars'), { step: 1, min: 0 })),
    row('rows', numberField(g.rows, set('rows'), { step: 1, min: 0 })),
    row('measure', choice([['0', 'along'], ['1', 'right angles'], ['2', 'across']], String(g.metric), (v) => app.call('grid.set', { metric: +v })))));
  return out;
}

// The selected objects. `live` is a container the caller keeps in step with
// the parameters; without one they are filled in once.
export function selectionProps(app, sel, live = null) {

    const ids = sel.map((o) => o.id), one = sel.length === 1 ? sel[0] : null;
    const style = (patch) => app.call('object.style', { ids, style: patch });
    const out = [];
    if (one) out.push(section('', row('name', textField(one.name, (name) => app.call('object.name', { id: one.id, name }), blanketOf(one)?.name || one.role || one.kind))));
    else out.push(section('', h('p', 'muted', `${sel.length} objects`)));

    const kind = shared(sel, (o) => o.kind);
    if (ROLES[kind]) {
      const role = shared(sel, (o) => o.role), bar = h('div', 'glyph-row');
      bar.append(...ROLES[kind].filter((r) => r !== 'traveler' || role === 'traveler').map((r) => glyphButton(ROLE_ICON[r], ROLE_TITLE[r], () => app.setRole(sel, r), r === role)));
      out.push(section('Role', bar));
    }
    if (sel.some((o) => !o.bind && o.kind !== 'group')) {
      out.push(section('Look',
        row('stroke', colorField(shared(sel, (o) => o.style?.stroke ?? null), (c) => style({ stroke: c }))),
        row('fill', colorField(shared(sel, (o) => o.style?.fill ?? null), (c) => style({ fill: c }))),
        row('width', numberField(shared(sel, (o) => o.style?.width ?? 2.2), (v) => style({ width: Math.max(0, v) }), { step: 0.2, min: 0 })),
        ...(sel.some((o) => o.kind === 'line' && !o.closed) ? [row('strokes', (() => { const bar = h('span', 'glyph-row'), straight = shared(sel, (o) => o.style?.path === 'straight'); bar.append(glyphButton('draw', 'Smooth', () => style({ path: null }), straight === false), glyphButton('line', 'Straight', () => style({ path: 'straight' }), straight === true)); return bar; })())] : []),
        row('opacity', numberField(shared(sel, (o) => o.style?.opacity ?? 1), (v) => style({ opacity: Math.max(0, Math.min(1, v)) }), { step: 0.1, min: 0, max: 1 }))));
    }
    const brushable = sel.filter((o) => (o.kind === 'line' && !o.bind) || (o.kind === 'shape' && o.role === 'visual'));
    if (brushable.length && brushable.length === sel.length) {
      const role = shared(sel, (o) => (o.kind === 'line' ? 'line' : 'plane')), id = shared(sel, (o) => o.brush?.id ?? null);
      if (role) out.push(brushSection(app, role, id, one?.brush?.params ?? sel[0].brush?.params, (v) => app.call('object.brush', { ids, id: v }), (k, v) => app.call('object.brush', { ids, params: { [k]: v } })));
    }
    if (one?.rect) {
      const r = one.rect, set = (k) => (v) => app.call('object.resize', { id: one.id, rect: { ...one.rect, [k]: v } });
      const grid = h('div', 'grid4');
      for (const [k, label] of [['cx', 'x'], ['cy', 'y'], ['w', 'w'], ['h', 'h']]) grid.append(row(label, numberField(+r[k].toFixed(3), set(k), { step: 0.1 })));
      out.push(section('Place', grid));
    }
    if (one && blanketOf(one)?.params.length) { const box = live ?? h('div', 'params'); if (!live) syncParams(box, one, blanketOf(one), app.onParam); out.push(section('Parameters', box)); }
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
      const from = h('div', 'glyph-row text');
      for (const [a, label, tip] of [['origin', 'origin', 'The plane passes through the middle'], ['cursor', 'cursor', 'Through the 3D cursor (Shift+right-click sets it)'], ['stroke', 'stroke', 'Through the nearest stroke where you start']]) { const b = h('button', '', label); b.type = 'button'; b.title = tip; b.setAttribute('aria-pressed', String((one.anchor ?? 'origin') === a)); b.onclick = () => app.call('target.set', { id: one.id, anchor: a }); from.append(b); }
      out.push(section('Drawn from', from));
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

export function propertiesPanel(el, app) {
  const body = h('div', 'panel-body'), live = h('div', 'params');
  el.append(body);
  let sig = null;
  const build = (sel) => (sel.length ? selectionProps(app, sel, live) : toolProps(app, app.tool()));

  return {
    update() {
      const sel = [...app.state.selection].map(app.get).filter(Boolean), one = sel.length === 1 ? sel[0] : null;
      if (one && blanketOf(one)?.params.length) syncParams(live, one, blanketOf(one), app.onParam);
      const next = `${app.state.version}|${sel.map((o) => o.id).join()}|${app.tool()}|${app.settingsVersion()}`;
      const typing = body.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (next === sig || typing) return;
      sig = next;
      body.replaceChildren(...build(sel));
    },
  };
}
