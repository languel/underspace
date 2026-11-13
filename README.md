# underspace · spike A (the space)

Throwaway. It tests one idea from the foundations doc: marks live in one space
with named channels (x, y, z, draw time, pressure), views are projections of
that space, a reading turns shape into time and pitch, and a brush (code) turns
that into sound. Everything you do is recorded as a take and can be replayed.

## Run

```sh
python3 -m http.server 5310
```

Open <http://127.0.0.1:5310/>. No install and no build; three.js r187 is in
`vendor/`. It uses WebGPU when the browser has it and WebGL 2 otherwise; add
`?gl` to the address to force WebGL.

```sh
npm test    # reading logic (Node 22+, no dependencies)
```

## Try

1. Draw a few lines in the **canvas** view (left). They appear in the **scene** view too.
2. Set **plane** to *top*, draw again: now you are drawing on the floor. Orbit the scene with right-drag or Alt-drag.
3. Press **select** (V), drag a box around some lines, press **play** (Space).
   x is read as time and y as pitch; a playhead sweeps the frame in both views.
4. Change **snap**, **scale**, **root**, **bpm** while it plays. The drawing is never changed; snapping happens on read.
5. Change the **preset**, or edit the brush code. It recompiles as you type.
6. Set **scene shows** to *making*: depth is now the time each point was drawn.
   Set the reading's **time** to *draw time* to hear the lines in the order and pace you drew them.
7. **replay take** redraws and replays the whole session. **save** / **load** round-trip it as JSON.

In the browser console, `underspace.commands()` lists every command and
`underspace.call('mark.add', { plane: 'front', points: [[0,0,0,0,0.5],[2,1,0,1,0.5]] }, 'agent')`
does what a person can do through the same door, recorded with who did it.

## Layout

| File | Role |
| --- | --- |
| `src/space.js` | State, the command registry, the take (record, replay, load) |
| `src/reading.js` | Pure: channels to time and pitch, grid and scale snapping |
| `src/brushes.js` | Brush presets, as source text |
| `src/audio.js` | Transport on the audio clock; compiles and runs the brush |
| `src/views.js` | One three.js scene (WebGPU renderer, TSL colours), canvas and scene cameras, picking |
| `src/main.js` | Wiring and the small UI |

## Not here on purpose

Undo, saving a project, boxes and wires, zoom levels, collapse/expand (that is
spike B), pressure-varying line width, 2D paint brushes, an agent, a timeline
editor. Editing a mark after drawing it. Changing anything while playing
restarts the loop from the top.
