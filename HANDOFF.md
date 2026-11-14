# underspace: handoff

Written 13 Nov 2026, at the end of the design conversation that started this
repo. Read this first. It is self-contained: the design, what exists, what was
checked, and what to do next.

Owner: Liuboto (github.com/languel). Artist and educator; teaches creative
coding, physical computing, mixed reality and creative practice with AI.
Prefers concise, command-focused help and wants gotchas flagged early.

## 1. What this is

underspace is a fresh foundation meant to replace a run of separate tools that
kept converging on the same idea. This folder currently holds **spike A**, a
throwaway that tests one part of the design. It is not the kernel.

### Essence

A drawing-first environment where you draw in two, three or more dimensions,
every visual element is a code object, and a built-in agent helps turn drawings
into working things. It is a teaching tool for people and for AI models.
Minimal, clean, modular, agentic.

1. **Drawing first.** A mark starts as just a drawing. Code is attached later,
   by a person or the agent.
2. **Everything is code.** Every element (mark, box, wire, trigger, path,
   physics body, world) has source you can read, fork and rewrite.
3. **One space, many views.** Marks live in a space with named channels
   (x, y, z, time, pressure, anything). The 2D canvas, the 3D scene and the
   timeline are projections of the same marks.
4. **The drawing is the score.** A *reading* says what the geometry means
   (x is time, y is pitch); a *brush* realizes it as ink, sound, motion or
   physics.
5. **Objects have boundaries.** Each object has a Markov blanket of parameters
   and interfaces (active inference as structure, not mathematics), nests
   inside others, and is viewed at different scales by zooming.
6. **Process is recorded.** Everything done is a take: replayable, editable on
   a timeline, exportable. One take serves as lesson, demonstration,
   evaluation and training data.
7. **Agentic.** Everything a person can do is a command the agent can call; an
   agent works within one object's boundary at a time.

Guiding example: someone draws a graphic score in the manner of Xenakis's
*Pithoprakta*. It is just a drawing. They select the lines and, with the
agent, implement the code that realizes it.

Reference points, as existence proofs only and **not** as source: cables.gl
(a successful browser patching platform), Unit (collapse a graph into a unit
and open it again). The philosophy to keep is Artist Model Studio's: clean,
minimal, live drawing as code.

## 2. Hard constraints

- Runs as a static site on GitHub Pages. No server is ever required.
- Models download to the browser (ONNX on WebGPU), hosted on Hugging Face,
  cached locally. Node is fine as an optional local sidecar, never a
  requirement.
- three.js **r187**, WebGPU renderer and TSL, WebGL 2 backend as fallback.
  p5.js for livecoding.
- Three engine tiers behind one interface, plus a no-model tier: scripted;
  in-browser ONNX (LFM3, Qwen); local endpoint (Ollama, OpenAI-compatible);
  external agent over MCP/WebMCP (Claude, Pi, opencode).
- Flat by default. No mandatory scenes, boards or stages (AMS's hierarchy was
  too prominent). Stages and reasons are optional metadata on takes.
- The existing apps keep working. Reuse or rebuild clean from any of them.

## 3. The model

**Space.** A point is a record of named channels. `x, y, z, t` are
distinguished; others are free. A path is a sequence of points.

**Object** (the one primitive). Every element has:

| Part | What it is |
| --- | --- |
| Geometry | Its points or region. Readable by its code. Optional. |
| Blanket | Inputs, outputs, parameters. The only way in or out. |
| Interior | Nothing (an inert mark), code, a reference to shared code (a brush), or a space of more objects. |
| Face | How it looks per zoom level: far (mark), middle (blanket as ports and parameters), near (interior). |
| Expectations | Optional checks that say whether it is working. |

Faces: point (control, trigger), line (stroke, wire, timeline), plane (surface,
viewport, 3D world), box (explicit ports). **Collapse** folds a selection into
one object whose blanket is the cut wires; **expand** reverses it.

**View.** An object that projects the space to fewer dimensions: canvas
(orthographic), scene (perspective), timeline (onto `t`), or a reading (any
remapping of channels).

**Brush.** Shared code that realizes paths into a medium. Defined once,
referenced by many marks, receives a selection as a batch.

**Kernel services.** One clock (objects are static, pure/seekable, or
stateful); six wire types (texture, signal, data, event, audio, object
reference); one command registry for UI, palette, shortcuts, WebMCP, MCP relay
and agent; takes; a flat text form for a space; one three.js scene as renderer.

**Music.** Quantization is snapping along a channel and belongs to the
reading: time to a beat grid, pitch to a scale. Store the raw drawing and snap
on read. A scale is a list of pitches (fractions allowed). Tempo, meter, root
and scale are context a nested space inherits. Schedule sound on the audio
clock; the picture follows it.

**Agent.** Scoped to one object's blanket and interior. Loop: inspect,
propose, preview, check against expectations, commit or repair. Small models
get narrow typed formats and few tools at a time. Learning in order of cost:
(1) brushes, objects and notes saved into the project; (2) retrieval over
takes; (3) LoRA from takes. Only (1) and (2) are assumed.

**Rule against bloat.** A new capability is an object, brush or view type in
its own file. Nothing enters the kernel until two of them need it.

## 4. Where to take things from

All under `~/dev/`. Reviewed during the design conversation (docs, layout,
dependencies; not every file).

| Piece | Source | Note |
| --- | --- | --- |
| Drawing tools, brushes as code, score, command registry/MCP | `artistmodelstudio` | Philosophically the cleanest; vanilla JS, ~780 tests |
| Takes, recorder, history, timeline, keyframes, video export | `artistmodelstudio` | `docs/recording-system.md`; format `ams-take`; p5comp already consumes it |
| 3D drawing: placement rules, stroke geometry, modifiers | `threegrease` | Feature-rich but chaotic; mine, do not port wholesale |
| Scene editing, entity scripts, publishing | `threeditor` | Fork of the three.js r187 editor; clean, tested on students |
| Wire semantics (texture/signal/data), operators, transport | `genereti` | The closest existing thing to the patching side, hosted in ComfyUI |
| Livecode nodes | `underscores`, `genereti` | |
| Model engines, cache probe, autoload | `seloai` | Take `src/ai/modelCache.ts` and the worker protocol; not `brainRouter.ts` |
| Agent loop, sandboxed preview | `threecoder` | `playground/studio/` |
| Circuit simulation | `p5comp` | |
| Seekable performance documents | `motionbrickhouse` `motion/` | Also shows a module attaching to threeditor through four hooks |

## 5. What is in this folder (spike A, "the space")

Static, no build. `python3 -m http.server 5310`, open
`http://127.0.0.1:5310/`. Add `?gl` to force WebGL. `npm test` runs the
reading tests (Node 22+, no dependencies). See `README.md` for a walkthrough.

| File | Role |
| --- | --- |
| `src/space.js` | State, command registry, take (record, replay, load) |
| `src/reading.js` | Pure: channels to time and pitch, grid and scale snapping |
| `src/brushes.js` | Brush presets as source text (glissando, pizzicato, clusters) |
| `src/audio.js` | Transport on the audio clock; compiles and runs the brush |
| `src/views.js` | One three.js scene, canvas and scene cameras, picking, TSL colours |
| `src/main.js` | Wiring and UI |
| `vendor/three/` | r187 builds and the few addons used |
| `test/reading.test.js` | Unit tests for the reading (`npm test`) |
| `test/smoke.mjs` | Browser run: draw, select, play, replay, screenshots (needs `puppeteer-core` and Chrome; see its header) |

How it maps to the design:

- Points are `[x, y, z, drawTime, pressure]`. Draw on a front, top or side
  plane at a depth, in either view.
- `shown(pt, view)` in `views.js` is the projection: the scene view can put
  draw time on the depth axis.
