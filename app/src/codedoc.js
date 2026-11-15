// What the code of each kind of object is given and may return, in one place: the Docs panel
// shows it to a person and the command code.help gives it to an agent, so neither has to guess
// what `ev` or `ways` holds. The presets are read from where they live.

import { PRESETS } from './presets.js';
import { BRUSHES } from './brushes.js';
import { EVENTS } from './play.js';
import { JUNCTIONS } from './joints.js';
import { GRID_PRESETS } from './grid.js';
import { TARGET_PRESETS } from './object.js';

const HEADER = 'The first comment lines are its header: "// name", then "// in: a b", "// out: y", "// param: gain 0.5" declare its ports and parameters.';
const MUSIC = [
  ['note(midi, velocity, seconds, channel)', 'plays a note; seconds \'gate\' holds it while the traveler is inside; channel 1..16 picks the instrument (music.set channels)'],
  ['pitch(v)', 'a place 0..1 as a note: across the range low..high, on the scale (music.set); in a grid with rows, the row\'s note'],
  ['step(n, k)', 'k degrees of the scale up from note n'],
  ['snap(n)', 'the nearest note of the scale'],
  ['cc(n, v, channel)', 'a MIDI controller'],
  ['rng()', 'a seeded random 0..1: the same each time from the start'],
  ['light(beats | true | false), lit(name)', 'light this one (for a while, on, out); is that node or event lit?'],
  ['tool(name, value)', 'set what the tools in hand use: sculpt, sculptRadius, sculptStrength, width, stroke, fill, magnet; tool(name) reads'],
  ['p, mem', 'its parameters; an object that persists'],
];

export const CODE_DOC = {
  code: {
    what: 'A code container (shape.add role "code") or any code object: a function body run once a frame. ' + HEADER,
    gets: [
      ['inp', 'the declared inputs: a number, or a path (an array of points)'],
      ['p', 'the declared parameters (object.set changes one)'],
      ['t', 'time in seconds'],
      ['mem', 'an object that persists between frames'],
      ['along(points, u)', 'a point u (0..1) along any path'],
    ],
    returns: 'an object of outputs ({ y: 1 }), or one number for the first output',
    presets: PRESETS,
  },
  path: {
    what: 'A line with the role "path": code that reads its own line, or makes it. ' + HEADER,
    gets: [['geom', '{ points, at(u) }: its own line'], ['inp, p, t, mem, along', 'as in a code container']],
    returns: 'outputs; `points` (an array of [x, y]) redraws the line as those; its `path` output carries the line to an input that takes one',
    presets: { path: PRESETS.path, wave: PRESETS.wave },
  },
  sketch: {
    what: 'A code container whose code is a whole p5.js or three.js sketch (it has setup/draw or createCanvas, or imports three): it runs in its own frame as the object\'s face. ' + HEADER,
    gets: [['inp, p', 'the inputs and parameters, kept up to date'], ['out({ y: 1 })', 'sets outputs']],
    returns: 'nothing: call out()',
    presets: {},
  },
  event: {
    what: 'An event (a shape, line or point with the role "event"): its code runs when a traveler reaches it (enters a shape or a closed line, crosses an open line, passes within a point). Parameters exit 1 (also fire on leaving) and lockout (seconds before it may fire again) may be declared.',
    gets: [
      ['ev', '{ x, y (where it was reached within the bounds of the traveler\'s path, 0..1, y up), u (how far along), speed, traveler, rider, count, type (\'enter\' | \'cross\' | \'exit\'), dir, col, row (its grid cell) }'],
      ['ev.reflect(), ev.stop(), ev.go(), ev.split(), ev.speed(k)', 'act on the traveler: send it back, stop it, set it going, send a copy back, change its speed'],
      ['ev.launch(line, dir)', 'set a new rider off on a line (its id or name)'],
      ...MUSIC,
    ],
    returns: 'nothing; its outputs gate (1 while a traveler is inside) and count are kept for it',
    presets: EVENTS,
  },
  junction: {
    what: 'A joint (joint.add: lines held together, or one place on a line with node: true): its code runs when a traveler arrives and chooses the way on. A Midinous glyph (object.glyph) gives it that node\'s code.',
    gets: [
      ['ways', 'where the traveler can go on, straightest first: [{ line, dir (1 forward, -1 back), turn (radians, left is +) }]'],
      ['ev', '{ traveler, rider, from, count, last (the last note this rider played), spb (seconds a beat) }'],
      ...MUSIC,
    ],
    returns: 'a way or its index; an array of them (the traveler splits); \'back\'; \'stop\' (signals and copies stop, a traveler placed by hand goes on); \'end\' (any traveler stops); nothing: straight on',
    presets: JUNCTIONS,
  },
  score: {
    what: 'A score frame (shape.add role "score"): the lines inside it are read, across as time and up as pitch, and its code, a brush, makes the sound of one pass with Web Audio. Its parameters are the reading: bpm (0: the timeline\'s tempo), beats (the frame\'s length), low and high (MIDI; 0: the timeline\'s range), scale (-1 the timeline\'s scale and root, 0 continuous, 1 chromatic, 2 major, 3 minor, 4 pentatonic, 5 whole tone, 6 quarter tone), grid (snap time to this many beats; 0 off).',
    gets: [
      ['voices', '[{ id (the line), events: [{ time (seconds from the start of the frame), midi, hz, gain }] }]'],
      ['ctx', '{ audio (the AudioContext), out (connect to it), t0 (schedule at ctx.t0 + time), duration, bpm }'],
    ],
    returns: 'nothing: it schedules sound',
    presets: BRUSHES,
  },
  target: {
    what: 'A render target (shape.add role "target"): its code runs each frame and says how its 3D scene is seen, on top of the camera that target.set and navigation set. ' + HEADER,
    gets: [['inp, p, t, mem', 'as in a code container']],
    returns: '{ spin (half turns), tilt (radians), zoom (nearer above 1), center: [x, y, z] (added to where the camera looks) }',
    presets: TARGET_PRESETS,
  },
  grid: {
    what: 'A grid frame (shape.add role "grid"): its code is only a header of parameters, which quantize space, time and pitch for what lies inside: cell (units), sub (snap points a cell), beats (beats a cell of path), metric (0 along, 1 right angles, 2 across), bars (round path times to this many beats), rows (scale degrees a cell up), snap (1: drawing snaps).',
    gets: [],
    returns: 'nothing',
    presets: GRID_PRESETS,
  },
};
export const CODE_ROLES = Object.keys(CODE_DOC);

// For code.help. No role: what each kind is, in a line. A role: what its code gets and returns,
// and the names of its presets. A role and a preset: that preset's source, to copy and change.
export function codeHelp(role, preset) {
  if (!role) return Object.fromEntries(CODE_ROLES.map((r) => [r, CODE_DOC[r].what.split(/(?<=[.:)])\s/)[0]]));
  const d = CODE_DOC[role];
  if (!d) throw new Error(`no such kind of code: ${role} (one of ${CODE_ROLES.join(', ')})`);
  if (preset != null) {
    const src = d.presets[preset];
    if (src == null) throw new Error(`no ${role} preset "${preset}" (one of ${Object.keys(d.presets).join(', ')})`);
    return { role, preset, code: src };
  }
  return { role, what: d.what, gets: Object.fromEntries(d.gets), returns: d.returns, presets: Object.keys(d.presets), example: Object.values(d.presets)[0] ?? null };
}
