// Engines: the brains the agent loop (agent.js) can run on. Each is
//   { name, complete({ messages, tools, signal }) -> { content, tool_calls: [{ id, name, arguments }] } }
// with messages and tools in the OpenAI chat shape, which every local server speaks.
//   endpointEngine   a server on this machine or network (Ollama, LM Studio, llama.cpp, vLLM)
//   browserEngine    a model in this page: Transformers.js on WebGPU, in a worker (brain.worker.js)

const clean = (s) => String(s ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // a thinking model's notes are not its answer

export async function listModels(base) {
  const r = await fetch(base.replace(/\/$/, '') + '/v1/models');
  if (!r.ok) throw new Error(`${r.status} from ${base}`);
  return (await r.json()).data.map((m) => m.id);
}

export function endpointEngine({ base, model, temperature = 0.2 }) {
  const url = base.replace(/\/$/, '') + '/v1/chat/completions';
  return {
    name: model,
    async complete({ messages, tools, signal }) {
      let r;
      try { r = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools, temperature, stream: false }) }); }
      catch (e) { if (signal?.aborted) throw new Error('stopped'); throw new Error(`no answer from ${base} (is the model server running, and does it allow this page's origin?)`); }
      if (!r.ok) throw new Error(`${r.status} from ${base}: ${(await r.text()).slice(0, 200)}`);
      const m = (await r.json()).choices?.[0]?.message ?? {};
      return { content: clean(m.content), tool_calls: (m.tool_calls ?? []).map((c, i) => ({ id: c.id ?? 'call' + i, name: c.function?.name, arguments: c.function?.arguments ?? {} })) };
    },
  };
}

// ---- a model in this page -----------------------------------------------------------

// What a model wrote, read as words and tool calls. Two ways of writing a call are known:
//   <tool_call><function=name><parameter=key>value</parameter></function></tool_call>   (LFM3, Qwen coder)
//   <tool_call>{"name": "...", "arguments": {...}}</tool_call>                           (Hermes, Qwen)
// A parameter's value is JSON where it reads as JSON, else text.
export function parseToolCalls(text) {
  const calls = [], loose = (v) => { try { return JSON.parse(v); } catch { return v; } };
  let rest = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  rest = rest.replace(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g, (_, body) => {
    const f = body.match(/<function=([^>\s]+)>([\s\S]*?)(?:<\/function>|$)/);
    if (f) {
      const args = {};
      for (const m of f[2].matchAll(/<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g)) args[m[1]] = loose(m[2].trim());
      calls.push({ id: 'call' + calls.length, name: f[1], arguments: args });
    } else {
      const j = loose(body.trim());
      if (j && typeof j === 'object' && j.name) calls.push({ id: 'call' + calls.length, name: j.name, arguments: j.arguments ?? j.parameters ?? {} });
    }
    return '';
  });
  return { content: rest.replace(/<\|[^|>]*\|>/g, '').trim(), tool_calls: calls };
}

// One worker and one loaded model for the page. on(event): { type: 'progress', text, done } while it downloads.
let worker = null, ready = null, loadedKey = '', seq = 0;
const waiting = new Map();
export function browserEngine({ model, dtype = 'q4f16', on = () => {} }) {
  const start = () => {
    if (!navigator.gpu) throw new Error('this browser has no WebGPU: a model cannot run in the page here');
    if (!worker) {
      worker = new Worker(new URL('./brain.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') listener(m);
        else if (m.type === 'ready') waiting.get('load')?.resolve();
        else if (m.type === 'reply') waiting.get(m.id)?.resolve(m.text);
        else if (m.type === 'error') (waiting.get(m.id) ?? waiting.get('load'))?.reject(new Error(m.text));
      };
      worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || 'the model worker failed')); waiting.clear(); worker = null; ready = null; loadedKey = ''; };
    }
    if (loadedKey !== model + dtype) {
      loadedKey = model + dtype;
      ready = new Promise((resolve, reject) => waiting.set('load', { resolve, reject })).finally(() => waiting.delete('load'));
      ready.catch(() => { loadedKey = ''; });
      worker.postMessage({ type: 'load', model, dtype });
    }
    return ready;
  };
  let listener = on;
  return {
    name: model.split('/').pop(),
    async complete({ messages, tools, signal }) {
      listener = on;
      // stopping while the model is still coming ends the turn; the download goes on for next time
      await Promise.race([start(), new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true }))]);
      const id = 'r' + (++seq);
      const stop = () => worker?.postMessage({ type: 'stop' });
      signal?.addEventListener('abort', stop);
      try {
        const text = await new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ type: 'complete', id, messages, tools }); });
        if (signal?.aborted) throw new Error('stopped');
        return parseToolCalls(text);
      } finally { waiting.delete(id); signal?.removeEventListener('abort', stop); }
    },
  };
}