- `read(marks, reading, { bpm })` is the reading. Marks are never changed.
- A brush is a function body `(voices, ctx)` compiled with `new Function`.
- Every mutation goes through `call(name, args, by)` in `space.js` and is
  recorded as a clip `{ t, name, args, by }`. `window.underspace` exposes
  `call`, `commands()`, `state`, `take`.

Checked:

- 8 unit tests pass.
- Headless Chrome on the WebGL 2 backend: drawing in both views, box
  selection, play and stop, live reading changes, projection switch, brush
  error reporting, preset switch, take replay restoring the same state.
- The owner has run it and found it promising.

Not checked: the WebGPU backend by automated test; sound by ear in tests; pen
pressure; touch; dark theme; Safari and Firefox.

Deliberately missing: undo, project save, editing a mark after drawing,
boxes and wires, zoom levels, collapse and expand, pressure-varying width,
paint brushes, the agent, a timeline editor.

Known shortcuts to undo before any of this becomes kernel code:

- The take format is `underspace-take`, simpler than and incompatible with
  `ams-take`. Adopt the AMS format.
- Any change while playing restarts the loop from the top.
- Each mark gets its own material and two line objects (one per view). Fine
  for a spike, not for hundreds of marks.
- Line width is constant; `Line2` cannot vary it along a stroke.
- `replay` resets reading, brush and bpm to defaults by hand; a real take
  needs a baseline document.

## 5b. Spike B, "the object" (`spike-b/`)

Same server, open `http://127.0.0.1:5310/spike-b/` (`?demo` builds a small
patch, `?new` starts empty, `?gl` forces WebGL). It shares `vendor/three/`
with spike A and nothing else. `spike-b/README.md` has the keys.

One canvas. Everything on it is an object in the sense of section 3:

- **A mark** is inert until code is attached (C); then its far face is still
  the drawing, and its code can read its own geometry (`geom.at(u)`).
- **A box** is code. Its blanket is read from header comments in the code
  (`// in:`, `// out:`, `// param:`), so ports and parameter fields are
  automatic: no face is designed per type.
- **Three faces by size on screen**: far (a small block, or just the ink),
  mid (ports and parameters), near (the code, editable in place). The same
  code is in the sidebar when the object is selected.
- **A drawn line whose ends land on an output and an input becomes a wire.**
  The drawn points are kept; what is shown is the drawing carried by the
  similarity that puts its ends on the two ports, so it follows its objects
  and keeps its hand-drawn shape. A new wire into an input replaces the old
  one, which stays as a plain mark.
- **Collapse (G)** folds a selection into a group; each cut wire becomes a
  port on the group. Zoom into the group and its contents are there, in
  their own coordinates. **Expand (E)** puts them back.
- **A scene** is an object whose interior is a 3D space, drawn into its
  rectangle by a perspective camera. Strokes drawn inside it are 3D points
  (on the plane facing the camera). Its inputs `spin` and `tilt` turn it.
- Code objects run once a frame; a wire carries last frame's value.
- Every change is a command in the take; undo replays the take without its
  last change; the take is kept in localStorage between visits.

| File | Role |
| --- | --- |
| `src/object.js` | The object record; blanket from code; rectangles, port positions, nesting transform |
| `src/bind.js` | Wires: the fit, nearest port, binding a drawn line |
| `src/collapse.js` | Collapse and expand |
| `src/space.js` | State, commands, take, undo |
| `src/run.js` | Runs code objects, resolves wires through group ports |
| `src/presets.js` | Starting code |
| `src/view.js` | three.js: ink on an orthographic canvas, a perspective view per scene object |
| `src/faces.js`, `src/side.js`, `src/controls.js` | DOM faces on the canvas, the sidebar, the fields both share |
| `src/main.js`, `src/icons.js` | Layout by zoom, tools, glyph toolbar, keys |
| `test/object.test.js` | 8 tests: blanket, fit, binding, collapse and expand, values through a group, undo |

Checked: the 8 unit tests; in a real browser on the **WebGPU** backend, by
pointer: placing a box, drawing a wire between ports (and the replaced wire
becoming a mark), a stroke inside the scene, marquee select, collapse,
zooming into the group, moving a box with its wire following, undo, hiding
all panels. Not checked: WebGL, expand by key, pen and touch, light theme,
Safari and Firefox, many objects.

What it says about the design:

- Ink and 3D in three.js with boxes and text as DOM laid over it works and
  was cheap. The cost: DOM is always above the ink, and each visible box is
  an element repositioned every frame.
- A blanket declared in the code's header makes faces automatic.
- Nested local coordinates work as plain scale-and-offset per group.

Shortcuts taken (do not carry into the kernel as they are):

- One frame of delay per wire instead of ordering the graph.
- All ink is rebuilt on any change; all points are transformed every frame.
- Undo truncates the take, so the undone steps are not in the record.
- No redo, no resize, no rename, no copy; boxes cannot go inside a scene and
  nothing inside a scene can be selected; a group's ports are fixed when it
  is collapsed.
- The code area is a plain textarea (the kernel should reuse the AMS or
  underscores editor). Code runs in the page, unsandboxed; an endless loop
  hangs the tab.

### Questions for the owner about spike B

1. Do the three faces switch at the right moments, and is zoom the right
   way to open an object, or do you also want to open one in place without
   zooming?
2. Does a drawn wire feel right (drawn anywhere near two ports, keeps its
   shape, follows)? Should ports be wanted before they exist, i.e. drawing
   to a box creates the port?
3. Is a group you zoom into what you meant by nesting, or should the
   interior open somewhere else (a panel, a tab)?
4. Is the scene-as-an-object right, or do you miss a large docked 3D view?
5. Is the header-comment blanket (`// in:`, `// out:`, `// param:`) an
   acceptable way to declare ports, compared with AMS's `@param`?

## 5c. The app (`app/`), started 13 Nov 2026

The owner found spike B very promising and asked for the full
implementation. `app/` is that: it began as a copy of spike B's proven
parts and is **not** a throwaway. Open `http://127.0.0.1:5310/app/`
(`?demo`, `?new`, `?gl` as before). `app/README.md` has the keys.

What the owner asked for, and where it is:

| Asked | Where |
| --- | --- |
| Everything reachable by gesture, shortcut, assistant and outside agent | One registry: `define()` and `call()` in `src/space.js`. One action table (`ACTIONS` in `src/main.js`) feeds the toolbar, keys, context menus and palette. `underspace.tools()` lists every command with a JSON schema; WebMCP registration is attempted when the browser has it. |
| Context-dependent gestures | Each action has `when(ctx)`; the first action bound to a key whose context holds runs (T is the target tool, or "make this shape a target"). A drag from a port draws a connector in any tool; the corner of the selection resizes; Alt-drag in a target turns it. |
| A line is a connector or a path; a shape is a visual, a render target or a code container | `kind` (line, shape, group) plus `role`, changed in place by `object.role`. See the header of `src/object.js`. |
| Command palette that builds elements or whole subscenes from conversation | `src/palette.js` (⌘K or /). `src/assistant.js`: a scripted engine ("2 osc into mix into target") and a local OpenAI-compatible endpoint. Both produce the arguments of one command, `patch.add` (`src/patch.js`), which lays out and wires a subscene and is checked before it runs; a failed check goes back to the model, up to two times. |
| Context menus, navigation and tool shortcuts | `src/menu.js`; the `nav` group of `ACTIONS`. |
| The same vocabulary in 3D | Inside a target the draw, rectangle and ellipse tools work on its drawing plane (view, front, top, side; P cycles). The results are 3D lines. |
| JS stays the language; paste whole p5.js or three.js sketches | `src/sketch.js`: a code container whose code is a standalone sketch runs in its own frame as its face; `inp`, `p` and `out()` connect it to its ports. Paste code on the canvas to make one. |
| A path made by code, or drawn and then given the role; a path sends itself to an input | A path's code may return `points` (the `wave` preset) and is then drawn as those. Connectors carry numbers or paths; the `path` preset outputs `path`, the `follow` preset takes one. |

