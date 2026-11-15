// The brain in this browser: a language model run by Transformers.js on WebGPU, in a worker so
// the drawing never waits for it. The page talks to it by messages (engines.js, browserEngine):
//   { type: 'load', model, dtype }                 -> 'progress' { text, done } ..., then 'ready' | 'error'
//   { type: 'complete', id, messages, tools, max } -> 'token' { id, text (so far) } ..., then 'reply' { id, text } | 'error' { id, text }
//   { type: 'stop' }                               the reply being written ends where it is
// The model's own chat template writes the tools into the prompt; what comes back is the raw
// text, tool calls and all, for engines.js to read (parseToolCalls).

// Transformers.js and the ONNX runtime's wasm are vendored (vendor/transformers), so only the
// model's weights come from outside, once; after that the brain works offline.
import { AutoTokenizer, AutoModelForCausalLM, InterruptableStoppingCriteria, TextStreamer, env } from '../../vendor/transformers/transformers.min.js';

env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;

let tokenizer = null, model = null, loaded = '';
const stopper = new InterruptableStoppingCriteria();

async function load(id, dtype) {
  if (loaded === id + dtype) return;
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, [p.loaded, p.total]);
    let a = 0, b = 0; for (const [x, y] of files.values()) { a += x; b += y; }
    postMessage({ type: 'progress', text: `${Math.round(a / 1e6)} / ${Math.round(b / 1e6)} MB`, done: false });
  };
  tokenizer = await AutoTokenizer.from_pretrained(id, { progress_callback });
  model = await AutoModelForCausalLM.from_pretrained(id, { dtype, device: 'webgpu', progress_callback });
  loaded = id + dtype;
  postMessage({ type: 'progress', text: '', done: true });
}

// the chat template wants a call's arguments as a mapping, not as JSON text
const forTemplate = (messages) => messages.map((m) => (m.tool_calls ? { ...m, tool_calls: m.tool_calls.map((c) => ({ ...c, function: { ...c.function, arguments: typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function.arguments } })) } : m));

async function complete({ id, messages, tools, max = 1024 }) {
  stopper.reset();
  const inputs = tokenizer.apply_chat_template(forTemplate(messages), { tools, add_generation_prompt: true, return_dict: true, enable_thinking: false });
  const n = inputs.input_ids.dims[1];
  let soFar = '';
  const streamer = new TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: false, callback_function: (t) => { soFar += t; postMessage({ type: 'token', id, text: soFar }); } });
  const out = await model.generate({ ...inputs, max_new_tokens: max, do_sample: false, repetition_penalty: 1.1, stopping_criteria: stopper, streamer });
  const text = tokenizer.batch_decode(out.slice(null, [n, null]), { skip_special_tokens: false })[0];
  postMessage({ type: 'reply', id, text, tokens: n });
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') { await load(m.model, m.dtype); postMessage({ type: 'ready' }); }
    else if (m.type === 'complete') await complete(m);
    else if (m.type === 'stop') stopper.interrupt();
  } catch (err) { postMessage({ type: 'error', id: m.id, text: err?.message ?? String(err) }); }
};
