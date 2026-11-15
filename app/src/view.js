// The renderer: one three.js canvas. The canvas view is an orthographic
// camera over the ink (lines, connectors, shape outlines); each render target
// gets its own perspective view, drawn into its rectangle. Faces and their
// text are DOM (faces.js), laid over this.

import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const VIEW_H = 10; // world units from top to bottom at zoom 1

export async function createView({ canvas, stage, onFrame }) {
  const forceWebGL = new URLSearchParams(location.search).has('gl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL });
  await renderer.init();
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const ink = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  const cam = { cx: 0, cy: 0, zoom: 1 };
  const size = { w: 2, h: 2 };

  // ---- colours and shared materials (one per colour and width) -------------
  const colors = {};
  for (const name of ['ink', 'accent', 'hot', 'muted', 'line']) colors[name] = uniform(new THREE.Color());
  const bg = new THREE.Color();
  const materials = new Map();
  // A colour is a theme name ('ink', 'accent', ...) or any CSS colour.
  const custom = new Map();
  function colorNode(c) {
    if (colors[c]) return colors[c];
    let n = custom.get(c);
    if (!n) { n = uniform(new THREE.Color(c)); custom.set(c, n); }
    return n;
  }
  function material(color, width, opacity = 1) {
    const key = `${color}|${width}|${opacity}`;
    let m = materials.get(key);
    if (!m) {
      m = width ? new THREE.Line2NodeMaterial() : new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      if (width) m.linewidth = width;
      m.colorNode = colorNode(color);
      m.depthTest = false; // drawn in document order, not by depth
      if (opacity < 1) { m.transparent = true; m.opacity = opacity; }
      materials.set(key, m);
    }
    return m;
  }
  function makeFill(pts, color, opacity) {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    return new THREE.Mesh(new THREE.ShapeGeometry(shape), material(color, 0, opacity));
  }
  function makeLine(pts, color, width, z = 0, opacity = 1) {
    const pos = [];
    if (pts.length === 1) pos.push(pts[0][0] - 0.03, pts[0][1], pts[0][2] ?? z, pts[0][0] + 0.03, pts[0][1], pts[0][2] ?? z);
    else for (const p of pts) pos.push(p[0], p[1], p[2] ?? z);
    const geometry = new LineGeometry();
    geometry.setPositions(pos);
    const line = new Line2(geometry, material(color, width, opacity));
    line.frustumCulled = false;
    return line;
  }
  function empty(group) { for (const c of [...group.children]) { group.remove(c); c.geometry?.dispose(); } }

  // ---- lines kept and reused ----------------------------------------------------
  // While anything moves, the drawing changes every frame. Making new line objects every frame
  // leaks in the WebGPU renderer (it keeps what it needs for every object it has drawn), so a
  // group keeps its lines and fills and reuses them: positions are written into buffers that only
  // grow (to the next power of two), and what is not needed this frame is hidden.
  const pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
  function writeLine(line, pts, z) {
    const n = Math.max(1, pts.length - 1), g = line.geometry, buf = g.attributes.instanceStart?.data;
    let arr = buf?.array;
    if (!arr || arr.length < n * 6) {
      g.dispose();
      const fresh = new LineGeometry();
      fresh.setPositions(new Float32Array(pow2(n) * 6));
      line.geometry = fresh;
      arr = fresh.attributes.instanceStart.data.array;
    }
    const P = (i) => pts[i], put = (o, p) => { arr[o] = p[0]; arr[o + 1] = p[1]; arr[o + 2] = p[2] ?? z; };
    if (pts.length === 1) { const p = P(0); put(0, [p[0] - 0.03, p[1], p[2]]); put(3, [p[0] + 0.03, p[1], p[2]]); }
    else for (let i = 0; i < n; i++) { put(i * 6, P(i)); put(i * 6 + 3, P(i + 1)); }
    line.geometry.attributes.instanceStart.data.needsUpdate = true;
    line.geometry.instanceCount = n;
  }
  // A fill, flat or in 3D: a closed run of points is triangulated in its own plane (the best fit,
  // by Newell's normal), and the triangles keep the points where they are.
  function planar(pts) {
    if (!pts.some((p) => (p[2] ?? 0) !== (pts[0][2] ?? 0))) return pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const n = [0, 0, 0], c = [0, 0, 0];
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length], az = a[2] ?? 0, bz = b[2] ?? 0; n[0] += (a[1] - b[1]) * (az + bz); n[1] += (az - bz) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); c[0] += a[0]; c[1] += a[1]; c[2] += az; });
    const N = new THREE.Vector3(...n).normalize(), U = new THREE.Vector3(Math.abs(N.x) < 0.9 ? 1 : 0, Math.abs(N.x) < 0.9 ? 0 : 1, 0).cross(N).normalize(), V = new THREE.Vector3().crossVectors(N, U);
    return pts.map((p) => { const q = new THREE.Vector3(p[0], p[1], p[2] ?? 0); return new THREE.Vector2(q.dot(U), q.dot(V)); });
  }
  function writeFill(mesh, pts) {
    const contour = planar(pts), tris = THREE.ShapeUtils.triangulateShape(contour, []), n = tris.length * 3;
    let attr = mesh.geometry.attributes.position;
    if (!attr || attr.array.length < n * 3) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BufferGeometry();
      attr = new THREE.BufferAttribute(new Float32Array(pow2(Math.max(3, n)) * 3), 3);
      mesh.geometry.setAttribute('position', attr);
    }
    let o = 0;
    for (const t of tris) for (const k of t) { const p = pts[k]; attr.array[o++] = p[0]; attr.array[o++] = p[1]; attr.array[o++] = p[2] ?? 0; }
    attr.needsUpdate = true;
    mesh.geometry.setDrawRange(0, n);
  }
  // fill a group with these lines: [{ pts, color, width, opacity, fill }], reusing what it has
  function fillGroup(group, list, z = 0) {
    const pool = (group.userData.pool ??= { lines: [], fills: [] });
    let nl = 0, nf = 0;
    list.forEach((l, i) => {
      if (l.fill && l.pts.length > 2) {
        let f = pool.fills[nf];
        if (!f) { f = new THREE.Mesh(new THREE.BufferGeometry(), material(l.fill, 0, l.opacity ?? 1)); f.frustumCulled = false; pool.fills.push(f); group.add(f); }
        f.material = material(l.fill, 0, l.opacity ?? 1); writeFill(f, l.pts); f.renderOrder = i * 2; f.visible = true; nf++;
      }
      if ((l.width ?? 2.2) > 0 && l.pts.length) {
        let line = pool.lines[nl];
        if (!line) { line = new Line2(new LineGeometry(), material(l.color, l.width ?? 2.2, l.opacity ?? 1)); line.frustumCulled = false; pool.lines.push(line); group.add(line); }
        line.material = material(l.color, l.width ?? 2.2, l.opacity ?? 1); writeLine(line, l.pts, z); line.renderOrder = i * 2 + 1; line.visible = true; nl++;
      }
    });
    for (let i = nl; i < pool.lines.length; i++) pool.lines[i].visible = false;
    for (let i = nf; i < pool.fills.length; i++) pool.fills[i].visible = false;
    // a pool much bigger than what is drawn gives back its unused half
    if (pool.lines.length > 64 && nl < pool.lines.length / 4) { for (const x of pool.lines.splice(Math.max(nl, 16))) { group.remove(x); x.geometry.dispose(); } }
    if (pool.fills.length > 64 && nf < pool.fills.length / 4) { for (const x of pool.fills.splice(Math.max(nf, 16))) { group.remove(x); x.geometry.dispose(); } }
  }

  // ---- the canvas ----------------------------------------------------------
  const inkLines = new THREE.Group(), inkPreview = new THREE.Group();
  ink.add(inkLines, inkPreview);

  const unitsPerPx = () => VIEW_H / cam.zoom / size.h;
  function updateCamera() {
    const h = VIEW_H / cam.zoom, w = h * size.w / size.h;
    camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2;
    camera.position.set(cam.cx, cam.cy, 10);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  // Stage pixels (from its top left) to canvas coordinates and back.
  const toWorld = (px, py) => [cam.cx + (px - size.w / 2) * unitsPerPx(), cam.cy - (py - size.h / 2) * unitsPerPx()];
  const toScreen = (p) => [(p[0] - cam.cx) / unitsPerPx() + size.w / 2, size.h / 2 - (p[1] - cam.cy) / unitsPerPx()];

  function setLines(list) { fillGroup(inkLines, list); }

  // ---- render targets ------------------------------------------------------
  const scenes = new Map(); // id -> { scene, cam, lines, preview, px }
  function sceneFor(id) {
    let s = scenes.get(id);
    if (!s) {
      s = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(40, 1, 0.1, 200), lines: new THREE.Group(), preview: new THREE.Group(), px: null };
      const floor = new THREE.GridHelper(12, 12);
      floor.material = new THREE.LineBasicNodeMaterial();
      floor.material.colorNode = colors.line;
      floor.position.y = -3;
      s.scene.add(floor, s.lines, s.preview);
      scenes.set(id, s);
    }
    return s;
  }
  // list: [{ id, px: { l, t, w, h }, marks: [{ pts, color }], az, el, dist, center: [x, y, z] }]
  function setScenes(list, rebuild) {
    const live = new Set(list.map((d) => d.id));
    for (const [id, s] of scenes) if (!live.has(id)) { empty(s.lines); empty(s.preview); scenes.delete(id); }
    for (const d of list) {
      const fresh = !scenes.has(d.id), s = sceneFor(d.id);
      s.px = d.px;
      if (rebuild || fresh) fillGroup(s.lines, d.marks.map((m) => ({ pts: m.pts, color: m.color, width: m.width ?? 2.2, opacity: m.opacity, fill: m.fill })));
      const el = Math.max(-1.55, Math.min(1.55, d.el)), dist = d.dist ?? 13, c = d.center ?? [0, 0, 0];
      s.cam.position.set(c[0] + Math.sin(d.az) * Math.cos(el) * dist, c[1] + Math.sin(el) * dist, c[2] + Math.cos(d.az) * Math.cos(el) * dist);
      s.cam.lookAt(c[0], c[1], c[2]);
    }
  }

  // The drawing plane of a target: two unit axes through its centre.
  // 'view' faces the camera, so a stroke is drawn in 3D from wherever you look.
  const AXES = { front: [[1, 0, 0], [0, 1, 0]], top: [[1, 0, 0], [0, 0, -1]], side: [[0, 0, -1], [0, 1, 0]] };
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3(), tmp = new THREE.Vector3();
  function ready(s) { s.cam.clearViewOffset(); s.cam.aspect = s.px.w / s.px.h; s.cam.updateProjectionMatrix(); s.cam.updateMatrixWorld(); }
  function planeBasis(id, name = 'view') {
    const s = scenes.get(id);
    if (!s?.px) return null;
    if (AXES[name]) return { u: AXES[name][0], v: AXES[name][1] };
    ready(s);
    const m = s.cam.matrixWorld.elements;
    return { u: [m[0], m[1], m[2]], v: [m[4], m[5], m[6]] };
  }
  // Where a pointer lands on that plane, as [x, y, z] in the target's space.
  // `origin` is the point the plane passes through (the target's centre, its 3D cursor, a stroke).
  function sceneToLocal(id, px, py, name = 'view', origin = [0, 0, 0]) {
    const s = scenes.get(id), basis = planeBasis(id, name);
    if (!basis) return null;
    ready(s);
    const { u, v } = basis;
    tmp.set(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    plane.setFromNormalAndCoplanarPoint(tmp, hit.set(origin[0], origin[1], origin[2]));
    ndc.set(((px - s.px.l) / s.px.w) * 2 - 1, -((py - s.px.t) / s.px.h) * 2 + 1);
    raycaster.setFromCamera(ndc, s.cam);
    return raycaster.ray.intersectPlane(plane, hit) ? [hit.x, hit.y, hit.z] : null;
  }
  // A point of a target's space on the stage, or null behind the camera.
  function sceneToScreen(id, p) {
    const s = scenes.get(id);
    if (!s?.px) return null;
    ready(s);
    tmp.set(p[0], p[1], p[2] ?? 0).project(s.cam);
    return tmp.z > 1 ? null : [s.px.l + (tmp.x + 1) / 2 * s.px.w, s.px.t + (1 - tmp.y) / 2 * s.px.h];
  }

  // The stroke being drawn: on the canvas, or inside a target.
  function setPreview(pts, sceneId = null, color = 'accent') {
    // reused as the lines are, since it changes with every move of the pointer
    const target = pts && pts.length >= 2 ? (sceneId ? scenes.get(sceneId)?.preview : inkPreview) : null;
    for (const g of [inkPreview, ...[...scenes.values()].map((x) => x.preview)]) fillGroup(g, g === target ? [{ pts, color, width: 2.2 }] : []);
  }

  // ---- theme, size, loop ---------------------------------------------------
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    for (const name of Object.keys(colors)) colors[name].value.set(css.getPropertyValue('--' + name).trim());
    bg.set(css.getPropertyValue('--bg').trim());
    renderer.setClearColor(bg, 0); // the stage's own background (and grid) shows through
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  function resize() {
    const r = stage.getBoundingClientRect();
    size.w = Math.max(2, Math.floor(r.width)); size.h = Math.max(2, Math.floor(r.height));
    renderer.setSize(size.w, size.h, false);
    updateCamera();
  }
  new ResizeObserver(resize).observe(stage);
  readTheme(); resize();

  function draw() {
    updateCamera();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.w, size.h);
    renderer.clear();
    renderer.render(ink, camera);
    renderer.setScissorTest(true);
    for (const s of scenes.values()) {
      const p = s.px;
      // Only the part of the scene's rectangle that is on the stage.
      const l = Math.max(0, Math.round(p.l)), t = Math.max(0, Math.round(p.t));
      const r = Math.min(size.w, Math.round(p.l + p.w)), b = Math.min(size.h, Math.round(p.t + p.h));
      if (r - l < 4 || b - t < 4) continue;
      s.cam.aspect = p.w / p.h;
      s.cam.setViewOffset(p.w, p.h, l - p.l, t - p.t, r - l, b - t);
      renderer.setViewport(l, t, r - l, b - t); renderer.setScissor(l, t, r - l, b - t);
      renderer.clearDepth();
      renderer.render(s.scene, s.cam);
    }
  }
  renderer.setAnimationLoop(() => { onFrame?.(); draw(); });

  return {
    readTheme, cam, size, unitsPerPx, toWorld, toScreen, setLines, setScenes, setPreview, sceneToLocal, sceneToScreen, planeBasis,
    // Show a canvas rectangle { cx, cy, w, h } filling `fill` of the stage.
    frame(r, fill = 0.7) {
      cam.cx = r.cx; cam.cy = r.cy;
      cam.zoom = Math.min(200, Math.max(0.02, fill * Math.min(VIEW_H / r.h, VIEW_H * (size.w / size.h) / r.w)));
    },
    zoomAt(px, py, factor) {
      const before = toWorld(px, py);
      cam.zoom = Math.min(200, Math.max(0.02, cam.zoom * factor));
      const after = toWorld(px, py);
      cam.cx += before[0] - after[0]; cam.cy += before[1] - after[1];
    },
    // The ink as it is now, as a canvas to copy from (drawn afresh: a WebGPU canvas keeps its picture only for the frame).
    grab() { onFrame?.(); draw(); return canvas; }, // onFrame first: the faces (DOM) are placed there, and a hidden tab gets no frames of its own
    backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
  };
}
