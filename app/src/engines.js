// Engines: the brains the agent loop (agent.js) can run on. Each is
//   { name, complete({ messages, tools, signal }) -> { content, tool_calls: [{ id, name, arguments }] } }
// with messages and tools in the OpenAI chat shape, which every local server speaks.
//   endpointEngine   a server on this machine or network (Ollama, LM Studio, llama.cpp, vLLM)

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
