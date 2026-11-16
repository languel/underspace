// Examples: small things to start from. Each is built through commands, at
// a point the app chooses, so adding one is one step for undo.
//   build(c, at): c(name, args) runs a command; at is [x, y], the centre.
//   path: where it sits in the collection, 'Music/Grids' (categories nest).

import { PRESETS } from './presets.js';
import { GRID_PRESETS } from './grid.js';
import { JUNCTIONS } from './joints.js';
import { EVENTS } from './play.js';
import { iannixPlan, applyPlan } from './iannix.js';
import { nousPlan, applyNous, nodeCodeFor } from './nous.js';
import { POINT_KINDS } from './glyphs.js';
import { state } from './space.js';
import { portPos } from './object.js';

const wave = (x, y, n, step, f) => Array.from({ length: n }, (_, i) => [+(x + i * step).toFixed(3), +(y + f(i)).toFixed(3)]);

const P5 = `// blob
// in: x
// out: y
function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
}
function draw() {
  background(20);
  fill(240, 140, 60);
  circle(width / 2 + inp.x * 120, height / 2, 80 + 30 * sin(frameCount * 0.05));
  out({ y: sin(frameCount * 0.05) });
}`;

const THREE = `// cube
// in: turn
// out: angle
import * as THREE from 'three';
const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
await renderer.init();
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.z = 3;
const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
scene.add(cube);
renderer.setAnimationLoop(() => {
  cube.rotation.y += 0.01 + inp.turn * 0.05;
  cube.rotation.x += 0.005;
  out({ angle: cube.rotation.y });
  renderer.render(scene, camera);
});`;

// ---- synths you draw (synth.js) ----------------------------------------------------
// A curve from unit points (x 0..1, y -1..1) drawn w by h with its middle at [x, y].
const curve = (pts, [x, y], w, h) => pts.map(([u, v]) => [+(x - w / 2 + u * w).toFixed(3), +(y + (v * h) / 2).toFixed(3)]);
const SINE = Array.from({ length: 17 }, (_, i) => [i / 16, Math.sin((i / 16) * Math.PI * 2)]);
const SAW = [[0, -1], [0.92, 1], [1, -1]];
const ADSR = [[0, -1], [0.06, 1], [0.3, 0.2], [1, 0.1]];
const PLUCK = [[0, -1], [0.02, 1], [0.25, -0.4], [1, -1]];
const SWELL = [[0, -1], [0.5, 1], [1, 0.6]];
const TANH = Array.from({ length: 13 }, (_, i) => { const u = i / 12; return [u, Math.tanh((u * 2 - 1) * 3)]; });
const FALLING = Array.from({ length: 16 }, (_, i) => [i / 15, 2 / (i + 1) - 1]); // 1/k: a saw's harmonics
// parts: [{ key, line: unit points | shape: true, kind, preset?, at: [dx, dy], w, h, params }]; wires: ['a.out -> b.in']
// A traveler on a loop below rings four notes on the instrument's channel, so Space plays it.
// nest: [[name, [keys]], ...] folds parts into groups in that order (a key may name a group made before).
function synthExample(c, at, ch, parts, wires, notes = [0, 2, 4, 7], nest = []) {
  const id = {};
  for (const q of parts) {
    const pos = [at[0] + q.at[0], at[1] + q.at[1]];
    id[q.key] = q.line ? c('line.add', { points: curve(q.line, pos, q.w ?? 2.4, q.h ?? 1.4), ...(q.straight ? { style: { path: 'straight' } } : {}) })
      : c('shape.add', { role: 'visual', rect: { cx: pos[0], cy: pos[1], w: q.w ?? 1.8, h: q.h ?? 1.2 } });
    c('synth.make', { id: id[q.key], kind: q.kind, ...(q.preset ? { preset: q.preset } : {}) });
    for (const [k, v] of Object.entries(q.params ?? {})) c('object.set', { id: id[q.key], name: k, value: v });
  }
  c('object.set', { id: id.out, name: 'channel', value: ch });
  const loop = Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return [+(at[0] + Math.cos(a) * 3.2).toFixed(3), +(at[1] - 4.2 + Math.sin(a) * 1).toFixed(3)]; });
  const ring = c('line.add', { points: loop });
  c('traveler.add', { on: ring, dur: 4, loop: 1 });
  notes.forEach((k, i) => { const p = loop[Math.round((i / notes.length) * 32) % 32]; const e = c('point.add', { at: p, role: 'event', glyph: 'note', size: 0.5 }); c('object.code', { id: e, code: `// event\n// out: gate count\nnote(step(57, ${k}), 100, 0.45, ${ch});` }); });
  // the wires, drawn from port to port with a little sag, before any folding: cut wires become ports
  for (const w of wires) {
    const [a, b] = w.split('->').map((x) => x.trim().split('.')), p = portPos(state.objects.get(id[a[0]]), 'outs', a[1]), q = portPos(state.objects.get(id[b[0]]), 'ins', b[1]);
    c('line.add', { points: Array.from({ length: 12 }, (_, i) => { const u = i / 11; return [+(p[0] + (q[0] - p[0]) * u).toFixed(4), +(p[1] + (q[1] - p[1]) * u + Math.sin(u * Math.PI) * 0.4).toFixed(4)]; }), tol: 0.05 });
  }
  for (const [name, keys] of nest) id[name] = c('group.collapse', { ids: keys.map((k) => id[k]), name });
}

