# underspace

A drawing-first canvas where every element is an object with code. See
`../HANDOFF.md` section 5c for what is here and what is not.

## Run

From the repository root:

```sh
python3 -m http.server 5310
```

Open <http://127.0.0.1:5310/app/?demo>. Without `?demo` it restores your
last session; `?new` starts empty; `?gl` forces WebGL. `npm test` runs the
unit tests.

## Objects

| Kind | Roles |
| --- | --- |
| line | ink, connector (bound to two ports), path (code that reads or makes the line) |
| shape | visual, code container, render target (a 3D space inside), score (plays the lines drawn in it) |
| group | made by collapsing; its ports are the connectors that were cut |

Code is plain JS. A code container holds either a function body with a
header that declares its ports,

```js
// osc
// out: y
// param: hz 0.2
return { y: Math.sin(t * p.hz * Math.PI * 2) };
```

or a whole p5.js or three.js sketch, which runs as the object's face. In a
sketch, `inp` and `p` hold the inputs and parameters and `out({ y: 1 })`
sets outputs. Paste code on the canvas to make a container from it.

## Keys

The same key can mean different things by context: T is the target tool,
or with a shape selected, makes it a render target.

| Key | Does |
| --- | --- |
| V H D L R O N | select, pan, draw, straight line (Shift: 15° steps), rectangle, ellipse, note |
| B T S | code container, render target, score |
| U | sculpt: reshape lines under the ring; `[` `]` radius, `{` `}` strength, Alt inverts |
| Space (tap) | play or stop the selected scores, or all of them; hold and drag to pan |
| C / T / S / X | selection becomes code (a line: a path) / a render target / a score / plain |
| W | selected line becomes a connector to the nearest ports |
| drag from a port | draw a connector, in any tool |
| G / E | collapse into a group / expand |
| ⌘D | duplicate |
| Enter, Esc | go into the selection / deselect, then go up a level |
| F or 1, ⇧F or 2, + − | fit all, frame the selection, zoom |
| arrows | nudge the selection, or pan |
| [ ] | select previous, next |
| P | next drawing plane of the target under the pointer |
| Alt-drag in a target | turn it |
| ⌘K or / | palette: find a command, or say what to build |
| ⌘Z, ⇧⌘Z | undo, redo |
| \, Tab | side panel, hide the whole interface |
| ⌘; ⌥; ? ⌘, | Code, Properties, Shortcuts, Settings panels |
| ⌘] ⌘[ ⇧H ⇧L | bring to front, send to back, hide, lock |
| ⌘' ⇧⌘' | grid, snap |
| right-click | context menu |
| Alt+right-click | properties at the pointer: the selection's, or the tool's |
| ⇧S | selected lines: smooth or straight strokes |
| right-click a tool | the other tools of its kind, or its settings |

## Brushes

A line or a visual shape can be drawn by an ink brush: charcoal, chalk,
pencil, bristles, oil, marker, ink with pressure, hatch, stipple, wash and
more. Choose one in Properties, in the draw tool's settings (right-click
the tool), or from the palette ("Brush: charcoal"). Brushed marks are
painted on a 2D layer, so they do not appear inside render targets.

## Scores

Draw a score frame (S) and draw lines in it: across is time, up is pitch.
Its code is a brush, chosen in the sidebar; `bpm`, `beats`, `low`, `high`,
`scale` and `grid` are its parameters. It loops without restarting, so
lines drawn while it plays join in on the next pass.

## For agents

`underspace.tools()` lists every command with a JSON schema;
`underspace.call(name, args, by)` runs one. `space.read` returns the
document. `patch.add` builds a wired subscene in one call.

The palette's assistant tries a scripted reading first ("osc -> scale ->
target", "2 osc into mix"). Anything else goes to a local OpenAI-compatible
endpoint (Ollama by default); set it with the palette commands "Assistant:
model endpoint" and "Assistant: model name".
