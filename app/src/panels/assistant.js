// The assistant: a conversation with a brain that works in the drawing through the same
// commands the palette has (agent.js). What it does shows as it happens: each command a small
// row (its arguments on hover), each thing it says a line. The palette's "ask" row comes here too.

import { h, glyphButton, choice } from '../controls.js';
import { settings, setSetting } from '../settings.js';

export function assistantPanel(el, app) {
  const log = h('div', 'chat-log'), input = h('textarea', 'chat-input'), bar = h('div', 'glyph-row chat-bar');
  input.rows = 2; input.spellcheck = false; input.setAttribute('aria-label', 'Ask');
  const models = h('span', 'chat-models');
  const stop = glyphButton('pause', 'Stop', () => app.agent().stop());
  const forget = glyphButton('clear', 'Forget this conversation', () => { app.agent().forget(); log.replaceChildren(); });
  bar.append(models, stop, forget);
  el.append(log, input, bar);

  const line = (cls, text, title) => { const d = h('div', 'chat-' + cls, text); if (title) d.title = title; log.append(d); log.scrollTop = log.scrollHeight; return d; };
  let lastCall = null;
  app.agent().on((e) => {
    if (e.type === 'begin') { line('me', e.text); el.classList.add('busy'); }
    else if (e.type === 'say' && e.text) line('say', e.text);
    else if (e.type === 'call') lastCall = line('call', e.name, JSON.stringify(e.args).slice(0, 600));
    else if (e.type === 'result' && lastCall) { lastCall.dataset.ok = e.ok ? '1' : '0'; lastCall.title += '\n→ ' + e.text.slice(0, 600); }
    else if (e.type === 'error') line('err', e.text);
    else if (e.type === 'progress') { let p = log.querySelector('.chat-progress'); if (!p) p = line('progress', ''); p.textContent = e.text; if (e.done) p.remove(); }
    else if (e.type === 'end') el.classList.remove('busy');
  });

  async function send() {
    const text = input.value.trim();
    if (!text || app.agent().busy()) return;
    input.value = '';
    try { await app.ask(text, { panel: true }); } catch { /* shown as an error line */ }
  }
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  // which brain: a server's models, or the one in this browser
  async function pick() {
    const opts = app.engines().map((x) => [x.id, x.title]);
    let list = [];
    if (settings.assistEngine === 'endpoint') { try { list = await app.listModels(); } catch { list = []; } }
    const parts = [choice(opts, settings.assistEngine, (v) => { setSetting('assistEngine', v); pick(); })];
    if (settings.assistEngine === 'endpoint') parts.push(choice(list.length ? list.map((m) => [m, m]) : [['', '–']], settings.assistModel || list[0] || '', (v) => setSetting('assistModel', v)));
    models.replaceChildren(...parts);
  }
  pick();
  return { update() {} };
}
