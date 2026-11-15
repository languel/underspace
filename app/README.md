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

## Examples

The Examples panel holds a collection in nested categories. Click one to
add it below what is on the canvas, or drag it onto the canvas to put it
where you drop it; either way it comes in selected, ready to move.

## Objects

| Kind | Roles |
| --- | --- |
| line | ink, connector (bound to two ports), path (code that reads or makes the line), event, traveler |
| shape | visual, code container, render target (a 3D space inside), score (plays the lines drawn in it), note, event, traveler |
| joint | where lines meet: holds them together; its code routes travelers |
| group | made by collapsing; its ports are the connectors that were cut |

Making something an event or a traveler keeps its shape and look: the mark
itself fires or travels.

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
| ⇧V | points tool: the control points of lines |
| G R S (with a selection) | grab, rotate, scale, as in Blender: X Y Z axis, type a number, Enter or click accepts, Esc cancels |
| ⇧D | duplicate and grab |
| U | sculpt: reshape lines under the ring; `[` `]` radius, `{` `}` strength, Alt inverts |
| Space (tap) | play or stop the selected scores, or all of them; hold and drag to pan |
| C / T / X | selection becomes code (a line: a path) / a render target / plain |
| W | selected line becomes a connector to the nearest ports |
| drag from a port | draw a connector, in any tool |
| ⌘G / ⌘⇧G or E | collapse into a group / expand |
| ⌘D, ⌘C, ⌘V | duplicate, copy as JSON, paste at the pointer |
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
| pinch, mouse wheel | zoom; two fingers on a trackpad pan |
| in a target: middle-drag | orbit; ⇧ pan, ⌃ zoom; Alt+left-drag does the same |
| in a target: 1 3 7, Home | front, side, top view; reset |
| in a target: ⇧+right-click | set the 3D cursor |
| Y, A | event tool; attach a traveler to the selected line |
| ⇧S | selected lines: smooth or straight strokes |
| ; | code on objects you zoom into: show or hide |
| draw, then hold still | a ring of glyphs: let go on one to turn the stroke into it |
| Alt+Shift-drag, Alt+Ctrl-drag | pan, zoom (canvas and targets) |
| right-click a tool | the other tools of its kind, or its settings |

## Brushes

A line or a visual shape can be drawn by an ink brush: charcoal, chalk,
pencil, bristles, oil, marker, ink with pressure, hatch, stipple, wash and
more. Choose one in Properties, in the draw tool's settings (right-click
the tool), or from the palette ("Brush: charcoal"). Brushed marks are
painted on a 2D layer, so they do not appear inside render targets.

## Points and nodes

The point tool (I) puts a point: a dot, ring or plus, or one of Midinous's
kinds (note, cc, gate, LED, counter, switch, terminator, anchor), chosen in
its settings (right-click the tool). On a line it puts a node of that kind
instead: a traveler passing it runs its code (a note node plays a note) and
goes on. On a joint it makes the joint that kind. Right-click › Point
changes the type of selected points and joints. The line stack also has a
polyline tool (click the corners; double-click or Enter ends it; ending on
the first corner closes it), and the shape stack a polygon tool (sides and
star in its settings). View › Show where lines cross marks crossings that
are not joints.

Nodes light up: a note while it sounds, an LED for its beats (or on and off
in turn), a switch while on. A switch stops every other traveler; a gate
lets one on only while its inputs (the nodes named in its code) are lit
(and, or, xor, nand, nor, xnor). A traveler you place yourself drives on
past switches, counters and gates (only a terminator stops it); what
Midinous start nodes send out are signals, which they do stop.

Drag a node or a traveler to slide it along its line. Q turns quantizing
on: it then lands on divisions of the beat (right-click › Quantize: 1/16,
1/8, 1/4, triplets, 1/2, a beat, a bar) of the time along the line, shown
as ticks across it; Ctrl while dragging does the opposite.

## Joints

Lines that touch connect. When the end of a stroke lands on another line,
on another line's end, or on a joint, the two are joined there, and from
then on moving one carries the other. Each line keeps its drawn shape: it
moves, turns and scales as a whole. A ring at the pointer shows the join
before you let go; hold Ctrl or ⌘ as you let go to draw without joining.
Dropping or transforming a line so its end touches another joins them too.
It works the same in render targets (3D).

Right-click › Constrain: join where it crosses, join where its ends touch,
pin here, keep level or plumb, keep its length, let go. A joint is an
object: click it, drag it, delete it, or edit its code.

## Travelers and events

Select a line and press A: a traveler sits on it. Make any mark an event
(right-click › Convert to › Make event, or the hold ring), or draw one
with Y. Tap Space and travelers move. An event fires when a traveler
crosses it (an open line) or enters it (a closed line or a shape). By
default it plays a note whose pitch is how high up the traveler was.
An event's code can also act on the traveler: `ev.reflect()`, `ev.stop()`,
`ev.split()`, `ev.speed(k)`.

