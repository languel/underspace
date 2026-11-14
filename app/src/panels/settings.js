// Settings: this browser's preferences. None of it is part of the drawing.

import { h, row, section, numberField, textField, choice, glyphButton } from '../controls.js';
import { settings, setSetting, resetSettings } from '../settings.js';

export function settingsPanel(el, app) {
  const body = h('div', 'panel-body');
  el.append(body);
  const check = (key) => { const c = h('input'); c.type = 'checkbox'; c.checked = settings[key]; c.addEventListener('change', () => setSetting(key, c.checked)); return c; };
  function build() {
    body.replaceChildren(
      section('Look', row('theme', choice([['auto', 'auto'], ['light', 'light'], ['dark', 'dark']], settings.theme, (v) => setSetting('theme', v))),
        row('code', check('codeOverlay')),
        row('code ground', numberField(settings.codeOpacity, (v) => setSetting('codeOpacity', Math.max(0, Math.min(1, v))), { step: 0.05, min: 0, max: 1 }))),
      section('Mouse', row('wheel', choice([['auto', 'auto'], ['zoom', 'zooms'], ['pan', 'pans']], settings.wheel, (v) => setSetting('wheel', v)))),
      section('Grid',
        row('show', check('grid')),
        row('snap', check('snap'))),
      section('Assistant',
        row('endpoint', textField(settings.assistBase, (v) => { setSetting('assistBase', v); setSetting('assistModel', ''); }, 'http://127.0.0.1:11434')),
        row('model', textField(settings.assistModel, (v) => setSetting('assistModel', v), 'first available'))),
      section('', (() => { const bar = h('div', 'glyph-row'); bar.append(glyphButton('undo', 'Reset settings', () => { resetSettings(); build(); }), glyphButton('clear', 'Clear the canvas', () => app.runAction('clear'))); return bar; })()));
  }
  build();
  void app;
}
