# underspace · spike B (the object)

Throwaway. It tests the second idea from the foundations: every element on
the canvas is one kind of object, with a blanket of ports and parameters, an
interior, and a face per zoom level. `HANDOFF.md` section 5b says what it
covers and what it skips.

## Run

From the repository root:

```sh
python3 -m http.server 5310
```

Open <http://127.0.0.1:5310/spike-b/?demo>. Without `?demo` it restores your
last session; `?new` starts empty; `?gl` forces WebGL.

## Keys

| Key | Does |
| --- | --- |
| V D B S | select, draw, box, scene |
| C | attach code to the selected mark |
| G / E | collapse the selection into a group / expand a group |
| ⌫ | delete |
| ⌘Z | undo |
| F | fit everything |
| double-click | go to an object (its near face); on empty canvas, fit |
| wheel, pinch, Space-drag | pan, zoom, pan |
| \ | sidebar |
| Tab | hide every panel |

Draw a line from an output port to an input port and it becomes a wire.
Draw inside a scene and the stroke is in its 3D space.

In the console, `underspace.commands()` lists the commands and
`underspace.call(name, args, 'agent')` runs one.
