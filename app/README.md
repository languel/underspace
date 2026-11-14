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
it to mark the loop. Under the ruler there is a lane for each traveler,
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
"Export recorded clips as MIDI" writes a .mid file of every unmuted clip.
"Send notes to MIDI" connects Web MIDI, after which notes also go to your
instruments.

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
