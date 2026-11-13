// Starting code for objects. The header comments are the blanket.
// A body receives (inp, p, t, geom, mem) and returns its outputs.

export const PRESETS = {
  osc: `// osc
// out: y
// param: hz 0.2
return { y: Math.sin(t * p.hz * Math.PI * 2) };`,

  ramp: `// ramp
// out: y
// param: hz 0.1
return { y: (t * p.hz) % 1 };`,

  scale: `// scale
// in: x
// out: y
// param: gain 0.5
// param: add 0
return { y: inp.x * p.gain + p.add };`,

  mix: `// mix
// in: a b
// out: y
// param: balance 0.5
return { y: inp.a * (1 - p.balance) + inp.b * p.balance };`,

  smooth: `// smooth
// in: x
// out: y
// param: rate 0.05
mem.y = (mem.y ?? 0) + (inp.x - (mem.y ?? 0)) * p.rate;
return { y: mem.y };`,

  // For a drawn mark: a cursor travels along the drawing.
  path: `// path
// out: x y
// param: speed 0.1
const q = geom.at((t * p.speed) % 1);
return { x: q[0], y: q[1] };`,
};
