#!/usr/bin/env node
// The relay: how an agent outside the page (Claude Code, opencode, Pi, a script) drives an open
// underspace tab with the same commands the palette has. Optional: the app never needs it.
// No dependencies; Node 18 or later.
//
//   node app/relay.mjs           an MCP server on stdin/stdout, and the hub the page connects to
//   node app/relay.mjs --hub     only the hub (for agents that speak HTTP, or to keep it up)
//   --port 5311                  the hub's port (or UNDERSPACE_RELAY_PORT)
//
// The hub listens on 127.0.0.1. A tab opened with ?relay (or with the relay switched on in the
// palette) holds an event stream open to it and answers calls:
//   GET  /status            { tabs: [{ id, title, tools, since }] }
//   GET  /tools             the commands of the newest tab, each with its JSON schema
//   POST /call              { name, args, by?, tab? } -> { ok, result } | { ok: false, error }
//   GET  /events?tab=ID     (the page) calls, as server-sent events
//   POST /hello, /result    (the page) its tools; what a call returned
// Several agents can run at once: the first relay to start is the hub, and the others find the
// port taken and send their calls through it.

import http from 'node:http';
import readline from 'node:readline';

const argv = process.argv.slice(2), flag = (n) => argv.includes(n), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('--port', process.env.UNDERSPACE_RELAY_PORT ?? 5311)), HOST = '127.0.0.1', BASE = `http://${HOST}:${PORT}`;
const REJOIN = 6000; // how long a call waits for a tab to come back
const WAIT = 10 * 60 * 1000; // a call may wait for the person (user.ask), so it is given time
const log = (...a) => process.stderr.write('[underspace relay] ' + a.join(' ') + '\n');

// ---- the hub --------------------------------------------------------------------

const tabs = new Map(); // id -> { id, res, tools, title, since }
const pending = new Map(); // call id -> { resolve, timer }
let seq = 0, onTools = () => {};
const newest = () => [...tabs.values()].filter((t) => t.res).sort((a, b) => b.since - a.since)[0];

async function hubCall({ name, args = {}, by = 'agent', tab }) {
  let t = tab ? tabs.get(tab) : newest();
  // a tab whose stream dropped (a reload, a sleeping laptop) joins again by itself within seconds: wait for it
  for (let i = 0; !t?.res && i < REJOIN / 250; i++) { await new Promise((r) => setTimeout(r, 250)); t = tab ? tabs.get(tab) : newest(); }
  if (!t?.res) return Promise.resolve({ ok: false, error: `no underspace tab is connected. Open the app with ?relay added to its address (for example http://localhost:5310/app/?relay) and try again.` });
  const id = 'c' + (++seq);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: `no answer from the page for ${name} (it may be in a hidden tab, or waiting for the person)` }); }, WAIT);
    pending.set(id, { resolve, timer });
    t.res.write(`data: ${JSON.stringify({ id, name, args, by })}\n\n`);
  });
}
const hubStatus = () => ({ tabs: [...tabs.values()].filter((t) => t.res).map((t) => ({ id: t.id, title: t.title, tools: t.tools.length, since: new Date(t.since).toISOString() })) });
const hubTools = () => newest()?.tools ?? [];

