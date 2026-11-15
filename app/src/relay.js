// The page's end of the relay (app/relay.mjs): while it is on, this tab holds an event stream
// open to the hub on this machine, tells it the commands there are, and answers the calls that
// agents outside the page send, each run through call() under the agent's name. Off by default;
// ?relay in the address, or the relay action, turns it on. Nothing here is needed to draw.

// base: the hub's address; call(name, args, by) and tools() from space.js; onState(state) with
// 'off' | 'waiting' (no hub yet; it keeps trying) | 'on'.
export function createRelay({ base, call, tools, onState = () => {}, onCall = () => {} }) {
  const tab = 't' + Math.random().toString(36).slice(2, 8);
  let es = null, state = 'off', url = base;
  const set = (s) => { if (s !== state) { state = s; onState(s); } };
  const post = (path, json) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
  const plain = (v) => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { return String(v); } };

  async function answer(m) {
    onCall(m, 'begin');
    let out;
    try { out = { id: m.id, ok: true, result: plain(await call(m.name, m.args ?? {}, m.by || 'agent')) }; }
    catch (e) { out = { id: m.id, ok: false, error: e?.message ?? String(e) }; }
    onCall(m, 'end');
    post('/result', out).catch(() => {});
  }
  // the commands as they are now: sent on joining, and again when code tools add or remove some
  const hello = () => post('/hello', { tab, title: document.title, tools: tools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }).catch(() => {});

  function open(to = url) {
    close(); url = to.replace(/\/$/, '');
    set('waiting');
    es = new EventSource(`${url}/events?tab=${tab}`); // it tries again by itself when the hub is not there
    es.onopen = () => { set('on'); hello(); };
    es.onerror = () => set('waiting');
    es.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m?.name) answer(m); };
  }
  function close() { es?.close(); es = null; set('off'); }
  return { open, close, hello, state: () => state, tab };
}
