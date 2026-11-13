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

## 6. Next steps

In this order, unless the owner says otherwise.

1. Create the GitHub repo, push, and add a GitHub Pages workflow (the local
   repository and first commit exist). Deploy early so static hosting is
   never an afterthought.
2. **Get the owner's answers on spike A** (below). They decide what the
   kernel looks like.
3. **Spike B, "the object"** (throwaway, separate folder or page): three zoom
   levels for one object type (mark, blanket as ports and parameters,
   interior), drawn lines that bind to objects and stay bound, collapse and
   expand. This is the newest idea and the biggest risk.
4. Kernel, from what the two spikes prove: space, object, clock, commands,
   takes (AMS format), with a handful of brush, view and object types. Write
   the kernel contracts in TypeScript (proposed, not yet agreed).
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
