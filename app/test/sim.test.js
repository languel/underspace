import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, call, undo } from '../src/space.js';
import { createWorld, sceneOf, runTo, createSim, TPB } from '../src/sim.js';

const box = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
const ground = { id: 'g', is: 'fixed', parts: [{ pts: [[-20, 0], [20, 0]], closed: false }] };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what ?? ''} ${a} is not within ${tol} of ${b}`);

test('sim: a box falls as gravity says, lands flat, and stays', () => {
  const w = createWorld({ bodies: [ground, { id: 'b', is: 'body', parts: [{ pts: box(0, 5, 2, 2), closed: true }] }] });
  w.to(TPB / 2);
  near(w.outs().get('b').y, 5 - 8 * 0.25, 0.03, 'half a beat of falling'); // 8 t squared, less a little air
  const hits = w.to(TPB * 4);
  assert.equal(hits[0].type, 'hit');
  near(hits[0].speed, 11, 0.5, 'how hard it landed');
  const o = w.outs().get('b');
  near(o.y, 1.08, 0.005, 'at rest on the ground (its skin and the ground\'s between)');
  near(o.x, 0, 1e-6); near(o.spin, 0, 1e-6); near(o.speed, 0, 1e-3);
});

test('sim: a ball bounces back as its bounce says, each time', () => {
  const w = createWorld({ drag: 0, bodies: [ground, { id: 'b', is: 'body', bounce: 0.5, parts: [{ pts: [[0, 4]], closed: false, r: 0.5 }] }] });
  let prev = 0;
  const back = [];
  for (let k = 1; k <= TPB * 3; k++) { w.to(k); const vy = w.outs().get('b').vy; if (prev < -4 && vy > 0) back.push(-vy / prev); prev = vy; }
  assert.ok(back.length >= 2);
  for (const r of back) near(r, 0.5, 0.05, 'speed back over speed in');
});

test('sim: boxes stack; friction holds a box on a slope it can hold, and lets it go on one it cannot', () => {
  const w = createWorld({ bodies: [ground, ...[0, 1, 2].map((i) => ({ id: 'b' + i, is: 'body', parts: [{ pts: box(0, 0.6 + i * 1.1, 1, 1), closed: true }] }))] });
  w.to(TPB * 8);
  [0, 1, 2].forEach((i) => { const o = w.outs().get('b' + i); near(o.x, 0, 0.01, 'stack x'); near(o.y, 0.58 + i * 1.08, 0.01, 'stack y'); });
  const turn = (pts, a) => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const slope = (mu) => { const a = (20 * Math.PI) / 180, s = createWorld({ bodies: [{ id: 'g', is: 'fixed', friction: mu, parts: [{ pts: turn([[-30, 0], [30, 0]], a), closed: false }] }, { id: 'b', is: 'body', friction: mu, parts: [{ pts: turn(box(0, 0.6, 1, 1), a), closed: true }] }] }); const o0 = s.outs().get('b'); s.to(TPB * 4); const o = s.outs().get('b'); return Math.hypot(o.x - o0.x, o.y - o0.y); };
  assert.ok(slope(1) < 0.1, 'held');
  near(slope(0.2), 19.7, 2.5, 'slid about as far as it should');
});

test('sim: a hinge holds; a motor turns a wheel so many times a beat, and a car drives', () => {
  const p = createWorld({ bodies: [{ id: 'b', is: 'body', parts: [{ pts: [[0, 0], [3, 0]], closed: false }] }], joints: [{ id: 'h', is: 'hinge', a: 'b', b: null, at: [0, 0] }] });
  let low = 0;
  for (let k = 0; k <= TPB * 3; k += 4) { p.to(k); const e = p.ends('h'); near(Math.hypot(e[0][0], e[0][1]), 0, 1e-3, 'the pin'); const q = p.poses().get('b').q; low = Math.min(low, 2 * Math.atan2(q[2], q[3])); }
  assert.ok(low < -2.8 && low > -3.2, 'it swung nearly to the other side: ' + low);
  const bodies = [{ ...ground, friction: 1 }, { id: 'c', is: 'body', parts: [{ pts: box(0, 1.2, 3, 0.6), closed: true }] }, ...[-1, 1].map((x) => ({ id: 'w' + x, is: 'body', friction: 1, parts: [{ pts: [[x, 0.6]], closed: false, r: 0.5 }] }))];
  const car = createWorld({ bodies, joints: [-1, 1].map((x) => ({ id: 'h' + x, is: 'hinge', a: 'c', b: 'w' + x, at: [x, 0.6], motor: -1 })) });
  car.to(TPB * 4);
  near(car.outs().get('w1').spin, -1, 0.01, 'a turn a beat');
  near(car.outs().get('c').vx, 2 * Math.PI * 0.54, 0.3, 'as fast as its wheels roll');
});

test('sim: a rope hangs between two pins and keeps its length; a spring settles where its pull meets the weight', () => {
  const w = createWorld({ bodies: [{ id: 'r', is: 'rope', parts: [{ pts: [[0, 0], [6, 0]], closed: false }] }], joints: [{ id: 'a', is: 'hinge', a: 'r', b: null, at: [0, 0] }, { id: 'b', is: 'hinge', a: 'r', b: null, at: [6, 0] }] });
  w.to(TPB * 2);
  const flat = w.poses().get('r').pts, lengthOf = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
  near(lengthOf(flat), 6, 0.09, 'pulled tight, it gives by a hundredth or so');
  const s = createWorld({ bodies: [{ id: 'r', is: 'rope', parts: [{ pts: [[0, 0], [3, -2], [6, 0]], closed: false }] }], joints: [{ id: 'a', is: 'hinge', a: 'r', b: null, at: [0, 0] }, { id: 'b', is: 'hinge', a: 'r', b: null, at: [6, 0] }] });
  s.to(TPB * 8);
  const p = s.poses().get('r').pts;
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  near(L, 2 * Math.hypot(3, 2), 0.15, 'its length');
  assert.ok(p[p.length >> 1][1] < -1.5, 'it hangs');
  const sp = createWorld({ bodies: [{ id: 'b', is: 'body', parts: [{ pts: box(0, -3, 1, 1), closed: true }] }], joints: [{ id: 's', is: 'spring', a: null, b: 'b', pa: [0, 0], pb: [0, -3], stiff: 60, damp: 4, rest: 1 }] });
  sp.to(TPB * 12);
  near(sp.outs().get('b').y, -3 - 16 / 60, 0.02, 'weight over stiffness below where it hung');
});

test('sim: the same every time, and the same whichever way time is travelled', () => {
  const mk = () => createWorld({ bodies: [ground, { id: 'r', is: 'fixed', parts: [{ pts: [[-6, 3], [2, 1]], closed: false }] }, ...[0, 1, 2, 3].map((i) => ({ id: 'b' + i, is: 'body', parts: i % 2 ? [{ pts: [[-4 + i, 5 + i * 1.5]], closed: false, r: 0.5 }] : [{ pts: box(-4 + i, 5 + i * 1.5, 1, 1), closed: true }] }))] });
  const a = mk(), b = mk();
  const ea = a.to(TPB * 6);
  b.to(TPB * 2); b.to(TPB * 7); b.to(TPB * 3); b.to(TPB * 6);
  assert.deepEqual([...a.poses()], [...b.poses()]);
  assert.ok(ea.length > 3);
  // back to the start is the drawing again
  a.to(0);
  assert.deepEqual(a.poses().get('b0').x, a.poses().get('b0').x0);
});

test('sim: in three dimensions as in two', () => {
  const w = createWorld({ gravity: [0, -16, 0], bodies: [{ id: 'g', is: 'fixed', flat: false, parts: [{ pts: [[-5, 0, -1], [5, 0, 1]], closed: false }] }, { id: 'b', is: 'body', flat: false, parts: [{ pts: [[1, 3, 0.2]], closed: false, r: 0.5 }] }, { id: 'c', is: 'body', flat: false, parts: [{ pts: [[0, 2, 3]], closed: false, r: 0.5 }] }] });
  w.to(TPB * 3);
  near(w.outs().get('b').y, 0.58, 0.02, 'the one above the line rests on it');
  assert.ok(w.outs().get('c').y < -20, 'the one beside it falls past');
});

test('sim: objects made physical by command; an event is felt; read and keep', () => {
  call('space.clear');
  const g = call('line.add', { points: [[-10, 0], [10, 0]], style: { path: 'straight' } });
  const b = call('shape.add', { rect: { cx: 0, cy: 4, w: 1, h: 1 }, shape: 'ellipse' });
  const bar = call('shape.add', { rect: { cx: 0, cy: 2, w: 4, h: 0.2 }, role: 'event' });
  const pin = call('point.add', { at: [3, 5] });
  assert.throws(() => call('object.phys', { ids: [b] }), /not physical yet/);
  assert.throws(() => call('object.phys', { ids: [b], is: 'hinge' }), /a hinge is a point/);
  assert.equal(call('object.phys', { ids: [g], is: 'fixed' }), 1);
  call('object.phys', { ids: [b], is: 'body', bounce: 0.6 });
  call('object.phys', { ids: [b], friction: 0.9 }); // parameters only: what it is stays
  assert.deepEqual(state.objects.get(b).phys, { is: 'body', bounce: 0.6, friction: 0.9 });
  const sc = sceneOf(state.objects);
  assert.deepEqual(sc.scene.bodies.map((x) => [x.id, x.is, !!x.sensor]), [[g, 'fixed', false], [b, 'body', false], [bar, 'fixed', true]]);
  const r = call('sim.read', { beat: 2 });
  assert.equal(r.hits[0].type, 'enter'); assert.deepEqual([r.hits[0].a, r.hits[0].b].sort(), [b, bar].sort());
  assert.ok(r.hits.some((h) => h.type === 'hit' && [h.a, h.b].includes(g)), 'it went through the event and struck the ground');
  near(r.things.find((t) => t.id === b).y, 0.58, 0.6);
  // a hinge with nothing under it holds nothing; over the ball, it holds it up
  call('object.phys', { ids: [pin], is: 'hinge' });
  assert.equal(sceneOf(state.objects).scene.joints.length, 0);
  call('object.move', { ids: [pin], dx: -3, dy: -1 });
  assert.deepEqual(sceneOf(state.objects).scene.joints.map((j) => [j.a, j.b]), [[b, null]]);
  near(call('sim.read', { beat: 2 }).things.find((t) => t.id === b).y, 4, 0.01, 'held');
  call('object.phys', { ids: [pin], is: null });
  // keep: a moment becomes the drawing
  call('sim.keep', { beat: 4 });
  near(state.objects.get(b).rect.cy, 0.58, 0.05, 'the ball is drawn where it came to rest');
  undo();
  assert.equal(state.objects.get(b).rect.cy, 4);
  // the world: no gravity, nothing falls
  call('sim.set', { gravity: [0, 0] });
  near(call('sim.read', { beat: 4 }).things.find((t) => t.id === b).y, 4, 1e-9);
  call('sim.set', { gravity: null });
  assert.deepEqual(state.sim, {});
});

test('sim: the open drawing, frame by frame: hits fire events, quantized when asked; a weld makes one body', () => {
  call('space.clear');
  const g = call('line.add', { points: [[-10, 0], [10, 0]], style: { path: 'straight' } });
  call('object.role', { id: g, role: 'event' });
  const b = call('shape.add', { rect: { cx: 0, cy: 4, w: 1, h: 1 }, shape: 'ellipse' });
  call('object.phys', { ids: [g], is: 'fixed' }); call('object.phys', { ids: [b], is: 'body' });
  const run = (quant) => {
    const sim = createSim(), fired = [];
        sim.frame(state.objects, state.version, 0, false, {});
    for (let beat = 0; beat <= 2; beat += 1 / 16) { const f = sim.frame(state.objects, state.version, beat, true, { quant, fire: (o, ev) => fired.push({ id: o.id, tick: f0(beat), ev }) }); assert.equal(f.tick, f0(beat)); }
    return fired;
  };
  const f0 = (beat) => Math.floor(beat * TPB + 1e-6);
  const free = run(0), held = run(0.5);
  assert.equal(free[0].id, g);
  assert.ok(free[0].ev.hit > 8 && free[0].ev.vel > 60 && free[0].ev.y === 0, JSON.stringify(free[0].ev));
  assert.ok(free[0].tick < TPB && free[0].tick % (TPB / 2) !== 0, 'as it lands');
  assert.equal(held[0].tick, TPB, 'held to the next half beat');
  // two boxes welded fall as one
  const c = call('shape.add', { rect: { cx: 5, cy: 4, w: 1, h: 1 } }), d = call('shape.add', { rect: { cx: 6, cy: 4, w: 1, h: 1 } }), w = call('point.add', { at: [5.5, 4] });
  call('object.phys', { ids: [c, d], is: 'body' }); call('object.phys', { ids: [w], is: 'weld' });
  const sc = sceneOf(state.objects);
  assert.equal(sc.owner.get(c), sc.owner.get(d));
  const r = runTo(state.objects, 3);
  assert.deepEqual(r.poses.get(c), r.poses.get(d));
  assert.deepEqual(r.poses.get(w), r.poses.get(c), 'the weld rides on them');
});

test('sim: what comes from outside while it plays: a traveler carries, code pushes, a signal shakes; and it is kept', () => {
  call('space.clear');
  // a bat carried along a rail by the score, and a box on it
  const rail = call('line.add', { points: [[-3, 0], [3, 0]], style: { path: 'straight' } });
  const bat = call('shape.add', { rect: { cx: -3, cy: 0, w: 2, h: 0.3 } });
  call('traveler.attach', { id: bat, on: rail, u: 0 });
  call('object.phys', { ids: [bat], is: 'fixed', friction: 1 });
  const ball = call('shape.add', { rect: { cx: -3, cy: 0.5, w: 0.5, h: 0.5 } }); // (a box: a ball would roll back along it)
  call('object.phys', { ids: [ball], is: 'body', friction: 1, bounce: 0 });
  // a box whose code pushes it up, harder than gravity pulls
  const box = call('shape.add', { role: 'code', code: '// up\n// out: fy\nreturn { fy: 24 };', rect: { cx: 10, cy: 0, w: 1, h: 1 } });
  call('object.phys', { ids: [box], is: 'body' });
  // a wire between two code boxes, made a rope
  const a = call('shape.add', { role: 'code', code: '// a\n// out: y\nreturn { y: 1 };', rect: { cx: 20, cy: 0, w: 2, h: 1 } });
  const b = call('shape.add', { role: 'code', code: '// b\n// in: x\nreturn {};', rect: { cx: 26, cy: 0, w: 2, h: 1 } });
  const wire = call('line.add', { points: [[21, 0], [25, 0]] });
  call('object.role', { id: wire, role: 'connector', tol: 0.5 });
  assert.ok(state.objects.get(wire).bind, 'the wire is bound');
  call('object.phys', { ids: [wire], is: 'rope' });

  const sim = createSim();
  const frame = (beat, playing, signal = 0) => sim.frame(state.objects, state.version, beat, playing, {
    moved: new Map([[bat, [-3 + Math.min(6, beat * 1.5), 0]]]), // the traveler: 1.5 units a beat to the right
    output: (id, port) => (id === box && port === 'fy' ? 24 : id === a && port === 'y' ? signal : 0),
  });
  frame(0, false);
  frame(6, false); // the playhead moved ahead while nothing played: nothing came from outside
  const ahead = frame(6, false);
  assert.ok(ahead.outs.get(box).y < -100, 'unpushed, the box fell');
  frame(0, false);
  let f;
  for (let beat = 0; beat <= 3; beat += 1 / 30) f = frame(beat, true, Math.sin(beat * 20));
  near(f.outs.get(bat).x, -3 + 4.5, 0.1, 'the bat is where the traveler is');
  near(f.outs.get(bat).vx, 1.5, 0.1, 'and is felt to move');
  near(f.outs.get(ball).x, f.outs.get(bat).x, 0.6, 'the box rides on it');
  near(f.outs.get(ball).y, 0.15 + 0.25 + 0.08, 0.03);
  near(f.outs.get(box).y, 0.5 * 8 * 9 * 0.98, 1.5, 'pushed up at 24 against 16, it rises 4 t squared');
  const sag = (fr) => { const p = fr.poses.get(wire).pts; return p[p.length >> 1][1]; };
  assert.ok(sag(f) < -0.3, 'the cable hangs: ' + sag(f));
  // played again from the start with nothing new coming in, it is the same: what came in was kept
  frame(0, true);
  let again;
  for (let beat = 0; beat <= 3; beat += 1 / 30) again = sim.frame(state.objects, state.version, beat, true, {});
  assert.deepEqual(again.outs.get(box), f.outs.get(box));
  assert.deepEqual(again.poses.get(wire), f.poses.get(wire));
  // and without the signal the cable hangs otherwise
  const still = createSim();
  let q;
  for (let beat = 0; beat <= 3; beat += 1 / 30) q = still.frame(state.objects, state.version, beat, true, { moved: new Map(), output: () => 0 });
  assert.notDeepEqual(q.poses.get(wire), f.poses.get(wire));
});

test('sim: in a render target the drawing is in three dimensions, and so is what happens to it', async () => {
  const { setPosed, ptsOf } = await import('../src/object.js');
  call('space.clear');
  const t = call('shape.add', { role: 'target', rect: { cx: 0, cy: 0, w: 8, h: 6 } });
  const floor = call('line.add', { space: t, points: [[-3, -1, -1], [3, -1, 1]], style: { path: 'straight' } });
  const stick = call('line.add', { space: t, points: [[-0.5, 1, -0.2], [0.5, 1.4, 0.2]], style: { path: 'straight' } });
  call('object.phys', { ids: [floor], is: 'fixed' }); call('object.phys', { ids: [stick], is: 'body' });
  const sc = sceneOf(state.objects);
  assert.deepEqual(sc.scene.bodies.map((b) => b.flat), [false, false]);
  const r = runTo(state.objects, 4);
  assert.ok(r.events.some((e) => e.type === 'hit'), 'the stick struck the floor line');
  setPosed(r.poses);
  const p = ptsOf(state.objects.get(stick));
  setPosed(null);
  assert.equal(p[0].length, 3);
  near(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]), Math.hypot(1, 0.4, 0.4), 1e-6, 'it kept its length');
  assert.ok(p[0][1] < 1 && Math.abs(p[0][2] + 0.2) > 1e-3, 'it fell, and turned out of its plane');
  assert.deepEqual(ptsOf(state.objects.get(stick)), [[-0.5, 1, -0.2], [0.5, 1.4, 0.2]], 'the drawing itself is as it was');
});
