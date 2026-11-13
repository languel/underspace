# Context: how underspace got here

Written 13 Nov 2026 as the record of the design conversation. `HANDOFF.md` is
the working brief; this file holds the background a new collaborator would
otherwise have to ask for: the survey of the earlier repos, what was proposed
and rejected, and details that did not fit the handoff.

## 1. The problem, in the owner's words

- "I keep starting different projects and converging on a similar idea."
- "I keep starting fresh with a specific task in mind and build a tool but get
  into a place where one tool has a feature that the other doesn't, so I start
  frankensteining from different projects until they feel bloaty."
- "My fantasy is to have something that is well designed from the foundation
  and can grow organically without bloat and chaos while being flexible."
- "An infinite canvas that is also a game engine, so a chimera of p5js,
  TouchDesigner, Arduino, Blender, three.js, plugdata, ComfyUI, Strudel, built
  around JavaScript and AI."
- "Every element is code, and what I was ultimately hoping to be able to do is
  draw the code on the infinite canvas."
- "The organizing philosophy is actually active inference, where everything is
  a code object with a 'Markov blanket' of parameters and interfaces and we
  can zoom in and out at various scales."
- "It is drawing first… It needs to be minimal, clean, modular and agentic. I
  think this is the essence."
- Timeline, clip editing and process recording "are crucial because this will
  also be a teaching tool both for humans and AI models."
- Music composition matters: timing, and quantization to time and scales.

Daily use at the time of writing: artistmodelstudio, threeditor, p5comp. The
owner usually drives these tools by opening them in a browser and letting
Claude interact with them, and wants a built-in or local agent to do the same.

## 2. Survey of the earlier repos (all in ~/dev, GitHub: languel)

| Repo | Active | Commits | Stack | What it is |
| --- | --- | --- | --- | --- |
| underscores | Jun 29 – Sep 8 | 412 | React, Excalidraw, Vite | Infinite canvas with livecode nodes (p5, GLSL, Strudel, three, Manim), transport, physics, multiplayer, WebMCP. Evolved into AMS. |
| threegrease | Jul 5 – Sep 22 | 398 | TypeScript, no framework, Vite | Grease Pencil in three.js growing into a performance lab; MCP/ACP relay; no test suite. Rich but chaotic. |
| artistmodelstudio (AMS) | Sep 17 – Nov 9 | 556 | Vanilla JS, Vite, ~780 tests | Process drawing: marks, brushes as code, scores, takes, timeline, MCP. `src/workbench` is ~29k lines. |
| genereti | Sep 30 – Nov 3 | 129 | JS (~20k) + Python (~6k), ComfyUI node pack | Live visuals, sound and code as ComfyUI nodes: texture/signal/data wires, modular audio, timeline. |
| p5comp | Oct 13 – Nov 6 | 62 | Vanilla JS, Express optional | Arduino + p5 teaching: circuit simulator (AVR8js), IDE, Firmata; embeds AMS's editor (Poliplan). |
| threeditor | Nov 3 – Nov 11 | 36 | No build; fork of three.js r187 editor (~83k lines in `editor/`) | Scene editor with code panel, script parameters, publishing. Clean, tested on students. |
| motionbrickhouse | restart Nov 5 | – | Static ES modules on a vendored threeditor | Choreography scores as code; `motion/` core is ~2.6k lines, pure and seekable. |
| threecoder | Nov 6 – Nov 7 | 3 | Python (MLX), JS playground | Fine-tuning small models to write three.js scenes; Studio prototype with an agent loop. |
| seloai | Nov 11 – Nov 13 | 38 | React, TypeScript, Tailwind | Browser AI village; the reference for integrating in-browser models. |

A new project started every four to six weeks. Each rebuilt the same core:

| Rebuilt piece | Found in |
| --- | --- |
| Command/tool registry with MCP or WebMCP | underscores, threegrease, AMS, p5comp, seloai (threecoder has its own tool loop) |
| Dockable panels, command palette | underscores, threegrease, AMS, threeditor |
| Code editor with `@param` controls | underscores, AMS, p5comp, threeditor |
| History, timeline, recording | underscores, AMS (takes), p5comp, genereti |
| Assets, Mediathèque | AMS, threeditor |
| Model providers, chat | underscores, threegrease, AMS, genereti, threecoder, seloai |

Seams that already worked and should be imitated:

- **Poliplan**: AMS's editor embedded in p5comp over the `ams-editor-v1`
  postMessage protocol (`artistmodelstudio/docs/EMBEDDING.md`).