At a joint, the joint's code chooses the traveler's way on. Presets (the
menu at the top of the Code panel) are round robin (the default), chance
(weights for straight, left, right, back), random, straight, split,
reflect, stop and every nth. The code is given `ways`, straightest first,
and returns a way or its index, an array of them to split, `'back'` or
`'stop'`.

## Timeline and music

⌥T shows the timeline along the bottom, IanniX's transport and Midinous's
musical grid in one place. Its head has rewind (⌥,), play or pause
(Space), record (⌥R), loop (⌥L), the position in bars, beats and
sixteenths, and the musical context everything plays in: tempo, meter,
scale (Midinous's 37, or your own steps in semitones, fractions allowed,
for other tunings), root, and the range of notes that heights map to.
Below it is a ruler: click or drag it to move the playhead, and Shift-drag
it to mark the loop. Drag the loop's ends to change it. With the pointer over the
timeline, F fits everything, = − zoom, ← → step a beat (Shift a bar), Home
goes to the start; click the position to read it in seconds. The metronome
glyph clicks each beat and counts a bar in before recording from rest. Under the ruler there is a lane for each traveler,
score and recorded clip.

Travelers run on beats. `dur` is how many beats the whole line takes, `at`
is the beat it sets off on, and with `speed` above 0 it moves that many
grid cells a beat, so distance on the grid is time (Midinous). Event and
junction code can use `pitch(v)` (a place 0..1 as a note of the scale),
`step(n, k)` (k degrees up the scale from n) and `snap(n)`. Event presets
include fixed note, step up and gate: `note(m, v, 'gate')` holds the note
while the traveler is inside the event and lets go when it leaves, as
IanniX's triggers do. A traveler's `drawn` (1 as drawn, 2 twice as fast)
makes it go at the pace the hand drew its line: quick where the stroke
was quick, slow where the hand lingered.

The first lane, "making", is the take: every step of how the drawing was
made, by when it was made (long pauses shortened). Drag along it to move
through the history: the drawing shows as it was at that step. An edit
made there continues from there, as it would after undo. Click its name
to replay the making at the pace it was made: each stroke draws itself
out on the timing of the hand that drew it. A press or a key stops the
replay.

Recording: the notes travelers and events play while ● is on become a clip
on the timeline. A clip plays back with the transport, can be dragged
along it, and has a right-click menu: edit the notes, mute, export as MIDI,
delete. Double-click a clip to open its notes in a piano roll under the
timeline, on the same ruler: drag notes (sixteenths; Alt freely), drag a
note's right end to change its length, box-pick, double-click to add,
Delete, ↑↓ a degree of the scale (Shift an octave), ←→ a sixteenth, Q
quantize, Esc close. Rows of the timeline's scale are lit.
"Render to a clip" plays the drawing offline over the loop (or 8 bars)
and makes a clip of what it plays. "Import a MIDI file" brings a .mid in as
a clip. "Import an IanniX score" runs a .iannix file (it asks first, since it is
code) and brings its curves, cursors and triggers in as lines, travelers
and events that play its MIDI messages. "Import a Midinous project" brings a midinojs or Midinous project in: its
nodes become joints whose code plays and routes, its paths lines a grid
cell a beat long, its start nodes travelers. "Export the sound" renders the loop (or 8 bars) offline to a WAV file:
travelers, events, scores and clips through the built-in instruments. "Export recorded clips as MIDI" writes a .mid file of every unmuted clip.
The instrument glyph on the timeline's head sets what each channel plays
(triangle, sine, square, saw, pluck, bell, pad; channel 10 is drums), and
`note(m, v, seconds, channel)` picks the channel. "Send notes to MIDI" connects Web MIDI, after which notes also go to your
instruments.

## Grids

A grid says how space, time and pitch are quantized: `cell` (canvas units),
`sub` (snap points a cell), `beats` (beats a cell of path), `metric` (a path
measured along it, at right angles, or across only), `bars` (path times
rounded to whole groups of beats), `rows` (scale degrees a cell up), `snap`.
The global grid is in Properties with nothing selected. A grid frame (the
object tools, or right-click › Add › grid frame) is a grid for what lies
inside it; its presets are in the Code panel (a cell a beat, midinous,
whole bars, score rows, half beats, triplets). In a frame that times paths,
a traveler with `dur 0` takes each line in the line's own time, so a curve
three cells long takes three beats, or with `bars 4` a whole bar. An event
in a frame with rows plays the row's degree of the scale; `ev.col` and
`ev.row` say which cell. Constrain › Fit its length to the bars scales a
curve to whole bars. The Examples panel has a Music › Grids collection.

## 3D

