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

The owner asked to match Poliplan's functionality "for starters" without
copying it. Not matched yet: textured brushes and the brush kit, sculpt
tools, rotate and scale of lines, the point and lasso-plane tools,
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
