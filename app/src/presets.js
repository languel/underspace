// Starting code for objects. The header comments are the blanket.
// A body receives (inp, p, t, geom, mem, along) and returns its outputs.
// A value on a connector is a number or a path (an array of points).

export const PRESETS = {
  blank: `// code
// in: x
// out: y
return { y: inp.x };`,

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

  // For a path: a cursor travels along the line.
  // It also sends itself: `path` carries its points to any input that takes one.
  path: `// path
// out: path x y
// param: speed 0.1
const q = geom.at((t * p.speed) % 1);
return { path: geom.points, x: q[0], y: q[1] };`,

  // For a path: the code makes the line, between the ends of what was drawn.
  wave: `// wave
// out: path
// param: cycles 3
// param: amp 0.6
const a = geom.points[0], b = geom.points[geom.points.length - 1];
const points = Array.from({ length: 80 }, (_, i) => {
  const u = i / 79;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + Math.sin(u * p.cycles * Math.PI * 2) * p.amp];
});
return { points, path: points };`,

  // Takes a path from a connector and travels along it.
  follow: `// follow
// in: path
// out: x y
// param: speed 0.1
if (!Array.isArray(inp.path)) return { x: 0, y: 0 };
const q = along(inp.path, (t * p.speed) % 1);
return { x: q[0], y: q[1] };`,
};
