import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, call } from '../src/space.js';
import { portPos } from '../src/object.js';
import { planInstrument, waveOf, envOf, shaperOf, partialsOf, claimOf, instrumentId, kindOf } from '../src/synth.js';

const sine = (x, y) => Array.from({ length: 33 }, (_, i) => [x + i / 16, y + Math.sin((i / 32) * Math.PI * 2)]);
const wire = (a, out, b, inn) => { const p = portPos(state.objects.get(a), 'outs', out), q = portPos(state.objects.get(b), 'ins', inn); return call('line.add', { points: [p, q], tol: 0.05 }); };

test('a drawn curve read as a wave, an envelope, a shaper and partials', () => {
  call('space.clear');
  const w = waveOf({ kind: 'line', points: sine(0, 0), off: [0, 0] });
  const mag = (k) => Math.hypot(w.real[k], w.imag[k]);
  assert.ok(mag(1) > 0.9 && mag(2) < 0.05 && mag(3) < 0.05, `harmonics ${[1, 2, 3].map(mag)}`);
  const e = envOf({ kind: 'line', points: [[0, 0], [1, 2], [3, 1]], style: { path: 'straight' }, off: [0, 0] });
  assert.equal(e[0], 0); assert.ok(Math.abs(Math.max(...e) - 1) < 1e-6); assert.ok(Math.abs(e.at(-1) - 0.5) < 1e-3);
  const s = shaperOf({ kind: 'line', points: [[0, 0], [1, 1]], off: [0, 0] });
  assert.equal(s[0], -1); assert.equal(s.at(-1), 1);
  const p = partialsOf({ kind: 'line', points: [[0, 3], [1, 1], [2, 0]], style: { path: 'straight' }, off: [0, 0] }, 3);
  assert.deepEqual([...p.imag].map((v) => Math.round(v * 100) / 100), [0, 1, 0.33, 0]);
});

test('parts wired into an instrument; it claims a channel and can be named', () => {
  call('space.clear');
  const osc = call('line.add', { points: sine(0, 0) });
  const env = call('line.add', { points: [[0, -4], [0.2, -2], [2, -3]], style: { path: 'straight' } });
  const amp = call('shape.add', { role: 'visual', rect: { cx: 6, cy: 0, w: 2, h: 1.4 } });
  const out = call('shape.add', { role: 'visual', rect: { cx: 10, cy: 0, w: 2, h: 1.4 } });
  const stray = call('line.add', { points: sine(0, 8) });
  for (const [id, k] of [[osc, 'osc'], [env, 'env'], [amp, 'amp'], [out, 'out'], [stray, 'osc']]) assert.equal(call('synth.make', { id, kind: k }), true);
  assert.throws(() => call('synth.make', { id: amp, kind: 'osc' }), /cannot be a osc/);
  assert.equal(kindOf(state.objects.get(osc)), 'osc');
  const w1 = wire(osc, 'audio', amp, 'audio'), w2 = wire(env, 'level', amp, 'level'), w3 = wire(amp, 'audio', out, 'audio');
  assert.ok([w1, w2, w3].every((id) => state.objects.get(id).bind), 'the three lines became connectors');
  const plan = planInstrument(state.objects, out);
  assert.deepEqual(plan.parts.map((p) => p.kind).sort(), ['amp', 'env', 'osc', 'out']); // not the stray oscillator
  assert.equal(plan.wires.length, 3);
  assert.ok(plan.parts.find((p) => p.kind === 'osc').data.imag instanceof Float32Array);
  assert.equal(claimOf(state.objects, 5), null);
  call('object.set', { id: out, name: 'channel', value: 5 });
  assert.equal(claimOf(state.objects, 5), out);
  call('object.name', { id: out, name: 'reed' });
  assert.equal(instrumentId(state.objects, 'reed'), out);
  call('music.set', { channels: { 3: 'reed' } });
  assert.equal(state.music.channels[3], 'reed');
  assert.throws(() => call('music.set', { channels: { 4: 'kazoo' } }), /drawn synth/);
});
