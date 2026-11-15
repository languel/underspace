// underspace for Pi: the commands of an open underspace tab as Pi tools, through the relay's hub
// (node app/relay.mjs --hub; open the app with ?relay). Pi has no MCP on purpose, so this is the
// same thing by HTTP. Tools are named after the commands (line_add, space_read, view_look, ...);
// `underspace` runs any command by its own name and is there even before a tab is.
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const BASE = process.env.UNDERSPACE_RELAY ?? "http://127.0.0.1:5311";

async function call(name: string, args: unknown) {
  let r: any;
  try {
    r = await (await fetch(BASE + "/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args: args ?? {}, by: "pi" }) })).json();
  } catch (e: any) {
    r = { ok: false, error: `the underspace relay at ${BASE} did not answer (${e.message}). Start it with: node app/relay.mjs --hub` };
  }
  if (!r.ok) return { content: [{ type: "text" as const, text: "Error: " + r.error }], details: {}, isError: true };
  const v = r.result;
  if (typeof v?.image === "string" && v.image.startsWith("data:image/")) {
    const m = v.image.match(/^data:(image\/\w+);base64,(.*)$/s)!, { image, ...rest } = v;
    return { content: [{ type: "image" as const, data: m[2], mimeType: m[1] }, { type: "text" as const, text: JSON.stringify(rest) }], details: {} };
  }
  return { content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v ?? null) }], details: {} };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "underspace",
    label: "underspace",
    description: 'Run a command in the open underspace tab (a drawing-first environment where every element is a code object) by its name, for example "space.read" (what is drawn), "view.look" (a picture), "tools.search" {query} (find a command), "line.add", "action.run" {id}. Start with space.read and tools.search.',
    parameters: Type.Object({ name: Type.String({ description: "The command, e.g. line.add" }), args: Type.Optional(Type.Any({ description: "Its arguments, an object" })) }),
    async execute(_id, params: any) { return call(params.name, params.args); },
  });
  const known = new Set<string>();
  pi.on("session_start", async () => {
    let tools: any[] = [];
    try { tools = await (await fetch(BASE + "/tools")).json(); } catch { return; }
    for (const t of tools) {
      const name = t.name.replaceAll(".", "_");
      if (known.has(name)) continue;
      known.add(name);
      pi.registerTool({ name, label: t.name, description: t.description || t.name, parameters: Type.Unsafe(t.inputSchema ?? { type: "object", properties: {} }), async execute(_id: string, params: any) { return call(t.name, params); } });
    }
  });
}