- **`ams-take`**: generic clip kinds, with the host supplying its own diff
  kind (`artistmodelstudio/docs/recording-system.md`).
- **threegrease's single tool registry** serving four consumers
  (`threegrease/docs/AGENT.md`).
- **motionbrickhouse on threeditor**: a module attached from outside through
  four small hooks (`motionbrickhouse/docs/THREEDITOR.md`).

Lessons the repos had already written down:

- motionbrickhouse `docs/DESIGN.md`: "the engine came before the language",
  "nothing was seekable", "scope accumulated".
- underscores `notes/project-status.md`: undo is unreliable because Excalidraw
  history, app state and the recordable History are separate systems.
- seloai: `src/ai/brainRouter.ts` grew to ~2k lines mixing engine routing with
  domain prompts. Good parts: `modelCache.ts` (cache probe, autoload last
  model), the worker protocol, narrow line formats for small models
  (`ACTION: … | MOTIVE: …`), and a no-model "Story Sim" fallback.
- threecoder: small models could not one-shot a scene but got there with
  guidance. The Studio's bounded loop (inspect, preview in a sandboxed frame,
  check, commit or undo) and its "scene plan" JSON are the pattern.

## 3. How the design moved (and what was rejected)

1. *Merge threeditor into AMS.* Rejected: the editor fork is far larger than
   the AMS workbench and would bury what makes AMS clean.
2. *A kernel plus domain modules, two kinds of workspace (Canvas, Scene).*
   Superseded when genereti showed that wires and a shared clock were missing.
3. *An infinite canvas of nodes and typed wires; a 3D world is one node.*
   Close to cables.gl. Kept in part (wire types, clock, one-file rule).
4. *No node boxes: point, line and plane are the only primitives.* Rejected by
   the owner: boxes are wanted too, as primitives alongside drawing ones.
5. *One recursive object with a Markov blanket, viewed at three zoom levels,
   with collapse and expand.* Current.
6. *One space with named channels; 2D, 3D and time are projections; a reading
   is a projection; a brush realizes it.* Current.
7. *Drawing first; time, process recording and music as core.* Current.

Also decided: do not build on cables.gl or Unit (references only); do not
build on a canvas library that owns its own state and history; one three.js
scene as the renderer; three.js r187 with WebGPU and TSL.

## 4. Time and process, in more detail

- **Takes** follow `ams-take`: timed clips on tracks (drawing changes,
  commands, narration, camera, audio, nested takes). Each clip records who
  made it (person, agent, which model) and optionally why.
- **History**: every change is an entry; any stretch can become a clip.
- **Timeline**: clip editing (split, ripple, slide, transitions), keyframes on
  any addressable parameter, export to video with sound. AMS has these; bring
  over the take model and playback first.
- **Two timelines, one clock**: the timeline of the work (time as a channel of
  the marks) and the timeline of the making (the take).
- **Teaching uses**: a lesson is a take a learner steps through; an exercise
  is a brief plus expectations; an evaluation is a take with pass/fail notes;
  training data is takes exported as (context, action) sequences. The same
  brief can go to a student and to a model.

## 5. Notes on the outside references

- **cables.gl**: MIT-licensed, has a standalone Electron build, ops are single
  files editable in the app, exports patches to static hosting. Differences
  that define underspace: cables has its own GL engine rather than three.js;
  its ops are small-grained, where underspace objects are whole sketches,
  worlds or circuits; it has no agent, no takes, no scene editor, and its
  elements are not drawn.
- **Unit** (github.com/samuelmtimbo/unit, MIT, TypeScript): programs are graphs
  of units; composition by collapsing a graph into a unit and decomposition
  back. The collapse/expand idea comes from here.
- **LFM3-1.7B** (Liquid AI): a ~1 GB in-browser model post-trained for agent
  harnesses including Pi; supports tool search. The demo that prompted the
  agent idea is the Hugging Face Space
  `webml-community/LFM3-1.7B-WebGPU-Pi`.

## 6. Practical notes for whoever continues

- The spike was driven in headless Chrome with `puppeteer-core` and the
  system Chrome (`--use-angle=swiftshader`), which runs the WebGL 2 backend.
  WebGPU could not be tested that way (no usable adapter); test it in a real
  browser.
- Audio cannot be judged in headless runs; only that scheduling does not
  throw.
- GitHub Pages serves no cross-origin isolation headers. Vendored three.js is
  ~4 MB; keep model weights out of the repo.
- The other repos are reference material. Read them in place; do not copy
  large parts in without the owner's say.
