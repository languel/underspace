// Framing: how a render target's 3D view and its flat frame stand for one another. A target's
// camera is a perspective camera (40° tall) that looks at `center` from `dist` away, turned by
// az and el (view.js). Put the camera straight in front, at the distance where the plane z = 0
// exactly fills the frame, and the 3D view is the flat drawing: lines taken in keep their look,
// and lines taken out, projected back through the same camera, land where they showed.
// Pure: no DOM.

export const FOV = 40; // degrees, the vertical field of view
const TAN = Math.tan((FOV / 2) * Math.PI / 180);

// The distance at which the plane z = 0 fills a frame that is `h` tall in scene units.
export const framingDist = (h) => h / (2 * TAN);

// The camera that shows a frame as it was drawn: in front, level, at the framing distance.
export const flatCamera = (rect, span) => {
  const k = span / Math.max(rect.w, rect.h);
  return { az: 0, el: 0, dist: Math.round(framingDist(rect.h * k) * 1000) / 1000, center: [0, 0, 0] };
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

// The camera of a target as a function: scene point -> [x, y] in -1..1 across the frame
// (x to the right, y up), or null where the point is at or behind the camera.
export function camera({ az = 0.5, el = 0.3, dist = 13, center = [0, 0, 0] }, aspect = 1) {
  const e = Math.max(-1.55, Math.min(1.55, el));
  const pos = [center[0] + Math.sin(az) * Math.cos(e) * dist, center[1] + Math.sin(e) * dist, center[2] + Math.cos(az) * Math.cos(e) * dist];
  const f = unit(sub(center, pos)), r = unit(cross(f, [0, 1, 0])), u = cross(r, f);
  return (p) => {
    const d = sub([p[0], p[1], p[2] ?? 0], pos), z = dot(d, f);
    if (z <= 0.05) return null;
    return [dot(d, r) / (z * TAN * aspect), dot(d, u) / (z * TAN)];
  };
}

// A scene point as a point of the canvas, through the target's camera: the frame's middle is
// (cx, cy), and the frame spans w by h. Null behind the camera.
export function flatten(p, cam, rect) {
  const q = camera(cam, rect.w / rect.h)(p);
  return q ? [rect.cx + q[0] * rect.w / 2, rect.cy + q[1] * rect.h / 2] : null;
}