const body = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 64e6) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); req.on('error', reject); });
// Who may talk to the hub. A program on this machine (an agent, curl) sends no Origin and is let
// in. A web page does send one, and only the app's own pages are let in: this machine's, and the
// origins in UNDERSPACE_ORIGINS (comma-separated; by default the deployed copy). Without this any
// site open in the browser could drive the drawing, and so run code in it.
const ORIGINS = new Set((process.env.UNDERSPACE_ORIGINS ?? 'https://languel.github.io').split(',').map((x) => x.trim()).filter(Boolean));
// Two more ways a web page reaches a server on this machine without an allowed Origin, both closed:
//   - a request the browser sends with no Origin at all (an <img> or a plain GET from any site):
//     browsers mark those "sec-fetch-site: cross-site", and such a request is refused. Without this
//     any site could join /events as a tab and swallow the calls meant for the real one.
//   - DNS rebinding (a site's name made to point at 127.0.0.1, so its requests look same-origin and
//     carry no Origin): the Host header then names that site, not this machine, and is refused.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const refused = (req) => {
  const origin = req.headers.origin, host = String(req.headers.host ?? '').toLowerCase();
  if (!HOSTS.has(host)) return `host ${host || '(none)'} is not this machine's relay`;
  if (!allowed(origin)) return `origin ${origin} is not allowed (UNDERSPACE_ORIGINS)`;
  if (!origin && req.headers['sec-fetch-site'] === 'cross-site') return 'a request from another site with no origin is not allowed';
  return '';
};
const allowed = (origin) => { if (!origin) return true; try { const u = new URL(origin); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost') || ORIGINS.has(u.origin); } catch { return false; } };
let CORS = {};
const cors = (origin) => ({ 'access-control-allow-origin': origin || '*', vary: 'origin', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' });
const send = (res, code, json) => { res.writeHead(code, { ...res.cors, 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };

function startHub() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE), origin = req.headers.origin;
    res.cors = CORS = cors(origin);
    try {
      const no = refused(req);
      if (no) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: no })); }
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      if (url.pathname === '/events') {
        const id = url.searchParams.get('tab') || 't' + (++seq);
        res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': hello\n\n');
        const t = tabs.get(id) ?? { id, tools: [], title: '' };
        Object.assign(t, { res, since: Date.now() }); tabs.set(id, t);
        const beat = setInterval(() => res.write(': beat\n\n'), 20000);
        req.on('close', () => { clearInterval(beat); if (tabs.get(id)?.res === res) { tabs.delete(id); onTools(); } log('tab left', id); });
        return log('tab joined', id);
      }
      if (url.pathname === '/hello' && req.method === 'POST') {
        const b = await body(req), t = tabs.get(b.tab);
        if (t) { t.tools = b.tools ?? []; t.title = b.title ?? ''; onTools(); }
        return send(res, 200, { ok: !!t });
      }
      if (url.pathname === '/result' && req.method === 'POST') {
        const b = await body(req), p = pending.get(b.id);
        if (p) { clearTimeout(p.timer); pending.delete(b.id); p.resolve(b.ok ? { ok: true, result: b.result } : { ok: false, error: b.error ?? 'failed' }); }
        return send(res, 200, { ok: !!p });
      }
      if (url.pathname === '/status') return send(res, 200, hubStatus());
      if (url.pathname === '/tools') return send(res, 200, hubTools());
      if (url.pathname === '/call' && req.method === 'POST') return send(res, 200, await hubCall(await body(req)));
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 400, { error: e.message }); }
  });
  return new Promise((resolve) => {
    server.once('error', (e) => { if (e.code === 'EADDRINUSE') resolve(null); else throw e; });
    server.listen(PORT, HOST, () => { log(`hub on ${BASE}`); resolve(server); });
  });
}

// ---- through a hub that is already there ------------------------------------------

