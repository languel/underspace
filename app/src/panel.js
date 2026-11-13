// The side panel: one place, several panels, a strip of tabs to choose. A
// panel is { id, title, icon, make(el, app) -> { update?() } }; it is built
// the first time it is shown. Clicking the open tab closes the panel.

import { h, glyphButton } from './controls.js';
import { settings, setSetting } from './settings.js';

export function createPanels(tabs, side, app, defs) {
  const made = new Map(), buttons = new Map();
  for (const d of defs) {
    const b = glyphButton(d.icon, d.title, () => (settings.panelOpen && settings.panel === d.id ? close() : show(d.id)));
    buttons.set(d.id, b); tabs.append(b);
  }
  function render() {
    document.body.classList.toggle('noside', !settings.panelOpen);
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(settings.panelOpen && id === settings.panel));
    for (const [id, p] of made) p.el.hidden = id !== settings.panel;
    if (!settings.panelOpen) return;
    const d = defs.find((x) => x.id === settings.panel) ?? defs[0];
    if (!made.has(d.id)) {
      const el = h('div', 'panel panel-' + d.id);
      el.append(h('h2', '', d.title));
      side.append(el);
      made.set(d.id, { el, api: d.make(el, app) ?? {} });
    }
    made.get(d.id).el.hidden = false;
  }
  function show(id) { setSetting('panel', id); setSetting('panelOpen', true); render(); }
  function close() { setSetting('panelOpen', false); render(); }
  render();
  return {
    show, close,
    toggle() { settings.panelOpen ? close() : show(settings.panel); },
    update() { if (settings.panelOpen) made.get(settings.panel)?.api.update?.(); },
  };
}
