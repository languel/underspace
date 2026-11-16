// WebMCP: the page's commands offered to an agent in the browser itself (a browser's built-in
// agent, or an extension), as tools of the page. No relay, no server. Where the browser has no
// WebMCP nothing happens.
//
// The API (W3C Web Machine Learning group's WebMCP, as shipped behind a flag in Chrome and by the
// MCP-B polyfill): navigator.modelContext (document.modelContext in some drafts) with
// provideContext({ tools }) (replaces the page's tools at once) and registerTool(tool) /
// unregisterTool(name). A tool is { name, description, inputSchema, annotations?, execute(input) },
// and execute returns { content: [{ type: 'text', text } | { type: 'image', data, mimeType }] }.

const READS = /\.(read|get|list|look|state|search|help|status)$/; // commands that only read: told as such

// What a command returned, as tool content: a picture as a picture, the rest as JSON text.
export function content(r) {
  if (typeof r?.image === 'string' && r.image.startsWith('data:image/')) {
    const { image, ...rest } = r;
    return [{ type: 'image', data: image.slice(image.indexOf(',') + 1), mimeType: image.slice(5, image.indexOf(';')) }, { type: 'text', text: JSON.stringify(rest) }];
  }
  return [{ type: 'text', text: r === undefined ? 'null' : typeof r === 'string' ? r : JSON.stringify(r) }];
}

// The tools in WebMCP's shape. call(name, args) runs a command; guard(args, name) refuses what an
// agent may not do (held agents, ids that name nothing, code that cannot compile: agent.js).
export function webTools(list, call, guard) {
  return list.map((t) => ({
    name: t.name.replaceAll('.', '_'),
    description: t.description,
    inputSchema: t.inputSchema,
    ...(READS.test(t.name) ? { annotations: { readOnlyHint: true } } : {}),
    async execute(input) {
      try { guard(input ?? {}, t.name); return { content: content(await call(t.name, input ?? {}, 'webmcp')) }; }
      catch (e) { return { content: [{ type: 'text', text: 'Error: ' + (e?.message ?? e) }], isError: true }; }
    },
  }));
}

// Offer them to mc (the browser's model context). -> how: 'provideContext' | 'registerTool' | ''
export function offer(mc, tools) {
  if (!mc) return '';
  if (typeof mc.provideContext === 'function') { mc.provideContext({ tools }); return 'provideContext'; }
  if (typeof mc.registerTool === 'function') {
    for (const t of tools) { try { mc.unregisterTool?.(t.name); } catch { /* not there yet */ } mc.registerTool(t); }
    return 'registerTool';
  }
  return '';
}

// Find the model context, now or when a polyfill puts it there a little later. onOffered(how).
export function startWebMCP({ tools, call, guard, onOffered = () => {} }) {
  const find = () => navigator.modelContext ?? document.modelContext ?? null;
  let done = false;
  const tryNow = () => { if (done) return; const mc = find(); if (!mc) return; try { const how = offer(mc, webTools(tools(), call, guard)); if (how) { done = true; onOffered(how); } } catch (e) { console.warn('webmcp:', e.message); } };
  tryNow();
  if (!done) { addEventListener('load', tryNow, { once: true }); setTimeout(tryNow, 2000); setTimeout(tryNow, 6000); }
  return { offer: (mc) => offer(mc, webTools(tools(), call, guard)) };
}