const remote = {
  call: (c) => fetch(BASE + '/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }).then((r) => r.json()).catch((e) => ({ ok: false, error: `the relay hub at ${BASE} did not answer: ${e.message}` })),
  tools: () => fetch(BASE + '/tools').then((r) => r.json()).catch(() => []),
  status: () => fetch(BASE + '/status').then((r) => r.json()).catch(() => ({ tabs: [] })),
};

// ---- MCP on stdin/stdout (JSON-RPC, a message a line) ---------------------------------

const mcpName = (n) => n.replaceAll('.', '_');
const FIXED = [
  { name: 'underspace_status', description: 'Whether an underspace tab is connected to the relay, and how many commands it offers. If none is, ask the person to open the app with ?relay added to its address.', inputSchema: { type: 'object', properties: {} } },
  { name: 'underspace_call', description: 'Run any underspace command by its own name (for example "line.add", "space.read", "view.look", "tools.search"), with its arguments. The same as the tools named after the commands; use it when those are not listed yet.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] } },
];
// what a command returned, as MCP content: a picture as a picture, the rest as JSON text
function content(r) {
  if (!r.ok) return { isError: true, content: [{ type: 'text', text: String(r.error) }] };
  const v = r.result;
  if (typeof v?.image === 'string' && v.image.startsWith('data:image/')) {
    const m = v.image.match(/^data:(image\/\w+);base64,(.*)$/s), { image, ...rest } = v;
    return { content: [{ type: 'image', data: m[2], mimeType: m[1] }, { type: 'text', text: JSON.stringify(rest) }] };
  }
  return { content: [{ type: 'text', text: v === undefined ? 'null' : typeof v === 'string' ? v : JSON.stringify(v) }] };
}

function startMcp(hub) {
  const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  let client = 'agent', ready = false, last = '';
  const changed = async () => { const sig = JSON.stringify((await hub.tools()).map((t) => t.name)); if (ready && sig !== last) out({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); last = sig; };
  onTools = changed; setInterval(changed, 3000).unref();
  const handle = async (m) => {
    if (m.method === 'initialize') { client = m.params?.clientInfo?.name ?? 'agent'; return { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'underspace', version: '0.1.0' }, instructions: 'Tools that drive an open underspace tab: a drawing-first environment where every element is a code object. Before building anything that plays, moves or runs code, call code_help with no arguments and follow its recipes: sound here comes only from scores, travelers and joints. Start with space_read (what is drawn) and view_look (a picture of it); tools_search finds a command by what it does; action_list and action_run reach everything a key or a menu does. Every change is recorded in the take under your name and can be undone (action_run id "undo").' }; }
    if (m.method === 'ping') return {};
    if (m.method === 'tools/list') { const list = await hub.tools(); last = JSON.stringify(list.map((t) => t.name)); return { tools: [...FIXED, ...list.map((t) => ({ name: mcpName(t.name), description: t.description || t.name, inputSchema: t.inputSchema ?? { type: 'object', properties: {} } }))] }; }
    if (m.method === 'tools/call') {
      const { name, arguments: args = {} } = m.params ?? {};
      if (name === 'underspace_status') { const s = await hub.status(); return { content: [{ type: 'text', text: JSON.stringify({ hub: BASE, ...s }) }] }; }
      if (name === 'underspace_call') return content(await hub.call({ name: args.name, args: args.args ?? {}, by: client }));
      const t = (await hub.tools()).find((x) => mcpName(x.name) === name);
      return content(await hub.call({ name: t?.name ?? name.replace('_', '.'), args, by: client }));
    }
    if (m.method === 'resources/list') return { resources: [] };
    if (m.method === 'prompts/list') return { prompts: [] };
    throw Object.assign(new Error(`method not found: ${m.method}`), { code: -32601 });
  };
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    if (m.method === 'notifications/initialized') { ready = true; return; }
    if (m.id === undefined || !m.method) return; // a notification, or an answer we did not ask for
    try { out({ jsonrpc: '2.0', id: m.id, result: await handle(m) }); }
    catch (e) { out({ jsonrpc: '2.0', id: m.id, error: { code: e.code ?? -32603, message: e.message } }); }
  }).on('close', () => process.exit(0));
}

const local = { call: hubCall, tools: async () => hubTools(), status: async () => hubStatus() };
const server = await startHub();
if (!server) log(`a hub is already on ${BASE}; sending calls through it`);
if (flag('--hub')) { if (!server) { log('nothing to do'); process.exit(0); } }
else {
  // If the hub this one was sending through goes away (its agent ended), this one becomes the hub:
  // the page keeps trying the same port and finds it.
  const hub = { on: server ? local : remote, call: (c) => hub.on.call(c), tools: () => hub.on.tools(), status: () => hub.on.status() };
  if (!server) setInterval(async () => { if (hub.on === remote && !(await fetch(BASE + '/status').then((r) => r.ok).catch(() => false)) && (await startHub())) hub.on = local; }, 4000).unref();
  startMcp(hub);
}
