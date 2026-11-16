// What the code of each kind of object is given and may return, in one place: the Docs panel
// shows it to a person and the command code.help gives it to an agent, so neither has to guess
// what `ev` or `ways` holds. The presets are read from where they live.

import { PRESETS } from './presets.js';
import { BRUSHES } from './brushes.js';
import { EVENTS } from './play.js';
import { JUNCTIONS } from './joints.js';
import { GRID_PRESETS } from './grid.js';
import { TARGET_PRESETS } from './object.js';
import { SYNTH_PARTS } from './synth.js';

const HEADER = 'The first comment lines are its header: "// name", then "// in: a b", "// out: y", "// param: gain 0.5" declare its ports and parameters.';
const MUSIC = [
  ['note(midi, velocity, seconds, channel)', 'plays a note; seconds \'gate\' holds it while the traveler is inside; channel 1..16 picks the instrument (music.set channels); channel 10 is drums, the note picks the drum: 36 kick, 38 snare, 42 closed hat, 46 open hat, others a tom'],
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
    what: 'A joint (joint.add: lines held together, or one place on a line with node: true): its code runs when a traveler arrives and chooses the way on. A Midinous glyph (object.glyph) gives it that node\'s code. To build a graph that plays (a Markov chain, a sequencer): line.add each edge as a straight line, then one joint.add a node with at: the line ends that meet there ({ id, u: 0 } a line\'s start, { id, u: 1 } its end) and code that plays a note and returns a way; then traveler.add on one line and object.set its speed (grid cells a beat, so an edge\'s length is its time). A graph where every node has a way on never ends.',
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
  synth: {
    what: 'A part of a synth you draw (synth.make { id, kind }): its code is only a header naming the kind and its ports; the drawing is what it does. Lines: osc (the curve, left to right, is one cycle of the wave; ratio times the note\'s pitch; fm in: Hz per unit), partials (the curve\'s height across is the strength of harmonics 1..count: additive), env (the curve is a level 0..1 over dur seconds, held at its end while the note is, then to 0 over release), shaper (across is what comes in, up is what goes out). Shapes: filter (type 0 low, 1 high, 2 band pass; hz, q; cutoff in moves hz by depth per unit), amp (with level wired its loudness is that level, else gain), mix (a b c in), noise, out (the instrument: param channel 1..16 is the MIDI channel it plays).',
    gets: [['audio', 'the sound, part to part'], ['level', 'what an env sends: 0..1 over time, for an amp\'s level or a filter\'s cutoff'], ['fm', 'an osc\'s input: another osc\'s audio bends its pitch']],
    returns: 'nothing: it is not run; change the drawing or the parameters (object.set)',
    presets: SYNTH_PARTS,
  },
  grid: {
    what: 'A grid frame (shape.add role "grid"): its code is only a header of parameters, which quantize space, time and pitch for what lies inside: cell (units), sub (snap points a cell), beats (beats a cell of path), metric (0 along, 1 right angles, 2 across), bars (round path times to this many beats), rows (scale degrees a cell up), snap (1: drawing snaps).',
    gets: [],
    returns: 'nothing',
    presets: GRID_PRESETS,
  },
};
export const CODE_ROLES = Object.keys(CODE_DOC);