export const EXAMPLES = [
  { path: 'Patching', title: 'An oscillator turns a view', icon: 'target', build: (c, at) => c('patch.add', { at, nodes: [{ key: 'osc', preset: 'osc' }, { key: 'scale', preset: 'scale' }, { key: 'view', role: 'target' }], links: ['osc.y -> scale.x', 'scale.y -> view.spin'] }) },
  { path: 'Music/Scores', title: 'A score: lines as sound', icon: 'score', build: (c, at) => {
    c('shape.add', { role: 'score', rect: { cx: at[0], cy: at[1], w: 11, h: 4 } });
    for (let k = 0; k < 3; k++) c('line.add', { points: wave(at[0] - 5 + k * 0.8, at[1] - 1.4 + k * 0.9, 24, 0.36, (i) => Math.sin(i * 0.45 + k) * 0.7 + i * 0.04) });
  } },
  { path: 'Patching/Paths', title: 'A path sends itself to a follower', icon: 'path', build: (c, at) => {
    const r = c('patch.add', { at: [at[0] + 3, at[1]], nodes: [{ key: 'follow', preset: 'follow' }] });
    const line = c('line.add', { points: wave(at[0] - 6, at[1], 30, 0.12, (i) => Math.sin(i * 0.5) * 0.9), role: 'path' });
    return { connect: [[line, 'path', r.ids.follow, 'path']] };
  } },
  { path: 'Patching/Paths', title: 'A path made by code', icon: 'path', build: (c, at) => {
    const id = c('line.add', { points: [[at[0] - 4, at[1]], [at[0] + 4, at[1]]], role: 'path' });
    c('object.code', { id, code: PRESETS.wave });
  } },
  { path: 'Music/Travelers and events', title: 'A traveler rings events', icon: 'traveler', build: (c, at) => {
    const loop = Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return [+(at[0] + Math.cos(a) * 4).toFixed(3), +(at[1] + Math.sin(a) * 2.2 + Math.sin(a * 3) * 0.5).toFixed(3)]; });
    const line = c('line.add', { points: [...loop, loop[0]] });
    c('traveler.add', { on: line, u: 0, dur: 6 });
    c('traveler.add', { on: line, u: 0.5, dur: 9 });
    for (const i of [3, 11, 20, 29, 40]) c('shape.add', { role: 'event', shape: 'ellipse', rect: { cx: loop[i][0], cy: loop[i][1], w: 0.9, h: 0.9 } });
  } },
  { path: 'Music/Travelers and events', title: 'A score sets the brush', icon: 'sculpt', build: (c, at) => {
    // a traveler goes back and forth; each event it passes sets the sculpt brush (its reach, its strength, its kind)
    const line = c('line.add', { points: [[at[0] - 4, at[1]], [at[0] + 4, at[1]]], style: { path: 'straight' } });
    c('traveler.add', { on: line, u: 0, dur: 8 });
    [[-2.5, 20, 0.2, 'smooth'], [0, 60, 0.5, 'push'], [2.5, 140, 0.9, 'twist']].forEach(([x, radius, strength, kind]) => {
      const ev = c('shape.add', { role: 'event', shape: 'ellipse', rect: { cx: at[0] + x, cy: at[1], w: 0.5 + radius / 100, h: 0.5 + radius / 100 } });
      c('object.code', { id: ev, code: `// brush: ${kind}\n// the tools in hand, set by the score: play, then sculpt the wavy line\ntool('sculpt', '${kind}');\ntool('sculptRadius', ${radius});\ntool('sculptStrength', ${strength});` });
    });
    c('line.add', { points: Array.from({ length: 33 }, (_, i) => [+(at[0] - 4 + i * 0.25).toFixed(3), +(at[1] - 1.6 + Math.sin(i * 0.6) * 0.4).toFixed(3)]) });
  } },
  { path: 'Sketches', title: 'A p5.js sketch', icon: 'box', build: (c, at) => c('shape.add', { role: 'code', code: P5, rect: { cx: at[0], cy: at[1], w: 6, h: 4.5 } }) },
  { path: 'Sketches', title: 'A three.js sketch', icon: 'box', build: (c, at) => c('shape.add', { role: 'code', code: THREE, rect: { cx: at[0], cy: at[1], w: 6, h: 4.5 } }) },
  { path: 'Patching', title: 'One reusable group', icon: 'collapse', build: (c, at) => c('patch.add', { at, nodes: [{ key: 'osc', preset: 'osc' }, { key: 'smooth', preset: 'smooth' }, { key: 'out', preset: 'scale' }], links: ['osc -> smooth', 'smooth -> out'], collapse: true, name: 'lfo' }) },
  { path: 'Drawing', title: 'Shapes with colour', icon: 'visual', build: (c, at) => {
    c('shape.add', { rect: { cx: at[0] - 2.2, cy: at[1], w: 3, h: 3 }, style: { fill: '#c2410c', stroke: '#1d1c1a' } });
    c('shape.add', { shape: 'ellipse', rect: { cx: at[0] + 0.4, cy: at[1] + 0.4, w: 3.4, h: 3.4 }, style: { fill: '#0f766e', opacity: 0.8 } });
    c('shape.add', { role: 'note', text: 'a note', rect: { cx: at[0] + 3.6, cy: at[1] - 1, w: 2.6, h: 1.2 } });
  } },

  // ---- grids: how space, time and pitch are quantized ----------------------------

  { path: 'Music/Grids', title: 'A cell a beat: rhythm from length', icon: 'grid', build: (c, at) => {
    // four lines, one to four cells long, in a grid where a cell of path is a beat: each traveler's
    // lap is its line's length in beats, so together they make a 1 : 2 : 3 : 4 polyrhythm
    const [x0, y0] = at;
    c('shape.add', { role: 'grid', rect: { cx: x0, cy: y0, w: 10, h: 6 }, code: GRID_PRESETS['a cell a beat'] });
    for (let k = 0; k < 4; k++) {
      const y = y0 - 2.5 + k * 1.5 + 0.5, line = c('line.add', { points: [[x0 - 4, y], [x0 - 4 + k + 1, y]], style: { path: 'straight' } });
      c('traveler.add', { on: line, dur: 0, loop: 1, size: 0.3 });
      const ev = c('line.add', { points: [[x0 - 4 + (k + 1) * 0.5, y - 0.35], [x0 - 4 + (k + 1) * 0.5, y + 0.35]] });
      c('object.role', { id: ev, role: 'event' });
      c('object.code', { id: ev, code: `// tick\n// out: gate count\nnote(${[36, 38, 42, 46][k]}, 110, 0.1, 10);` });
    }
  } },
  { path: 'Music/Grids', title: 'Whole bars: a curve takes whole bars', icon: 'grid', build: (c, at) => {
    // the same frame rounds every path's time to whole bars of 4: three free curves of different
    // lengths come out at one, two and three bars, and so stay in step
    const [x0, y0] = at;
    c('shape.add', { role: 'grid', rect: { cx: x0, cy: y0, w: 14, h: 8 }, code: GRID_PRESETS['whole bars'] });
    const curves = [0.9, 1.7, 2.6].map((amp, k) => Array.from({ length: 28 }, (_, i) => [+(x0 - 6 + i * (0.16 + k * 0.08)).toFixed(3), +(y0 - 2.5 + k * 2.4 + Math.sin(i * 0.5) * amp * 0.4).toFixed(3)]));
    curves.forEach((pts, k) => {
      const line = c('line.add', { points: pts });
      c('traveler.add', { on: line, dur: 0, loop: 1, size: 0.35 });
      const mid = pts[pts.length >> 1], ev = c('shape.add', { role: 'event', shape: 'ellipse', rect: { cx: mid[0], cy: mid[1], w: 0.7, h: 0.7 } });
      c('object.code', { id: ev, code: `// bell\n// out: gate count\nnote(${[72, 67, 60][k]}, 90, 0.8, 3);` });
    });
  } },
  { path: 'Music/Grids', title: 'Rows are degrees: pitch from the grid', icon: 'grid', build: (c, at) => {
    // a smooth wave crosses event lines; where it crosses, the row of the grid is the note (a degree
    // of the scale each row up), so a continuous drawing plays stepped, in tune
    const [x0, y0] = at;
    c('music.set', { scale: 'Pentatonic Minor', root: 57, low: 57 });
    c('shape.add', { role: 'grid', rect: { cx: x0, cy: y0, w: 12, h: 7 }, code: GRID_PRESETS['score rows'] });
    const wave = Array.from({ length: 49 }, (_, i) => [+(x0 - 6 + i * 0.25).toFixed(3), +(y0 + Math.sin(i * 0.22) * 2.8 + Math.sin(i * 0.61) * 0.5).toFixed(3)]);
    const line = c('line.add', { points: wave });
    c('traveler.add', { on: line, dur: 0, loop: 1, size: 0.3 });
    for (let k = 1; k < 12; k++) {
      const ev = c('line.add', { points: [[x0 - 6 + k, y0 - 3.4], [x0 - 6 + k, y0 + 3.4]], style: { path: 'straight', stroke: '#8a8a8a', width: 0.8 } });
      c('object.role', { id: ev, role: 'event' }); // its code: note(pitch(ev.y)), and pitch is the row's note here
    }
  } },
  { path: 'Music/Grids', title: 'Two grids, two speeds', icon: 'grid', build: (c, at) => {
    // the same drawing in two frames: a cell a beat on the left, a cell half a beat on the right
    const [x0, y0] = at;
    for (const [dx, preset] of [[-4, 'a cell a beat'], [4, 'half beats']]) {
      c('shape.add', { role: 'grid', rect: { cx: x0 + dx, cy: y0, w: 7, h: 6 }, code: GRID_PRESETS[preset] });
      const ring = Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return [+(x0 + dx + Math.cos(a) * 2.2).toFixed(3), +(y0 + Math.sin(a) * 2.2).toFixed(3)]; });
      const line = c('line.add', { points: ring, closed: true });
      c('traveler.add', { on: line, dur: 0, loop: 1, size: 0.3 });
      for (const i of [0, 8, 16, 24]) { const ev = c('shape.add', { role: 'event', shape: 'ellipse', rect: { cx: ring[i][0], cy: ring[i][1], w: 0.6, h: 0.6 } }); c('object.code', { id: ev, code: `// tap\n// out: gate count\nnote(${dx < 0 ? 60 : 67} + ${i / 4}, 90, 0.15, 1);` }); }
    }
  } },
  { path: 'Music/Grids', title: 'A Midinous grid', icon: 'grid', build: (c, at) => {
    // nodes on grid points, paths at right angles, a cell a beat: routing is time
    c('shape.add', { role: 'grid', rect: { cx: at[0], cy: at[1], w: 10, h: 6 }, code: GRID_PRESETS.midinous });
    const plan = nousPlan({ settings: { tempo: 110 }, points: [
      { id: 1, x: 0, y: 0, type: 'note', note: 62, isStart: true, to: [2] },
      { id: 2, x: 432, y: 0, type: 'note', note: 65, playMode: 'robin', to: [3, 4] },
      { id: 3, x: 432, y: -288, type: 'note', note: 69, to: [5] },
      { id: 4, x: 864, y: 288, type: 'note', note: 72, pathMode: 'vert', to: [5] },
      { id: 5, x: 1152, y: -288, type: 'note', note: 74, to: [1] }] }, { cell: 1, at: [at[0] + 0.5, at[1]] });
    applyNous(plan, c);
  } },
  { path: 'Music/Grids', title: 'The pace a line was drawn', icon: 'draw', build: (c, at) => {
    // a stroke keeps the time of the hand: drawn 1 makes the traveler go fast and slow as it was drawn
    const pts = Array.from({ length: 30 }, (_, i) => [+(at[0] - 5 + i * 0.34).toFixed(3), +(at[1] + Math.sin(i * 0.4) * 1.2).toFixed(3)]);
    let t = 0;
    const pen = pts.map((_, i) => [Math.round((t += i < 10 ? 30 : i < 20 ? 160 : 50)), 0.5]);
    const line = c('line.add', { points: pts, pen });
    const tr = c('traveler.add', { on: line, loop: 1, size: 0.35 });
    c('object.set', { id: tr, name: 'drawn', value: 1 });
    for (const i of [4, 9, 14, 19, 24]) { const ev = c('line.add', { points: [[pts[i][0], pts[i][1] - 0.5], [pts[i][0], pts[i][1] + 0.5]] }); c('object.role', { id: ev, role: 'event' }); }
  } },

  // ---- joints: lines that touch connect, and route travelers -------------------------

  { path: 'Space/Joints', title: 'Lines that touch connect', icon: 'joint', build: (c, at) => {
    const [x0, y0] = at;
    const a = c('line.add', { points: [[x0 - 5, y0], [x0 + 5, y0]], style: { path: 'straight' } });
    const b = c('line.add', { points: [[x0 - 1, y0 + 3], [x0 - 1, y0]], style: { path: 'straight' } });
    const d = c('line.add', { points: [[x0 + 5, y0], [x0 + 7, y0 - 3]], style: { path: 'straight' } });
    c('joint.add', { at: [{ id: b, u: 1 }, { id: a, u: 0.4, slide: true }] });
    c('joint.add', { at: [{ id: d, u: 0 }, { id: a, u: 1 }] });
    c('line.keep', { ids: [a], horv: true });
  } },
  { path: 'Space/Joints', title: 'Travelers through junctions', icon: 'joint', build: (c, at) => {
    // a loop with a branch: the junction takes turns (round robin), so the traveler alternates
    const [x0, y0] = at;
    const top = c('line.add', { points: [[x0 - 4, y0 + 2], [x0 + 4, y0 + 2]], style: { path: 'straight' } });
    const right = c('line.add', { points: [[x0 + 4, y0 + 2], [x0 + 4, y0 - 2]], style: { path: 'straight' } });
    const bottom = c('line.add', { points: [[x0 + 4, y0 - 2], [x0 - 4, y0 - 2]], style: { path: 'straight' } });
    const left = c('line.add', { points: [[x0 - 4, y0 - 2], [x0 - 4, y0 + 2]], style: { path: 'straight' } });
    const cut = c('line.add', { points: [[x0, y0 + 2], [x0, y0 - 2]], style: { path: 'straight' } });
    c('joint.add', { at: [{ id: top, u: 1 }, { id: right, u: 0 }] });
    c('joint.add', { at: [{ id: right, u: 1 }, { id: bottom, u: 0 }] });
    c('joint.add', { at: [{ id: bottom, u: 1 }, { id: left, u: 0 }] });
    c('joint.add', { at: [{ id: left, u: 1 }, { id: top, u: 0 }] });
    const j1 = c('joint.add', { at: [{ id: top, u: 0.5 }, { id: cut, u: 0 }] });
    c('joint.add', { at: [{ id: bottom, u: 0.5 }, { id: cut, u: 1 }] });
    c('object.code', { id: j1, code: JUNCTIONS['round robin'] });
    c('traveler.add', { on: top, dur: 4, loop: 1, size: 0.35 });
    for (const [x, y] of [[x0 - 4, y0], [x0 + 4, y0], [x0, y0]]) { const ev = c('shape.add', { role: 'event', shape: 'ellipse', rect: { cx: x, cy: y, w: 0.8, h: 0.8 } }); c('object.code', { id: ev, code: EVENTS['step up'] }); }
  } },
  { path: 'Music/Travelers and events', title: 'Events that act: reflect and split', icon: 'event', build: (c, at) => {
    const [x0, y0] = at;
    const line = c('line.add', { points: [[x0 - 6, y0], [x0 + 6, y0]], style: { path: 'straight' } });
    c('traveler.add', { on: line, dur: 6, loop: 1, size: 0.35 });
    const wall = c('line.add', { points: [[x0 + 4, y0 - 1.2], [x0 + 4.2, y0 + 1.2]] });
    c('object.role', { id: wall, role: 'event' }); c('object.code', { id: wall, code: EVENTS['note and reflect'] });
    const fork = c('line.add', { points: [[x0 - 1, y0 - 1.2], [x0 - 0.8, y0 + 1.2]] });
    c('object.role', { id: fork, role: 'event' }); c('object.code', { id: fork, code: EVENTS.split });
    const box = c('shape.add', { role: 'event', rect: { cx: x0 - 4, cy: y0, w: 1.2, h: 1.6 } });
    c('object.code', { id: box, code: EVENTS.gate });
  } },

  // ---- imports and scales ---------------------------------------------------------------

  { path: 'Music/Imports', title: 'IanniX: a rosette', icon: 'open', build: (c, at) => {
    const plan = iannixPlan(`function makeWithScript() { title("Rosette");
      for (var k = 0; k < 4; k++) { run("add curve " + (100 + k)); run("setPointsEllipse current " + (2 + k) + " " + (1 + k * 0.6)); run("add cursor " + (200 + k)); run("setCurve current lastCurve"); run("setSpeed current auto " + (3 + k * 1.5)); run("setPattern current 0 0 1"); }
      for (var i = 0; i < 16; i++) { run("add trigger " + (300 + i)); run("setPos current " + (Math.cos(i / 16 * TWO_PI) * 4) + " " + (Math.sin(i / 16 * TWO_PI) * 2.8)); }
    }`, { width: 12, at });
    applyPlan(plan, c, 0.5);
  } },
  { path: 'Music/Scales', title: 'Just intonation in a score', icon: 'score', build: (c, at) => {
    // a scale as steps in semitones, fractional: near just intonation; the score follows the timeline's
    c('music.set', { scale: [0, 2.04, 3.86, 4.98, 7.02, 8.84, 10.88], root: 60, low: 55, high: 79 });
    c('shape.add', { role: 'score', rect: { cx: at[0], cy: at[1], w: 11, h: 4 } });
    for (let k = 0; k < 3; k++) c('line.add', { points: wave(at[0] - 5 + k * 0.6, at[1] - 1.2 + k * 0.9, 26, 0.38, (i) => Math.sin(i * 0.3 + k) * 0.6) });
  } },

  // ---- nodes: Midinous's kinds of point, and their logic ------------------------------

  { path: 'Music/Nodes', title: 'A switch takes turns', icon: 'g.switch', build: (c, at) => {
    // the start splits each lap: one way past a switch to a note, the other round and back;
    // the switch is on and off in turn, so the note sounds every other lap
    applyNous(nousPlan({ settings: { tempo: 100 }, points: [
      { id: 1, x: 0, y: 0, type: 'anchor', isStart: true, playMode: 'split', to: [2, 4] },
      { id: 2, x: 0, y: -288, type: 'switch', to: [3] },
      { id: 3, x: 0, y: -576, type: 'note', note: 72, to: [] },
      { id: 4, x: 576, y: 0, type: 'note', note: 60, duration: 0.5, to: [1] },
    ] }, { cell: 1, at }), c);
  } },
  { path: 'Music/Nodes', title: 'A gate reads a light', icon: 'g.gate', build: (c, at) => {
    // an LED lights as the traveler passes it; further on, a gate lets the traveler through only
    // while that LED is still lit (its input, by name); two LEDs, one long and one short
    applyNous(nousPlan({ settings: { tempo: 110 }, points: [
      { id: 1, x: 0, y: 0, type: 'anchor', isStart: true, playMode: 'split', to: [2, 5] },
      { id: 2, x: 288, y: 0, type: 'led', duration: 4, to: [3], SerializableLogicPathTo: [3] },
      { id: 3, x: 864, y: 0, type: 'gate', to: [4] },
      { id: 4, x: 1152, y: 0, type: 'note', note: 76, to: [] },
      { id: 5, x: 288, y: 288, type: 'led', duration: 0.5, to: [6], SerializableLogicPathTo: [6] },
      { id: 6, x: 864, y: 288, type: 'gate', to: [7] },
      { id: 7, x: 1152, y: 288, type: 'note', note: 64, to: [] },
    ] }, { cell: 1, at }), c);
  } },
  { path: 'Music/Nodes', title: 'Nodes on a drawn line', icon: 'g.note', build: (c, at) => {
    // the point tool puts nodes on any line: here a curve with note nodes, a counter and a terminator
    const pts = Array.from({ length: 36 }, (_, i) => [+(at[0] - 6 + i * 0.34).toFixed(3), +(at[1] + Math.sin(i * 0.3) * 1.5).toFixed(3)]);
    const line = c('line.add', { points: pts });
    [[0.12, 'note', 60], [0.28, 'note', 64], [0.44, 'counter'], [0.6, 'note', 67], [0.76, 'note', 71]].forEach(([u, kind, n]) => {
      c('joint.add', { at: [{ id: line, u }], node: true, glyph: kind, code: nodeCodeFor(kind, n ?? 60) });
    });
    c('joint.add', { at: [{ id: line, u: 0.95 }], node: true, glyph: 'terminator', code: nodeCodeFor('terminator') });
    c('traveler.add', { on: line, dur: 8, loop: 1, size: 0.35 });
  } },
  { path: 'Drawing/Points', title: 'Every kind of point', icon: 'point', build: (c, at) => {
    POINT_KINDS.forEach((k, i) => c('point.add', { at: [at[0] - 5 + (i % 6) * 2, at[1] + (i < 6 ? 1 : -1)], glyph: k, size: 0.7 }));
  } },

  // ---- 3D: render targets as scenes to draw, build and play in -------------------------

  { path: 'Space/3D', title: 'Marks into a 3D scene', icon: 'target', build: (c, at) => {
    // lines drawn flat, then a render target over them: it takes them in, with their node and traveler
    const wave = c('line.add', { points: Array.from({ length: 30 }, (_, i) => [+(at[0] - 4 + i * 0.28).toFixed(3), +(at[1] + Math.sin(i * 0.35) * 1.4).toFixed(3)]) });
    const flat = c('line.add', { points: [[at[0] - 3, at[1] - 2], [at[0] + 3.5, at[1] - 2]], style: { path: 'straight' } });
    c('joint.add', { at: [{ id: wave, u: 0.5 }], node: true, glyph: 'note', code: nodeCodeFor('note', 67) });
    c('traveler.add', { on: wave, dur: 4, loop: 1 });
    const t = c('shape.add', { role: 'target', rect: { cx: at[0], cy: at[1], w: 11, h: 6.5 } });
    c('target.set', { id: t, az: 0.6, el: 0.35 });
    c('target.take', { id: t, ids: [wave, flat] });
  } },
  { path: 'Space/3D', title: 'A Poly Build mesh', icon: 'mesh', build: (c, at) => {
    const t = c('shape.add', { role: 'target', rect: { cx: at[0], cy: at[1], w: 10, h: 6.5 } });
    c('target.set', { id: t, az: 0.7, el: 0.5 });
    // a strip of quads bent upward, as an edge pulled out again and again would make
    const verts = [], faces = [];
    for (let i = 0; i <= 4; i++) { const a = i * 0.35; verts.push([-2 + i, Math.sin(a) * 1.2, -1], [-2 + i, Math.sin(a) * 1.2, 1]); }
    for (let i = 0; i < 4; i++) faces.push([i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1]);
    c('mesh.add', { space: t, verts, faces, style: { fill: '#0f766e' } });
  } },
  { path: 'Space/3D', title: 'Events in 3D', icon: 'event', build: (c, at) => {
    const t = c('shape.add', { role: 'target', rect: { cx: at[0], cy: at[1], w: 10, h: 6.5 } });
    c('target.set', { id: t, az: 0.5, el: 0.3 });
    const line = c('line.add', { space: t, points: Array.from({ length: 24 }, (_, i) => { const a = (i / 23) * Math.PI * 2; return [Math.cos(a) * 2.5, Math.sin(a * 2) * 0.8, Math.sin(a) * 2.5]; }) });
    c('traveler.add', { on: line, dur: 6, loop: 1 });
    // a bar it passes near, a ring it goes through, points it passes
    const bar = c('line.add', { space: t, points: [[2.5, -1.2, 0], [2.5, 1.2, 0]], style: { path: 'straight' } });
    c('object.role', { id: bar, role: 'event' });
    const ring = c('line.add', { space: t, points: Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return [-2.5 + Math.cos(a) * 0.1, Math.sin(a) * 0.7, Math.cos(a) * 0.7]; }), closed: true });
    c('object.role', { id: ring, role: 'event' });
    for (const k of [3, 9, 15]) { const a = (k / 23) * Math.PI * 2; c('point.add', { space: t, at: [Math.cos(a) * 2.5, Math.sin(a * 2) * 0.8, Math.sin(a) * 2.5], glyph: 'led', size: 0.5, role: 'event' }); }
  } },
  { path: 'Space/3D', title: 'A grease pencil stroke', icon: 'draw', build: (c, at) => {
    const t = c('shape.add', { role: 'target', rect: { cx: at[0], cy: at[1], w: 10, h: 6.5 } });
    c('target.set', { id: t, az: 0.4, el: 0.3 });
    const n = 40, pts = Array.from({ length: n }, (_, i) => [-3 + i * 0.15, Math.sin(i * 0.25) * 1.2, Math.cos(i * 0.2) * 0.8]);
    c('line.add', { space: t, points: pts, pen: pts.map((_, i) => [i * 20, 0.1 + 0.85 * Math.sin((i / (n - 1)) * Math.PI)]), style: { width: 5, stroke: '#e8e2d4' } });
    c('line.add', { space: t, points: Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2; return [1.5 + Math.cos(a), -1.2, Math.sin(a)]; }), closed: true, style: { fill: '#c2410c', stroke: '#f97316' } });
  } },
  // ---- synths you draw: a curve is a wave, an envelope, a shaper or a spectrum (synth.js) ----
  { path: 'Sound/Synths you draw', title: 'Subtractive: a saw through a filter', icon: 'syn.filter', build: (c, at) => synthExample(c, at, 11, [
    { key: 'osc', line: SAW, kind: 'osc', at: [-6, 1.5], straight: true },
    { key: 'filter', kind: 'filter', at: [-2, 1.5], params: { hz: 400, q: 6, depth: 2600 } },
    { key: 'amp', kind: 'amp', at: [1.5, 1.5] },
    { key: 'out', kind: 'out', at: [5, 1.5] },
    { key: 'fenv', line: PLUCK, kind: 'env', at: [-6, -1.2], straight: true, params: { dur: 0.5 } },
    { key: 'aenv', line: ADSR, kind: 'env', at: [-2, -1.2], straight: true, params: { dur: 0.8 } },
  ], ['osc.audio -> filter.audio', 'fenv.level -> filter.cutoff', 'filter.audio -> amp.audio', 'aenv.level -> amp.level', 'amp.audio -> out.audio']) },
  { path: 'Sound/Synths you draw', title: 'FM: one wave bends another', icon: 'syn.osc', build: (c, at) => synthExample(c, at, 12, [
    { key: 'mod', line: SINE, kind: 'osc', at: [-6, 1.5], params: { ratio: 2, level: 1.5 } },
    { key: 'car', line: SINE, kind: 'osc', at: [-2, 1.5], params: { fm: 400 } },
    { key: 'amp', kind: 'amp', at: [1.5, 1.5] },
    { key: 'out', kind: 'out', at: [5, 1.5] },
    { key: 'env', line: PLUCK, kind: 'env', at: [-2, -1.2], straight: true, params: { dur: 0.9 } },
  ], ['mod.audio -> car.fm', 'car.audio -> amp.audio', 'env.level -> amp.level', 'amp.audio -> out.audio'], [0, 3, 5, 9]) },
  { path: 'Sound/Synths you draw', title: 'Additive: the curve is the spectrum', icon: 'syn.partials', build: (c, at) => synthExample(c, at, 13, [
    { key: 'parts', line: FALLING, kind: 'partials', at: [-5, 1.5], w: 3, params: { count: 16 } },
    { key: 'amp', kind: 'amp', at: [0, 1.5] },
    { key: 'out', kind: 'out', at: [4, 1.5] },
    { key: 'env', line: SWELL, kind: 'env', at: [-5, -1.2], straight: true, params: { dur: 0.6, release: 0.6 } },
  ], ['parts.audio -> amp.audio', 'env.level -> amp.level', 'amp.audio -> out.audio'], [0, 4, 7, 11]) },
  { path: 'Sound/Synths you draw', title: 'Nested: an instrument, a voice inside, its parts inside that', icon: 'collapse', build: (c, at) => synthExample(c, at, 15, [
    { key: 'osc', line: SAW, kind: 'osc', preset: 'saw', at: [-6, 1.5] },
    { key: 'sub', line: SINE, kind: 'osc', preset: 'square', at: [-6, 3.6], params: { ratio: 0.5, level: 0.5 } },
    { key: 'mix', kind: 'mix', at: [-2.5, 2.5] },
    { key: 'filter', kind: 'filter', at: [0.5, 2.5], params: { hz: 300, q: 8, depth: 3000 } },
    { key: 'fenv', line: PLUCK, kind: 'env', preset: 'pluck', at: [-2.5, -0.6], params: { dur: 0.5, sync: 1 } },
    { key: 'amp', kind: 'amp', at: [3.5, 2.5] },
    { key: 'aenv', line: ADSR, kind: 'env', preset: 'adsr', at: [0.5, -0.6], params: { dur: 1, sync: 1, release: 0.5 } },
    { key: 'out', kind: 'out', at: [6.5, 2.5], params: { bpm: 0 } },
  ], ['osc.audio -> mix.a', 'sub.audio -> mix.b', 'mix.audio -> filter.audio', 'fenv.level -> filter.cutoff', 'filter.audio -> amp.audio', 'aenv.level -> amp.level', 'amp.audio -> out.audio'], [0, 3, 7, 10],
  [['oscillators', ['osc', 'sub', 'mix']], ['voice', ['oscillators', 'filter', 'fenv', 'amp', 'aenv']], ['instrument', ['voice', 'out']]]) },
  { path: 'Sound/Synths you draw', title: 'Waveshaping: a curve bends the sound', icon: 'syn.shaper', build: (c, at) => synthExample(c, at, 14, [
    { key: 'osc', line: SINE, kind: 'osc', at: [-7, 1.5] },
    { key: 'shape', line: TANH, kind: 'shaper', at: [-3.5, 1.5], params: { drive: 3 } },
    { key: 'amp', kind: 'amp', at: [0.5, 1.5] },
    { key: 'out', kind: 'out', at: [4, 1.5] },
    { key: 'env', line: ADSR, kind: 'env', at: [-3.5, -1.2], straight: true, params: { dur: 0.7 } },
  ], ['osc.audio -> shape.audio', 'shape.audio -> amp.audio', 'env.level -> amp.level', 'amp.audio -> out.audio'], [0, 2, 3, 5]) },
];