A render target is a 3D scene in a frame. Drawn over marks (or made from a
shape over them), it takes them in: they go onto its front plane, with
their joints and travelers, and can be orbited (Alt-drag) and drawn into in
3D. Travelers and nodes play there as on the canvas. A target has code, in the Code panel: each frame it
returns how its scene is seen (`spin`, `tilt`, `zoom`, `center`), and its
header declares its inputs and parameters, so you can add controls of your
own. Presets: spin and tilt, orbit, breathe, look. Right-click › Take out
of the 3D scene puts lines back, flat. In a target the magnet places what you draw:
on a stroke's points, along a stroke, at the middle of a stretch,
perpendicular to a stroke, or on the drawing plane's grid (right-click ›
Magnet; Shift+M on and off; Ctrl while drawing leaves it out). Poly Build (Shift+B)
makes meshes in a target: click corners, click the first again to close a
face, click an existing corner to share it, drag a corner to move it, drag
an edge to grow a quad from it; Enter ends a run, Escape drops it.
Sculpt (U) works in a target as on the canvas, on lines and on meshes (a
mesh's corners move; none are added). The sculpt button in the toolbar
holds the ten kinds; Shift+Space opens the tools of the kind in use in a
ring at the pointer (hold, move toward one, let go). The brush ring shows
its reach and, inside, its strength; the tool in hand is shown beside the
pointer. `'` shows control points in any tool.
Lines join in a target as on the canvas: an end drawn onto another line
(the magnet puts it there) is held to it, and what is joined follows when
either moves. Lines that only look as if they touch, one behind the
other, are left alone. Right-click › Constrain › Join where it crosses
works there too.

In the points tool (Shift+V) the picked points can be edited, on the
canvas and in a target alike: Shift+K adds a point between picked
neighbours, K cuts the line there, J joins two picked ends (or closes one
line), Backspace deletes.
A mesh's corners are points too: click an edge to pick its ends, a face
to pick its corners; drag them, or G, R, S. Shift+K splits picked edges,
J makes a face of picked corners, M merges them, Cmd+Backspace dissolves.

Sculpt tools are code. The panel "Sculpt tools as code" shows any tool as
JavaScript; copy one and change it, and the preview shows what it does to
a sample line as you type. A tool you write is saved with the drawing.
Event and junction code can set the tools in hand with
`tool('sculptRadius', 80)` (also `sculpt`, `sculptStrength`, `width`,
`stroke`, `fill`, `magnet`), so a score can change the brush as it plays.
Ink brushes are code in the same way: the panel "Brushes as code" shows
any brush, previews what you write on a sample stroke, and a brush you
write is saved with the drawing and listed with the others.

## Scores

Draw a score frame (S) and draw lines in it: across is time, up is pitch.
Its code is a brush, chosen in the sidebar; `bpm`, `beats`, `low`, `high`,
`scale` and `grid` are its parameters. By default it follows the timeline:
bpm 0 takes the timeline's tempo, low and high 0 its range, and scale -1
its scale and root. A score plays on the transport, one pass after another
from the start of the timeline, so pause, seek and the loop cut it and pick
it up partway. Lines drawn while it plays join in on the next pass.

## For agents

`underspace.tools()` lists every command with a JSON schema;
`underspace.call(name, args, by)` runs one. `space.read` returns the
document. `patch.add` builds a wired subscene in one call.

The palette's assistant tries a scripted reading first ("osc -> scale ->
target", "2 osc into mix"). Anything else goes to a local OpenAI-compatible
endpoint (Ollama by default); set it with the palette commands "Assistant:
model endpoint" and "Assistant: model name".

## Agents

Everything the app can do is a command (the palette lists them: `⌘K`, then `>`). An agent
outside the page reaches the same commands through the relay:

1. Open the app with `?relay` (for example `http://localhost:5310/app/?relay`).
2. Claude Code: start it in this folder; `.mcp.json` registers the `underspace` server.
   opencode: `opencode.json` does the same. Pi: `node app/relay.mjs --hub`, then
   `pi -e .pi/extensions/underspace.ts`. Anything else: `node app/relay.mjs --hub` and
   `POST http://127.0.0.1:5311/call {"name": "space.read", "args": {}}`.

Good first calls: `space.read` (what is drawn), `view.look` (a picture), `tools.search`
(find a command), `action.list` and `action.run` (everything a key or menu does).
Before writing an object's code, `code.help` says what that kind of code is given and returns
(`ev`, `ways`, `voices`, `note()`, `pitch()`), and hands out the presets to copy. To hear without
ears, `play.state` reads what sounds: each score's voices as pitch over time, and the last notes.
A wrong name (a scale, an instrument, an id) is an error that lists the right ones.

The built-in assistant (`⌘J`, or type a sentence in the palette) works through the same
commands. Its brain is chosen in the panel: a model server on this machine (Ollama, LM Studio,
llama.cpp: anything OpenAI-compatible; address in Settings) or a model in this browser
(LFM3-1.7B on WebGPU, about 1.1 GB on first use). The mark at the bottom right shows an agent
at work; clicking it holds every agent until it is clicked again.

`node app/eval.mjs --model NAME` runs a set of requests against a model server and checks what
each one drew: the way to compare brains, and to see whether a change to the tools helped.
