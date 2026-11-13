// Examples: small things to start from. Each is built through commands, at
// a point the app chooses, so adding one is one step for undo.
//   build(c, at): c(name, args) runs a command; at is [x, y], the centre.

import { PRESETS } from './presets.js';

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

export const EXAMPLES = [
  { title: 'An oscillator turns a view', icon: 'target', build: (c, at) => c('patch.add', { at, nodes: [{ key: 'osc', preset: 'osc' }, { key: 'scale', preset: 'scale' }, { key: 'view', role: 'target' }], links: ['osc.y -> scale.x', 'scale.y -> view.spin'] }) },
  { title: 'A score: lines as sound', icon: 'score', build: (c, at) => {
    c('shape.add', { role: 'score', rect: { cx: at[0], cy: at[1], w: 11, h: 4 } });
    for (let k = 0; k < 3; k++) c('line.add', { points: wave(at[0] - 5 + k * 0.8, at[1] - 1.4 + k * 0.9, 24, 0.36, (i) => Math.sin(i * 0.45 + k) * 0.7 + i * 0.04) });
  } },
  { title: 'A path sends itself to a follower', icon: 'path', build: (c, at) => {
    const r = c('patch.add', { at: [at[0] + 3, at[1]], nodes: [{ key: 'follow', preset: 'follow' }] });
    const line = c('line.add', { points: wave(at[0] - 6, at[1], 30, 0.12, (i) => Math.sin(i * 0.5) * 0.9), role: 'path' });
    return { connect: [[line, 'path', r.ids.follow, 'path']] };
  } },
  { title: 'A path made by code', icon: 'path', build: (c, at) => {
    const id = c('line.add', { points: [[at[0] - 4, at[1]], [at[0] + 4, at[1]]], role: 'path' });
    c('object.code', { id, code: PRESETS.wave });
  } },
  { title: 'A p5.js sketch', icon: 'box', build: (c, at) => c('shape.add', { role: 'code', code: P5, rect: { cx: at[0], cy: at[1], w: 6, h: 4.5 } }) },
  { title: 'A three.js sketch', icon: 'box', build: (c, at) => c('shape.add', { role: 'code', code: THREE, rect: { cx: at[0], cy: at[1], w: 6, h: 4.5 } }) },
  { title: 'One reusable group', icon: 'collapse', build: (c, at) => c('patch.add', { at, nodes: [{ key: 'osc', preset: 'osc' }, { key: 'smooth', preset: 'smooth' }, { key: 'out', preset: 'scale' }], links: ['osc -> smooth', 'smooth -> out'], collapse: true, name: 'lfo' }) },
  { title: 'Shapes with colour', icon: 'visual', build: (c, at) => {
    c('shape.add', { rect: { cx: at[0] - 2.2, cy: at[1], w: 3, h: 3 }, style: { fill: '#c2410c', stroke: '#1d1c1a' } });
    c('shape.add', { shape: 'ellipse', rect: { cx: at[0] + 0.4, cy: at[1] + 0.4, w: 3.4, h: 3.4 }, style: { fill: '#0f766e', opacity: 0.8 } });
    c('shape.add', { role: 'note', text: 'a note', rect: { cx: at[0] + 3.6, cy: at[1] - 1, w: 2.6, h: 1.2 } });
  } },
];