Added in a second pass the same day:

- **Scores** (the *Pithoprakta* example): a shape with the `score` role is a
  frame; the lines in it are read with across as time and up as pitch
  (`src/score.js`, from spike A's reading, now relative to the frame).
  Its code is a brush (`src/brushes.js`: glissando, pizzicato, clusters);
  tempo, length, range, scale and grid are parameters in the brush's
  header. `src/sound.js` schedules one pass at a time and asks for the
  score afresh each pass, so the loop never restarts and what is drawn
  while it plays is heard from the next pass (the owner's answer 3). Its
  `pos` output can drive other objects. Space (a tap) plays and stops.
- **Duplicate** (⌘D, `object.copy`), with contents and inner connectors.
- Each role keeps its own code when an object changes role and back.

Added in a third pass (the UI):

- **Islands.** File menu, play, undo, redo and palette at the top left;
  tools with stroke and fill swatches in the middle; panel tabs at the top
  right; zoom and grid at the bottom left. All built from `ACTIONS`.
- **Side panel** (`src/panel.js`, one file per panel in `src/panels/`):
  Code, Properties, Outliner, Examples, Docs, Shortcuts, Settings. Docs and
  Shortcuts are generated from the presets, brushes, command registry and
  action table, so they cannot go stale.
- **Look and organisation as commands:** `object.style` (stroke, fill,
  width, opacity), `object.name`, `object.flag` (hidden, locked),
  `object.order`, `object.text`. Fills are drawn in three.js in document
  order.
- **More tools:** pan (H), straight line (L, Shift holds 15° steps), note
  (N). A dot grid that follows the view, and snap to it.
- **Settings** (`src/settings.js`) live in localStorage, apart from the
  take: theme, grid, snap, the look of new marks, the assistant's endpoint.

Added in a fourth pass (toolbars after AMS):

- **Islands move.** Each has a dotted grip: drag to place it, double-click
  to send it home. Positions are a setting.
- **Tool stacks.** Tools of a kind share a button (draw and straight line;
  rectangle and ellipse; code container, render target and score). Click
  picks the one shown; click again or right-click for the others. An
  action joins a stack by its `stack` key.
- **Properties at the pointer.** Alt+right-click on the canvas opens a
  small Properties there: the selection's, or with nothing selected the
  active tool's settings. Right-clicking a tool button opens that tool's
  settings. `selectionProps` and `toolProps` in `src/panels/properties.js`
  fill both this and the panel.
- **Smooth lines.** A drawn stroke is thinned to the points that carry its
  shape (`simplify`, a setting in pixels) and shown as a centripetal
  Catmull-Rom curve through them (`smooth`). The stored points are not
  changed. `style.path: 'straight'` shows them as they are; ⇧S toggles.

Added in a fifth pass (AMS brushes and sculpt, on a 2D ink layer):

- **Decision (owner, 13 Nov 2026):** brushed marks are painted on a 2D
  canvas under the three.js one, not as textures in the scene. So they
  exist on the flat canvas and in groups, not inside render targets, and
  ink has two renderers: plain lines in three.js, brushed ones in 2D.
- `src/ink/walk.js` and `src/ink/texture.js` are unchanged copies of AMS's
  `src/process/` files. `src/ink/brushes.js` is AMS's brush kit with 19
  brushes (ink, pen, speed, restate, zigzag, inner, dotted, arcs, flat,
  hatch, stipple, charcoal, chalk, pencil, bristles, oil, marker, wash,
  dot); `src/ink/sculpt.js` its ten sculpt tools. Left out of both: score
  markers, images, sources, the brush and sculpt libraries, brushes
  written in the app.
- `src/ink/layer.js` maps objects to what a brush sees: 64 brush units per
  canvas unit, y down, points as `[x, y, ms, pressure]`.
- A line or a visual shape carries `brush: { id, params }` (`object.brush`).
  A drawn line also keeps `pen`, the time and pressure of each point: pen
  pressure, or with a mouse a slower hand presses harder.
- Sculpt (U) reshapes the selected lines, or all lines in the space when
  none is selected; one undo step per stroke (`line.set`). `[` `]` set the
  radius and `{` `}` the strength while the tool is active.
- A press now lays out first if the frame loop is behind, so commands and
  gestures in quick succession (an agent, a hidden tab) see current state.

Added in a sixth pass (14 Nov 2026):

- **Wheel and pinch.** On the canvas a pinch (or ⌘ wheel) zooms about the
  pointer, a mouse wheel zooms, a trackpad's two fingers pan. A mouse
  wheel is told from a trackpad by `wheelDeltaY` in steps of 120; that is
  a heuristic, so Settings → Mouse can force zoom or pan.
- **Render targets navigate as in threeditor's Blender mode**
  (`editor/js/EditorControls.js` there): middle-drag orbits, Shift pans,
  Ctrl zooms; Alt+left-drag stands in for the middle button (its
  "emulate 3-button mouse"). Over a target that is selected or open, two
  fingers orbit, Shift+two fingers pan, pinch or wheel zooms. 1, 3, 7 are
  front, side and top views; Home resets. The camera is stored on the
  target (`az`, `el`, `dist`, `center`) as one command per gesture.
- **3D pencil placement after threegrease** (`src/tools/projection.ts`
  there): the drawing plane (view, front, top, side) passes through the
  origin, the 3D cursor (Shift+right-click in a target sets it), or the
  nearest stroke point where the stroke begins, held for the stroke, so
  new strokes take their depth from existing ones. Not brought over:
  surface raycast (there are no meshes yet), the magnet and snapping of
  the cursor, eased and locked depth, guides, primitives, the eraser.
- **Travelers and events** (`src/play.js`, after AMS's
  `docs/notes/paths-travelers-triggers.md`, itself after IanniX). Any line
  is a path. A traveler (`traveler.add`, A on a selected line, or the
  context menu) is a shape on a line that moves while playing, with
  outputs x, y, u and parameters dur, loop, start. An event (shape role,
  tool Y) fires once when a traveler enters it, latched until it leaves;
  the test is swept along the stretch travelled, so a fast traveler does
  not skip a thin event. Its code gets `ev`, `p`, `mem` and
  `note(midi, velocity, seconds)`; outputs gate and count. Space starts
  travelers and scores together. Not yet: travelers inside render
  targets, playing a line at the speed it was drawn, MIDI out, crossing
  events on lines, exit events, one shared clock with scores.

Added in a seventh pass (14 Nov 2026):

- **One set of navigation hands for the canvas and targets.** Alt+Shift-drag
  pans both (as do middle-drag and Space-drag on the canvas); Ctrl+middle or
  Alt+Ctrl-drag zooms both. A pinch, by trackpad (Ctrl+wheel in Chrome and
  Firefox, gesture events in Safari) or by touch, zooms the camera of the
  render target under the pointer (selected or not; the owner asked that a
  pinch inside a frame zoom only inside it), and the canvas anywhere else; a touch
  pinch in a target also pans its camera with the fingers' midpoint.
- **The points tool** (Shift+V, stacked with Select; `src/points.js`): the
  stored control points of the selected lines, or of every line, as
  handles (the first is round). Hover reads out index, position and pen
  pressure. Press to pick (Shift adds), box to pick many, ⌘A picks all
  shown, drag moves them (in a target, on the drawing plane through each
  point), Delete removes them (a line left with one point goes), Escape
  unpicks. Which points are picked is view state, not in the take; edits
  go through `line.set`. Lines that code makes show no handles. Not yet:
  inserting points, Bézier tangents, editing a shape's outline.

Added in an eighth pass (14 Nov 2026):

- **Grab, rotate, scale as in Blender** (`src/transform.js`, after
  threeditor's `editor/js/ModalTransform.js` and its Blender keymap). G, R,
  S with a selection, or with points picked in the points tool. X, Y, Z
  hold to an axis (Shift+axis: the plane without it, in a target; the same
  key again lets go); a typed number sets the amount; Shift is fine, Ctrl
  steps (grid, 15°, tenths); click or Enter accepts, right-click or Escape
  cancels; G, R, S switch mid-way. In a target grab moves on the plane
  through the pivot facing the view, rotate turns about the line of sight
  unless an axis is given. Shift+D duplicates and grabs. A readout at the
  bottom shows the state as glyph, axis and amount. Whole objects commit
  as `object.transform` (pivot, d, angle, axis, s; a shape's centre moves,
  its size scales, a quarter turn swaps its sides; shapes do not rotate);
  points as `line.set`. Keys moved for it: collapse is ⌘G (was G), expand
  ⌘⇧G or E, make score has no key (S scales); R and S without a selection
  are still the rectangle and score tools.
- **Context menu after AMS's** (`contextItemsBase` in its
  `src/workbench/app.js`): a header naming what is under the pointer, then
  Attach an event here / a traveler here / to the nearest line, transform,
  Convert to ›, Path code ›, Sculpt ›, Brush ›, Play, group, Duplicate,
  Copy as › (JSON, SVG, p5 code, code), Simplify › (lightly, moderately,
  strongly), Snap › (points to grid, tidy, position top left or centre,
  quantize 2× and 4×), Arrange › (front, forward, backward, back), Hide,
  Lock, Show code / properties / outliner, Delete; on empty canvas Add ›,
  Paste here, grid and snap. Menus have submenus (`menu: 'Name'` on an
  action puts it in one). ⌘C copies the selection as JSON (with what is
  inside, travelers on it and connectors between) and ⌘V pastes it at the
  pointer (`object.paste`). New commands: `object.transform`,
  `object.paste`, `traveler.attach`, `object.order` forward and backward.
  `src/selection.js` holds snapping and SVG/p5 output. Not ported: PNG
  copy, bake, assets, stages, masks, boards, solo, Midinous nodes, bodies.
- **Pinch.** A synthetic Ctrl+wheel zooms as it should. The owner reported
  pinch not working in the desktop app's browser pane; that pane was
  serving stale cached scripts (`python3 -m http.server` sends no cache
  headers), so reload hard (⌘⇧R) after changes. Whether that pane turns a
  trackpad pinch into Ctrl+wheel at all is not yet known.

Added in a ninth pass (14 Nov 2026):

- **The hold menu** (`src/pie.js`): while drawing, hold still for 450 ms
  and a ring of glyphs opens at the pointer (a marking menu, glyphs with a
  tip for the one pointed at). Let go on a glyph and the stroke becomes
  that, in one undo step; let go in the middle and it stays ink. The ring
  is the `PIE` list in `main.js`, each an action (so each also has a menu
  entry under Turn into ›, a palette entry, and works on any selected
  line): make path, attach a traveler here, travel the nearest line,
  turn into an event, turn into the shape it looks like (a closed stroke
  recognised as ellipse or rectangle), render target, code container,
  straighten, simplify. Only what applies to the stroke shows. Not yet:
  the ring for the line and shape tools, in targets beyond straighten,
  and connectors to the nearest ports.
- Fixed: simplifying a stroke whose ends meet dropped all its middle
  points (`simplifyIndex` measured from a zero-length baseline).

Added in a tenth pass (14 Nov 2026), joints and constraints:

- **The owner's aim:** working with lines should feel like drawing, or
  like building with wire and solder: lines brought together connect. After
  Sutherland's Sketchpad (github.com/alexwarth/sutherland: constraints
  relaxed until satisfied), for curves in 2D and 3D, with the junctions of
  Midinous (languel/midinojs: travelers choose a way at each node). It
  brings together three earlier starts: Sketchpad's constraints;
  threegrease's object constraints (`src/score/constraints.ts`: "traveler
  and trigger are properties, not kinds") and Poly Build's welds; and
  Midinous's routing.
- `src/joints.js` holds all of it. A **joint** is an object (`kind:
  'joint'`, role `junction`): places on two or more lines (`{ id, u,
  slide? }`, u by length along the curve as shown; with slide, anywhere on
  that line) that are held together. A joint with one place and `fix` is a
  pin. A line may keep rules: `keep: { horv, length }`.
- **Curves keep their drawn shape.** The solver (Levenberg-Marquardt over
  each line's two handles, numerical derivatives, with a small pull back to
  where things were, so the least change wins) moves each curve as a whole,
  by the similarity that carries its handles. This is how a connector
  already keeps its hand-drawn shape. It is the same in a render target
  (3D).
- **Kernel hook:** after every recorded command, `space.js` calls
  `settle()` and holds what that command moved (a command may declare
  `hold(args)`). A take therefore replays to the same drawing, and undo
  stays exact. While something is dragged (move, G R S, points), what is
  joined to it follows live (`follow()` in `main.js`, same solver, not a
  command).
- **Touch connects.** Joins happen when the end of a drawn stroke or a
  straight line touches another line, another line's end, or a joint. They
  also happen when a line is dropped, transformed or point-edited so that
  its end touches. A ring at the pointer shows what will be joined while
  drawing. Holding Ctrl or ⌘ while letting go does not join.
- **Constrain ›** in the context menu: Join where it crosses (also in the
  hold ring, replacing "code container"), Join where its ends touch, Pin
  here, Keep level or plumb, Keep its length, Let go. You can click a joint
  to select it, drag it to move what it holds, delete it, or open its code.
- **Travelers in networks** (`play.js`): a traveler on a line that has
  joints keeps its own state (line, distance, direction) and speed. At
  each joint it reaches, the joint's code runs as `(ways, ev, p, mem)`;
  ways are listed straightest first, and returning nothing goes straight
  on. At a line's end without a joint, `loop` applies. Without joints, a
  traveler still uses the old pure `progress(t)`.
- **Roles leave geometry alone** (the owner: converting must not change the
  shape). "Make it an event" makes the stroke itself an event: crossing it
  fires it, and so does entering what it encloses if it is closed. "Travel
  the nearest line" makes the stroke itself the traveler: it moves along
  the line in its own shape. `traveler.attach` accepts any line or shape.
  "Turn into the shape it looks like", "render target" and "code
  container" still replace the stroke, because that is what they mean.
- **Code on objects:** `;` shows or hides the code on objects you zoom into
  (Settings → Look also has "code ground", the opacity behind it). In an
  ellipse the code sits in the largest rectangle that fits inside it.
- New commands: `joint.add`, `joint.free`, `line.keep`. Tests:
  `app/test/joints.test.js` (solver in 2D and 3D, commands with undo, pins
  and level, crossings, ways, a traveler through a junction, roles that
  keep shape).
- Checked in the browser by scripted pointer events: joins drawn as a T
  and end to end, dragging a line with the joined ones following, a
  traveler running through two joints, selecting a joint and seeing its
  code, `;`, a joint inside a render target, and an ellipse event's code.
  Not checked: a real pen or trackpad; many lines at once (the solver is
  dense, so expect it to slow past a few dozen joined lines).
- Not yet: travelers inside render targets; split routing (one traveler
  into many) and portals from Midinous; a traveler's own code choosing its
  way; equal-length, parallel and angle constraints; joints for shapes
  (only lines are curves); bending, where a curve deforms instead of moving
  rigidly; joining at crossings in 3D; the ring for the line and shape
  tools.

Added in an eleventh pass (14 Nov 2026), branching and events that act:

- **Junction behaviours** (`JUNCTIONS` in `joints.js`, the preset menu in
  the Code panel when a joint is selected): round robin (the default),
  chance (weights for straight, left, right and back), random, straight,
  split, reflect, stop, every (every nth traveler turns). A junction's
  code may return a way or its index, an array of them (the traveler
  splits), `'back'`, or `'stop'`.
- **Riders** (`play.js`): a traveler is one or more riders, each with a
  line, a distance along it, a direction and a speed. All travelers now
  move this way, not only those on lines with joints. Copies made by
  splitting are drawn faintly as the traveler (`ghosts`). A copy that runs
  off an open end goes away. A traveler has at most 64 riders.
- **Events act on travelers.** Besides `note()`, an event's code can call
  `ev.reflect()`, `ev.stop()`, `ev.go()`, `ev.split()` and `ev.speed(k)`.
  Presets (`EVENTS`): note, reflect, split, stop, speed, note and reflect.
- **Make event keeps the look** (the owner: make the mark into an event,
  do not attach one). One "Make event" action covers lines and plain
  shapes, in Convert to › and the hold ring. A line keeps its stroke. A
  visual made an event or a traveler gets `keeps` and is drawn as it was.
  Either one flashes when a traveler reaches it. Events made with the
  event tool, or with "Attach an event here", still look like events.
- Tests: round robin at a T, a split, an event reflecting a traveler, a
  shape keeping its look. 58 in all.
- Fixed: reflect stuck at an event line. A rider passes a little beyond
  the line within a frame, so when sent back it crossed it again at once.
  Now a rider that is reflected, stopped or split is put back where it
  crossed, and a line it crossed waits until the rider is clear of that
  spot (`firedAt` in `play.js`). A copy made by split starts out latched.

Added in a twelfth pass (14 Nov 2026), the timeline, music and recording:

- **References** (the owner): IanniX scores, as carried into underscores
  (`~/dev/underscores/notes/iannix.md`: one transport, and each object
  reads its local time from it), and midinojs (Midinous: named scales,
  distance as time in beats, junction nodes). The scales and the MIDI file
  writer come from Artist Model Studio, which took them from Midinous.
- `src/music.js`: the musical context `{ bpm, meter, scale, root, low, high }`.
  It is document state, set by the `music.set` command and reset with the
  space. It provides the 37 Midinous scales or your own list of steps (fractional
  semitones for other tunings), `degrees`, `snap`, `step` (an interval in
  degrees), `pitch(v)` (0..1 to a note of the scale across the range),
  note names, `bbt` (bar.beat.sixteenth) and `beatsOf` ('8n', '2 bars',
  '1.5s').
- `src/transport.js`: one clock (seconds) with play, pause, seek, stop,
  a loop range in beats and a record flag. It is view state, not in the
  take. `main.js` keeps `spb` in step with the tempo. Seeking, rewinding or
  coming round the loop reruns the travelers silently from 0 to the new
  time (`catchUp`), because riders carry state.
- **Travelers run on beats:** `dur` is now in beats (default 8), `at` is
  the beat a traveler sets off on, and `speed` (grid cells a beat) is
  Midinous's distance-as-time. A traveler paused partway keeps its place.
  Event and junction code also receive `pitch`, `step` and `snap`. The
  default event is `note(pitch(ev.y), 100, p.dur)`; new presets are fixed
  note and step up.
- **Recording:** while ● is on, every note played (by events and
  junctions) is collected. When recording stops it becomes a clip
  (`clip.add`, in `state.clips`: `{ at, notes: [{ beat, midi, vel, len }]
  }`). Clips play on the transport and move with `clip.set` (at, name,
  muted, remove). `src/midi.js` writes a .mid file of them and sends notes
  to Web MIDI.
- `src/timeline.js`: the strip along the bottom (⌥T). Its head holds the
  transport and the musical context; below are the ruler (click or drag to
  seek, Shift-drag to loop) and lanes for each traveler (its passes),
  score (its passes) and clip (its notes, drawn as a small piano roll).
  Clips can be dragged; right-click a clip to mute, export or delete it.
- Keys: with Alt (Option) the physical key is read, because a Mac types
  another character (Alt+T is †). This also fixes the earlier `alt+;`
  and `alt+z`.
- Fixed: a looping traveler's jump from the end back to the start was
  treated as travel and fired every event it passed over. The trail is
  now broken at a jump.
- Checked in the browser: recording a looping traveler across two line
  events on a pentatonic minor scale made a clip, and the timeline showed
  the traveler's passes, the clip's notes and the playhead. Tests: scales,
  time, a MIDI file, the transport's pause and loop, music and clip
  commands with undo, `at` and `speed`, the loop jump. 66 in all.
- **The making lane** (a thirteenth pass, the same day): the first
  timeline lane is the take, one tick per step (what one undo takes away),
  placed by when it was made with pauses over 1.5 s shortened, and fitted
  to the lane. It has its own time, not the music's, because time in the
  work and time of its making stay apart. `history()` and `travel(k)` in
  `space.js` move the line between done and undone steps and rerun the take
  once, so dragging along the lane is undo and redo, and an edit made there
  continues from there. Clicking the lane's name replays the making at its
  pace (`replay()` in `main.js`); a press or a key stops it. Ticks are
  coloured by kind: drawing in ink, joints in hot, music in accent. Hover
  names the step.
- **Gestures in time** (a fourteenth pass): replaying the making draws
  each stroke out point by point on its pen times; a stroke longer than
  8 s is sped up to fit. A traveler with `drawn` above 0 moves at the pace
  the hand drew its line (`drawnSpeed` in `play.js`, read from the line's
  `pen`; a pause in the hand is slow, not a stop), scaled by `drawn` and by
  any `ev.speed`.
- **Gate notes:** `note(m, v, 'gate')` in an event's code holds the note
  (`sound.hold`, `midiOut.hold`) while the rider is inside a shape or a
  closed line, and lets go when it leaves. An open line has no inside, so
  there it is a short note. Pausing lets go of every held note
  (`playEngine.quiet()`), and a held note is recorded with the length it
  sounded. Event preset: gate.
- **Scores on the transport** (a fifteenth pass): a score no longer runs
  its own clock. Pass k begins at k times its length on the timeline.
  `scoreTick` (`main.js`, every 40 ms and on play) schedules passes 0.25 s
  ahead with `sound.schedulePass`. A pass joined partway (after a pause, a
  seek or the loop coming round) plays only what is still to come, and a
  change of tempo or length reschedules. `sound.silence` cuts a score.
  Brush headers default to following the timeline (bpm 0, low and high 0,
  scale -1 for its scale and root, read through `score.js`'s new `steps`
  and `root`). Scores keep their own values where set.
- **Piano roll** (`src/roll.js`, a sixteenth pass): double-click a clip
  (or use its menu) to edit its notes under the timeline on the same
  ruler. Moving, resizing, box-picking, adding, deleting, transposing by
  scale degree or octave, nudging and quantizing each commit one
  `clip.set { notes }`. The keys work only while the pointer is over the
  timeline. The pure helpers `transpose`, `quantize` and `shift` are
  tested.
- **Event semantics after AMS** (a seventeenth pass): `ev.type` is
  'enter', 'cross' (an open line, with `ev.dir` for which way) or 'exit'
  (when the event has the parameter `exit 1`). A `lockout` parameter
  (seconds) holds an event off after it fires. `ev.launch(line, dir)` sets
  a new rider off on a line, by id or name: Midinous's emitting nodes.
  `rng()` is seeded (mulberry32), so a performance from the start is the
  same each time; the junction presets use it. `cc(n, v, ch)` and
  `note(m, v, d, channel)` are available to event and junction code.
- **Instruments** (`src/instruments.js`, an eighteenth pass): small Web
  Audio voices (triangle, sine, square, saw, pluck, bell, pad, drums), one
  per MIDI channel. Channel 10 is drums (the note picks kick, snare, hat or
  tom). They are set with `music.set { channels }` or the instrument glyph
  on the timeline's head. Defaults: 1 triangle, 2 pluck, 3 bell, 4 pad, 10
  drums. Notes keep their channel through recording, clips and MIDI export.
  Score brushes still make their own sound.
- **Render and import** (a nineteenth pass): "Render to a clip" plays the
  drawing offline (`renderNotes` in `play.js`: the same engine, seeded,
  so it is the live performance without waiting) over the loop range, or
  8 bars, and reads each score's passes; the notes become a clip.
  "Import a MIDI file" reads any Standard MIDI File (`readNotes` in
  `midi.js`: format 0 or 1, every track and channel, running status) into
  a clip at the playhead's bar. Its tempo and meter go to the timeline
  when there are no clips yet.
- **IanniX import** (`src/iannix.js`, a twentieth pass): AMS's importer
  (itself from Underscores) runs a .iannix score's code, after a confirm,
  because it is code; collects its `run()` commands; and builds curves,
  cursors and triggers. `iannixPlan` fits them to the view; `applyPlan`
  makes them with commands. Curves become lines (Béziers, ellipses, point
  lists and equations sampled). Cursors become travelers (setSpeed auto N
  is a lap of N seconds, setPattern sets the loop). Triggers become event
  circles whose code is their messages (`note`, `notef` with pitch over
  36..96, `cc`, `ccf`; trigger_value_x/y is `ev.x`/`ev.y`). A trigger is as
  wide as the widest cursor's bar. Not carried over: OSC, cursor messages,
  textures, 3D. There is no IanniX example folder on this machine, so it
  was tested with hand-written scores.
- **Midinous import** (`src/nous.js`, a twenty-first pass): a midinojs or
  original Midinous project becomes joints and lines. Each node is a joint
  holding its paths' ends, whose code is the node: note (with chance, and
  relative notes as `step(ev.last, p.by)`), cc, counter (every nth),
  terminator; then robin, split, random or portal over the paths leaving
  it. Paths are lines drawn across first, up first or straight, so their
  length in cells is their time. Start nodes set a traveler off at one grid
  cell a beat (speed 1). The project's tempo, scale and root go to the
  timeline. Junction code now gets `ev.last` (the rider's last note) and
  `ev.spb`. Robin goes the straightest way first, not in the file's order.
  Gates and LEDs only pass travelers on.
- **Timeline polish** (a twenty-second pass). With the pointer over the
  timeline: F fits everything, = and − zoom about the playhead, ← → step a
  beat (Shift a bar), Home goes back to the start. The loop's ends drag on
  the ruler. Clicking the position switches it between bars and seconds.
  The metronome glyph (a setting) clicks each beat on the audio clock, the
  bar's first beat higher. With it on, recording from rest begins after a
  bar of clicks.
- **Sound out and clips** (a twenty-third pass): "Export the sound" renders
  the loop range (or 8 bars) offline: travelers, events, junctions,
  recorded clips through the instruments, and scores through their own
  brushes, in an OfflineAudioContext, into a 16-bit WAV
  (`sound.renderAudio`, `sound.wav`). A clip's menu adds Duplicate after
  it (on the next bar) and Rename, and Delete removes the picked clip
  while the pointer is over the timeline.
- **Grids** (`src/grid.js`, a twenty-fourth pass, after AMS's `pathTime`
  in `src/score/compile.js` and Midinous): a grid quantizes space (`cell`,
  snap points `sub`, `snap`), time (`beats` a cell of path, measured by
  `metric`: along it, at right angles or across only, rounded to `bars`)
  and pitch (`rows`: scale degrees a cell up). There is one global grid,
  now document state (`state.grid`, `grid.set`; the old grid size setting
  is gone, its cell is the global grid's) and any number of grid frames
  (role `grid`, drawn like a score frame, its settings its parameters;
  presets in the Code panel: a cell a beat, midinous, whole bars, score
  rows, half beats, triplets). What lies in a frame uses the smallest frame
  holding it (`gridAt`).
  - A traveler with `dur 0` takes its time from its line's grid, line by
    line through junctions (`pathBeats`). Attaching a traveler in a
    timing grid gives it `dur 0`.
  - An event knows `ev.col` and `ev.row`; in a grid with rows, `pitch()`
    is the row's note (that many degrees above the lowest note).
  - The line tool's ends, a stroke's ends and dragged points snap to the
    grid they are in, when it snaps.
  - Constrain › Fit its length to the bars scales a curve so its time is
    whole bars.
  - Global grid fields are in Properties (with nothing selected).
- **Examples in a collection:** each example has a `path`
  ('Music/Grids'), and the Examples panel shows nested folding categories
  with a search. New examples: rhythm from length, curves in whole bars,
  rows as degrees, two grids at two speeds, a Midinous grid, the drawn
  pace, lines that touch connect, travelers through junctions, events that
  reflect and split, an IanniX rosette, just intonation in a score. A test
  builds every example and plays the grid ones.
- **Debugging and the reported crash** (a twenty-fifth pass). The crash
  could not be reproduced: every example on one canvas plays at 60 fps,
  and undo or a history scrub takes a few ms. Fixed what could bring a page
  down:
  - an error in a frame stopped drawing for good: `frame()` now catches,
    logs and goes on;
  - a score back from a hidden tab scheduled every pass it missed at once:
    those are now skipped;
  - a traveler timed by a grid that measures its line as nothing got a
    near-infinite speed: a path now takes at least a quarter beat;
  - riders that split leave crossing marks that piled up: these are now
    capped.
  `src/debug.js`: ⌥D shows the frame rate and what each part of a frame
  costs (play, code, layout, lines, ink, scenes, faces, panels), with
  objects, riders, take steps, the last settle's time and the error count.
  Errors (from frames, `window.onerror`, rejected promises) are kept in
  localStorage across reloads. A heartbeat marks a session that ended
  without closing, which the next load reports. "Copy a debug report" puts
  it all on the clipboard as JSON; "Clear the error log" empties it.
- **Points, nodes and their glyphs** (a twenty-sixth pass, after AMS's
  point, line and plane and its node brush): `src/glyphs.js` draws a point,
  a joint or a node as dot, ring, plus, or a Midinous kind: note square, cc
  circle, gate D, LED diamond, counter hexagon, switch octagon, terminator
  ×, anchor dot.
  - A `point` kind (`point.add`; role ink or event: a traveler passing
    within its half size fires it) carries its glyph and scales with the
    view.
  - `object.glyph` sets the glyph of points and joints. Giving a joint a
    Midinous kind also gives it that kind's code (`nodeCodeFor`, unless
    its code was written by hand).
  - A joint may have one place (`node: true`): a node on a line, which runs
    its code when a traveler passes and lets it go on.
  - Tools: Point (I, in the line stack; its settings list the glyphs and a
    size). On a line it puts a node of that kind; on a joint or point it
    retypes it; elsewhere it puts a point. Polyline (click corners;
    double-click or Enter ends; Escape drops; ending on the first corner
    closes and fills it). Polygon (in the shape stack; sides and star in
    its settings; also inside render targets).
  - Context menu: Point › with the eleven types. View: Show where lines
    cross marks unjoined crossings (computed once per change, bounded).
- **Node logic** (a twenty-seventh pass, after AMS's `src/score/nodes.js`):
  - The engine keeps a light per node or event. Their code gets
    `light(beats | true | false)` and `lit(name)` (by name or id).
  - A note is lit while it sounds; an LED for its beats (or, with
    `toggle 1`, on and off in turn); a switch while it is on; a counter
    or an anchor for a moment as a traveler goes on.
  - A switch flips with each traveler and, with `block 1`, stops it while
    off. A gate reads its inputs' lights (`type` 0 and, 1 or, 2 xor,
    3 nand, 4 nor, 5 xnor; its inputs a list of names in its code) and
    stops a traveler unless they agree.
  - Lit nodes are drawn lit (`played.lit`). On import, a Midinous gate's
    inputs are the nodes whose logic paths lead to it.
  - **Drivers and signals,** as in AMS: a traveler placed by hand
    (`drives 1`, the default) is not stopped by node logic: 'stop' sends
    it the straightest way on. Signals (`drives 0`: what Midinous start
    nodes send out) and split copies stop, and a copy that stops goes
    away (so splitting goes on). 'end' (the terminator, and the stop
    junction preset) stops any traveler.
  - Examples: Music › Nodes (a switch takes turns, a gate reads a light,
    nodes on a drawn line) and Drawing › Points.
- **Fixes** (14 Nov 2026):
  - The timeline's play button lost its clicks: its glyph was rewritten
    every frame, between the press and the release. It is now written only
    when it changes.
  - Examples overlapped, because `below()` put an example's centre a fixed
    distance under the drawing. Now an example is built, measured and
    moved as a whole: just below everything on the canvas when clicked, or
    centred where it is dropped when dragged from the panel. It comes in
    selected.
- **The crash, found** (14 Nov 2026): a memory leak of about 55 MB a second
  while anything played (15 MB to 1.6 GB in 30 s, then "This page
  crashed"). While anything moves, the drawing changes every frame, and
  `view.setLines` made new Line2 objects every frame. Their geometry was
  disposed, but the WebGPU renderer keeps what it needs for every object it
  has drawn. Now each group (the canvas, each target, the previews) keeps
  its lines and fills and reuses them. Positions are written into buffers
  that only grow (to the next power of two; `instanceCount` and the draw
  range say how much is used), and what is not drawn this frame is hidden.
  Memory now stays near 20 MB while playing. If many objects are ever made
  per frame somewhere else, the same rule applies: reuse, do not remake.
- **Sliding along a line, quantized** (after AMS's Play tool `snapU`):
  dragging a node (a one-place joint) or a traveler slides it along its
  line (`joint.slide`, or the traveler's `start`). With quantizing on (Q,
  or right-click › Quantize to choose 1/16 … a bar), it lands on divisions
  of the time it takes to get there along the line. That time is the line's
  lap: from a traveler on it, else its grid, else a grid cell a beat
  (`lapBeatsOf`, `quantU`). Ctrl while dragging does the opposite of the
  toggle. Ticks across the line show the divisions (taller on beats,
  tallest on bars) while sliding, and while a node or traveler is selected
  with quantizing on. The point tool's nodes land on the divisions too.
  Fixed: a selected joint's centre counted as the resize corner, so
  dragging it resized it.
- **3D, first pass:** a render target drawn (or made) over marks takes them
  into its 3D scene (`target.take`, `takeInto`). These are the lines lying
  wholly inside its frame; they go onto its front plane, the frame's
  longer side `TARGET_SPAN` (8) units wide, keeping their joints and
  travelers. Right-click › Take out of the 3D scene puts them back flat.
  Travelers run on 3D lines (the engine already measured in 3D; `moved`
  now carries z) and are drawn as small stars in the target. Nodes on 3D
  lines play, as on the canvas. Brushes are dropped from lines taken in,
  because brushes paint only the flat canvas.
- **Smooth however near** (14 Nov 2026): `smooth()` works in 2D and 3D and
  takes a number of pieces per stretch, a number or a function. The
  renderer asks for as many as a stretch is long on screen
  (`stepsOnScreen`: a piece every 3 px, 2 to 160), and redraws when the
  zoom (or a target's camera distance) changes by about a fifth. No points
  are added to the drawing. Curves in render targets are now smoothed too.
  `curveOf` keeps a fixed six pieces a stretch, so travel, joints and
  events do not change with zoom.
- **A render target has code** (`TARGET_PRESETS` in `object.js`): it runs
  each frame like any code object and returns how its scene is seen,
  `{ spin, tilt, zoom, center }`, on top of the camera that navigation
  sets. Its header declares its ports and parameters, so new controls are
  an `// in:` or `// param:` line away. Presets: spin and tilt (the
  default: inputs spin and tilt, parameters orbit and zoom), orbit,
  breathe, look (where it looks, from inputs). Its code is in the Code
  panel; its face shows only the scene.
- **3D, second pass: the magnet** (`src/magnet.js`, after threegrease's
  `snapWorldPoint` in `src/tools/snapping.ts`). Where a point placed in a
  render target lands: on a stroke point, anywhere along a stroke (its
  curve as drawn), the middle of a stretch, the foot of the perpendicular
  from where a move began, or the drawing plane's lattice (in the plane's
  own basis: a tilted plane gets a tilted lattice). Picked on screen within
  14 px, falling back to the plane. Modes are in right-click › Magnet;
  Shift+M turns it off and back on; the default is auto (points, then
  strokes). It is used for a stroke's start and end, the line tool's ends,
  polyline corners, the 3D cursor (Shift+right-click) and control points
  dragged with the points tool. Ctrl while drawing leaves it out. The snap
  marker shows what it caught (filled: a point; square: along a stroke;
  diamond: a middle; dashed: the grid). Strokes that meet this way join,
  as on the canvas.
- Not yet: gestures recorded in time (a stroke replayed at the speed it was
  drawn); live audio recording (offline export exists); MIDI clock; a
  nested space with its own context; continuous cursor messages (a
  traveler sending CC as it moves); tracks and compositions of clips as
  in AMS; free travelers, gas and physics.

The owner asked to match Poliplan's functionality "for starters" without
copying it. Not matched yet: writing your own brushes and sculpt tools in
the app, rotate and scale of lines, the point and lasso-plane tools,
boards and artboard sizes, PNG/SVG/p5 export, image layers and reference
underlay, the full colour picker (palettes, eyedropper, names), blend
modes, simplify, stages, key remapping, docking and floating panels.

Checked in a browser on WebGPU, by pointer or scripted pointer events: the
demo; palette with the scripted engine; the endpoint engine against Ollama
(`gemma4`, about 30 s, a valid collapsed patch with code it wrote);
rectangle tool, context menu, role change; a pasted p5.js sketch and a
three.js sketch running as objects with ports; `wave` and `follow`; an
ellipse on a target's top plane; Alt-drag orbit; resize with undo and
redo; port-drag connector; every panel rendering; examples added from
the panel; fills and opacity; the line and note tools; a locked line not
being picked; a score looping across passes with a line
added while it played, Space to start and stop. 20 unit tests.
Sound itself was not heard: only that scheduling runs and does not throw.

Not checked: touch (pinch and two-finger pan are written, never run),
WebMCP (no browser here has it), WebGL, light theme, Safari and Firefox,
the deployed copy.

Known gaps and shortcuts:

- p5.js 2.4.0 is vendored in `vendor/p5/` (the minified global build only;
  `p5.webgpu` is not included). three.js r187 was the latest release when
  checked on 13 Nov 2026.
- Sketch frames are `allow-scripts allow-same-origin`, so they are not a
  sandbox. Without same-origin a local server cannot serve the vendored
  three.js to them.
- From `languel.github.io` the page cannot reach a local Ollama unless
  `OLLAMA_ORIGINS` allows that origin. The scripted engine always works.
- Lines inside a target can be selected and deleted, not moved. No code
  containers inside a target.
- No copy/paste of objects, no rename UI, no fill or colour for visuals.
- Still from spike B: one frame of delay per connector, all ink rebuilt on
  change, plain textarea editor, take format not yet AMS's.
- The assistant only adds (`patch.add`). It does not yet read or edit what
  is there, and there is no in-browser model tier.
- No TypeScript contracts were written: the owner asked that the language
  stay JS, and the registry's schemas are the contract for now.

## 6. Next steps

**The 3D phase, in passes** (begun 14 Nov 2026, after the score and
timeline): (1) done: targets take marks in, travelers and nodes in 3D;
(2) done: placement and the magnet from threegrease `src/tools/snapping.ts` and
`projection.ts`: snapping drawing, points and the 3D cursor to stroke
points and segments in 3D, guides; (3) grease pencil strokes: pressure as
radius in a screen-space ribbon, fills of closed strokes (earcut), from
threegrease's renderer; (4) Poly Build (`src/tools/polytool.ts`): a mesh
kind in targets, built by clicking, with faces, extrude and welds, joined
to strokes; (5) then events and points in 3D, and the rest of
threegrease's edit and sculpt modes as they are asked for.

**The owner's order (14 Nov 2026):** first a comprehensive score and
timeline like AMS's, worked on autonomously with commits at natural
stopping points. Then extend drawing into 3D and consolidate it with
threegrease's grease pencil and mesh builder tools (Poly Build,
PolyQuilt-style editing, placement and snapping: see `~/dev/threegrease`,
`src/tools/polytool.ts`, `snapping.ts` and `projection.ts`). The owner also wants a render target to
work as a score frame does: drawing a target (a 3D rectangle) over marks
places them in its 3D scene.

In this order, unless the owner says otherwise.

1. ~~Create the GitHub repo, push, and add a GitHub Pages workflow.~~ Done
   13 Nov 2026: public repo `github.com/languel/underspace`, live at
   <https://languel.github.io/underspace/>. `.github/workflows/pages.yml`
   runs `npm test`, then publishes only `index.html`, `src/` and `vendor/`
   on every push to `main`. A new top-level folder or page must be added to
   the `cp` line there or it will not be deployed (`spike-b/` and `app/` are).
2. **Get the owner's answers on spike A** (below). They decide what the
   kernel looks like.
3. ~~Spike B, "the object".~~ Built 13 Nov 2026 in `spike-b/` (throwaway,
   see section 5b). **Next: the owner tries it and answers the questions in
   5b.** Those and the spike A answers decide the kernel.
4. Kernel: under way as `app/` (section 5c). Still to do from this step:
   takes in AMS format, one shared clock (scores run on the audio clock,
   code objects on the frame clock), AMS's brush and sculpt kit for ink,
   editing a score's edits mid-pass rather than at the next pass.
5. Timeline and clip editing over takes (bring AMS's take model and playback
   first; editing features as needed).
6. Agent: engine layer from seloai, loop from threecoder Studio, scoped to
   one object, driving an in-browser model.
7. Scene editing (threeditor's tools over the same space), then circuit and
   choreography.

### Questions for the owner about spike A

1. Does drawing on a plane in the scene view feel usable, or does 3D
   placement need threegrease's surface and stroke-depth rules straight away?
2. Is the reading clear as a panel, or must it be a visible frame object you
   can move and resize on the canvas?
3. Is restarting the loop on each change acceptable, or must edits be heard
   without losing position?
4. Is the take granular enough to teach from and to train from?
5. Is one shared brush with parameters from geometry enough, or do marks need
   their own parameters too?

### The owner's answers (13 Nov 2026)

1. **3D placement.** Plane drawing feels natural. Wanted: AMS's ease of 2D
   drawing as the baseline, extended to 3D with optional snapping to
   surfaces and objects (threegrease had this, but messy and unconnected to
   the rest, mesh generation included). So: one drawing tool, placement as a
   swappable rule, each rule in its own file; 3D strokes are ordinary marks
   that a mesh brush can read. Kernel requirement, not spike B.
2. **Canvas and scene.** In spike A the two panes are not easily told apart.
   Proposed in reply (not explicitly confirmed, used as the working
   assumption for spike B): the canvas is the workspace, a node editor you
   can draw into; a scene is an object on the canvas whose interior is a 3D
   space, not a second pane. A reading would likewise be a frame object.
3. **Loop.** It must not restart on change. Layering and overdubbing a
   performance are wanted. Restart can be an option. Minor for now.
4. **Take granularity.** Deferred with all teaching decisions: build a
   functional system first.
5. **Brushes.** Wanted: AMS's rich brushes and sculpt tools. In AMS a mark
   carries `realize: { brush, params }` and brushes and sculpt tools are code
   against a kit; adopt that (shared brush, per-mark parameters).

Also asked for:

- **UI.** Spike A's look is right. No narrative UI or on-screen
  explanations: glyphs with hover tips, as in AMS (`src/workbench/icons.js`,
  `glyphSelect.js`).
- **Code anywhere.** As in underscores: write code anywhere on the canvas,
  with the same code reachable in a sidebar. The AMS and underscores code
  editors already work well; reuse one in the kernel.
- **Clean canvas.** Every panel can be minimized, leaving only the drawing
  canvas.

### Still open in the design

- Which meaning of "the drawing is the score" to build first: code makes the
  drawing, the drawing is the program, or cursors play the drawing. The
  *Pithoprakta* example points to the second and third.
- Whether the blanket idea goes beyond structure (objects that predict their
  inputs).
- Canvas substrate: one three.js scene with an orthographic view is the
  current assumption, proven only at spike scale.
- Repo and product name.

## 7. Risks to keep in view

- **Scope.** The inspirations are many (p5, TouchDesigner, Arduino, Blender,
  three.js, plugdata, ComfyUI, Strudel). Two earlier projects recorded the
  same failure: features accumulated until the tool was bloated
  (motionbrickhouse `docs/DESIGN.md`, and genereti's experience of ComfyUI).
  The one-file rule is the defence. Do not add small arithmetic nodes; an
  expression or script object covers them.
- **New interaction concepts have no borrowed UX.** Hence spikes before a
  kernel.
- **Recording must be designed in.** If any change bypasses the command
  registry, takes have holes. (underscores has unreliable undo for this
  reason: Excalidraw's history lives beside the app's.)
- **Two timelines, one clock.** Time as a dimension of the work and the time
  of its making are different; keep them distinct in the data.
- **Do not over-generalize dimensions.** Named channels and simple remapping
  functions only.
- **2D paint brushes in a 3D renderer.** AMS's p5.brush watercolors draw to a
  2D canvas; here they render to textures on planes or become shaders.
- **Wires drawn as lines need binding rules** that survive moving and
  redrawing.
- **Default faces must be automatic**, or every object type costs three
  designs.
- **threeditor's entities are not objects in this sense.** Embed first, map
  later.
- **Agent-written code runs in the page once committed.** Preview can be
  sandboxed; this is not a hard security boundary.
- **Small models and tools.** They degrade with many tools and fail one-shot
  tasks they can complete with a check-and-repair loop (seen in threecoder).
- **Student hardware.** 1–3 GB model downloads and WebGPU will fail on some
  machines. Every lesson must also play from its take with no model.
- **GitHub Pages has no cross-origin isolation.** CPU fallbacks are
  single-threaded; files over 100 MB cannot live in the repo.
- **Deep zoom.** An orthographic camera over a huge canvas loses float
  precision; nested spaces need local coordinates.

## 8. Where the fuller record is

- `docs/CONTEXT.md`: the owner's own statements, the survey of the earlier
  repos (dates, stacks, what each rebuilt), what was proposed and rejected,
  the time-and-process detail, and notes on the outside references.
- `README.md`: how to run and try spike A.
- The claude.ai project "underspace" holds two earlier drafts
  (`underspace-foundations-v0.md`, `spike-a-notes.md`). Everything in them is
  in this file or in `docs/CONTEXT.md`; where they differ, these files win.