// How the things an agent is asked for are made from the commands there are. Short on purpose:
// a model that does not know these builds something that looks right and does nothing.
export const RECIPES = {
  'how sound is made': 'Nothing plays by itself and there is no function to "run". Sound comes from three things only: (1) a score frame plays the lines inside it; (2) a traveler moving along a line fires the events it meets; (3) a traveler arriving at a joint runs that joint\'s code. play.toggle starts and stops all of them. Never write a loop or a timer in code: the traveler is the loop.',
  'glissandi, a drawing as a score': 'shape.add { role: "score", rect } makes the frame; every line.add whose points lie inside the frame\'s box is a voice: left to right is time, up is pitch, a curve is a glissando. music.set { scale, root, bpm } sets what it is read on. A curve is a line of many points (it is drawn smooth through them): work the points out yourself, for example 12 points of y = tanh(x) for an s-curve.',
  'triggers on a line': 'line.add the path, traveler.add { on: line, dur: beats, loop: 1 } to move along it, and for each trigger point.add { at: a point on the line, role: "event" } (or shape.add role "event" over it). An event\'s code runs when the traveler reaches it: by default note(pitch(ev.y), 100, p.dur); set your own with object.code, e.g. note(step(57, 2), 100, 0.3).',
  'a graph that plays (a Markov chain, a sequencer, a drum loop)': 'line.add each edge as a straight line between two node positions (same positions for edges that share a node). Then for each node one joint.add { at: [{ id: line, u: 0 for the line\'s start or 1 for its end }, ...every line end at that node], glyph: "note", code }. The code plays and chooses: "// kick\\nnote(36, 110, 0.1, 10);\\nreturn Math.floor(rng() * ways.length);" (channel 10 is drums: 36 kick, 38 snare, 42 hat; another channel is a pitched instrument). Then traveler.add { on: one line } and object.set { id: traveler, name: "speed", value: 4 } (grid cells a beat). Every node having a way on makes it perpetual.',
  'notes in a shape (scattered, on a grid, in a pattern)': 'A note that sounds is an event a traveler reaches, not a shape with role "note" (that is text). For each note: point.add { at: [x, y] inside the shape\'s box (space_read gives box [x0, y0, x1, y1]), role: "event", glyph: "note" }, and object.code to say which note: note(step(root, k), 100, 0.3) for the kth degree of the scale up from root, or note(pitch(v), 100, 0.3) for a height v from 0 to 1. Then lines through them with travelers (traveler.add { on, dur: beats, loop: 1 }: two bars in 4/4 is dur 8) so something reaches them. Work out random places yourself and send them in one batch_run.',
  'a synth you draw (an instrument)': 'Draw each curve with line.add and make it a part: synth.make { id, kind: "osc" } (one cycle of a wave, e.g. 17 points of a sine across 2 units), "env" (attack then decay: [[0,0],[0.2,1],[0.6,0.3],[2,0.2]] with style path straight), "partials", "shaper". Shapes (shape.add role "visual", then synth.make): "filter", "amp", "out". Wire them with connectors: line.add { points: [the out port\'s place, the in port\'s place], tol: 0.3 } from osc.audio to amp.audio, env.level to amp.level, amp.audio to out.audio (a filter between: osc.audio -> filter.audio -> amp.audio, another env.level -> filter.cutoff; FM: one osc.audio -> another osc.fm). object.set { id: out, name: "channel", value: 11 } makes it play MIDI channel 11: note(m, 100, 0.4, 11) in an event plays it; synth.play { id: out } plays a note now. example.list has four under Sound/Synths you draw to copy from.',
  'check what you built': 'play.toggle, wait a few seconds, then play.state: scores lists each voice\'s pitches, notes the last notes played (beat, midi, channel). Empty notes means nothing fires. view.look is a picture. play.toggle again stops.',
};

// For code.help. No role: what each kind is, in a line. A role: what its code gets and returns,
// and the names of its presets. A role and a preset: that preset's source, to copy and change.
export function codeHelp(role, preset) {
  if (!role) return { recipes: RECIPES, kinds: Object.fromEntries(CODE_ROLES.map((r) => [r, CODE_DOC[r].what.split(/(?<=[.:)])\s/)[0]])), more: 'code.help { role } for what that kind of code is given and returns' };
  const d = CODE_DOC[role];
  if (!d) throw new Error(`no such kind of code: ${role} (one of ${CODE_ROLES.join(', ')})`);
  if (preset != null) {
    const src = d.presets[preset];
    if (src == null) throw new Error(`no ${role} preset "${preset}" (one of ${Object.keys(d.presets).join(', ')})`);
    return { role, preset, code: src };
  }
  return { role, what: d.what, gets: Object.fromEntries(d.gets), returns: d.returns, presets: Object.keys(d.presets), example: Object.values(d.presets)[0] ?? null };
}

// What each kind of code is compiled with (the names it is given). For checkCode.
const ARGS = {
  code: ['inp', 'p', 't', 'geom', 'mem', 'along'], path: ['inp', 'p', 't', 'geom', 'mem', 'along'], target: ['inp', 'p', 't', 'geom', 'mem', 'along'],
  event: ['ev', 'p', 'note', 'mem', 'pitch', 'step', 'snap', 'rng', 'cc', 'light', 'lit', 'tool'],
  junction: ['ways', 'ev', 'p', 'mem', 'note', 'pitch', 'step', 'snap', 'rng', 'cc', 'light', 'lit', 'tool'],
  score: ['voices', 'ctx'],
};
// Would this code compile as that kind? -> '' or what is wrong, in words an agent can act on. A whole
// sketch (it has import, setup or draw) is not a function body and is not checked.
export function checkCode(role, code) {
  const args = ARGS[role];
  if (!args || typeof code !== 'string' || /^\s*import\s|\bfunction\s+(setup|draw)\s*\(|\bcreateCanvas\s*\(|\bnew\s+THREE\./m.test(code)) return '';
  try { new Function(...args, code); return ''; } // eslint-disable-line no-new-func
  catch (e) {
    const again = String(e.message).match(/Identifier '(\w+)' has already been declared/);
    return `this ${role} code does not compile: ${e.message}.` + (again && args.includes(again[1]) ? ` ${again[1]} is given to the code: use it, do not declare it.` : '') + ` It is a function body given ${args.join(', ')} (code.help { role: "${role}" }).`;
  }
}
