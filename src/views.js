// One three.js scene, two views of it. The canvas view is an orthographic
// camera looking straight at the drawing plane; the scene view is a
// perspective camera. Both show the same marks; the scene view can also
// project the time each point was drawn onto the depth axis.

import * as THREE from 'three';
import { uniform, mix } from 'three/tsl';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// u: right, v: up, n: towards the viewer, for a camera facing each plane.
export const PLANES = {
  front: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  top: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  side: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
};
const L_CANVAS = 1, L_SCENE = 2;
const TIME_DEPTH = 0.35; // world units per second in the "making" projection
const AXIS = { x: 0, y: 1, z: 2 };

export async function createViews({ canvas, paneCanvas, paneScene, onFrame }) {
  // WebGPU when the browser has it, WebGL 2 otherwise. Add ?gl to the address to force WebGL.
  const forceWebGL = new URLSearchParams(location.search).has('gl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  await renderer.init();
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const canvasCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  canvasCam.layers.enable(L_CANVAS);
  const sceneCam = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  sceneCam.position.set(4.5, 3.2, 7.5);
  sceneCam.layers.enable(L_SCENE);

  const controls = new OrbitControls(sceneCam, paneScene);
  controls.enableDamping = true;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  const altOrbit = (on) => { controls.mouseButtons.LEFT = on ? THREE.MOUSE.ROTATE : null; };
  window.addEventListener('keydown', (e) => { if (e.key === 'Alt') altOrbit(true); });
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') altOrbit(false); });
  window.addEventListener('blur', () => altOrbit(false));

  // ---- shared colours (TSL uniforms, so a theme change costs nothing) ------
  const uInk = uniform(new THREE.Color());
  const uAccent = uniform(new THREE.Color());
  const uHotColor = uniform(new THREE.Color());
  const colors = { bg: new THREE.Color(), grid: new THREE.Color(), gridStrong: new THREE.Color() };

  function makeMaterial(width = 2.4) {
    const uSel = uniform(0), uHot = uniform(0);
    const material = new THREE.Line2NodeMaterial();
    material.linewidth = width;
    material.colorNode = mix(mix(uInk, uAccent, uSel), uHotColor, uHot);
    return { material, uSel, uHot };
  }

  // ---- state ---------------------------------------------------------------
  let plane = 'front', depth = 0, projection = 'space';
  const view2 = { cx: 0, cy: 0, zoom: 1 };
  const size = { w: 2, h: 2, wl: 1 };
  const lines = new Map(); // id -> { mark, a, b, material, uSel, uHot, total }
  let t0 = 0;
  let grid = null;
  const axes = new THREE.AxesHelper(0.5);
  scene.add(axes);

  const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const planeCenter = () => {
    const P = PLANES[plane];
    return vec(P.u).multiplyScalar(view2.cx).addScaledVector(vec(P.v), view2.cy).addScaledVector(vec(P.n), depth);
  };

  function updateCanvasCam() {
    const P = PLANES[plane];
    const h = 7 / view2.zoom, w = h * (size.wl / size.h);
    canvasCam.left = -w / 2; canvasCam.right = w / 2; canvasCam.top = h / 2; canvasCam.bottom = -h / 2;
    const c = planeCenter();
    canvasCam.up.copy(vec(P.v));
    canvasCam.position.copy(c).addScaledVector(vec(P.n), 10);
    canvasCam.lookAt(c);
    canvasCam.updateProjectionMatrix();
    canvasCam.updateMatrixWorld();
  }

  function rebuildGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(20, 20, colors.gridStrong, colors.grid);
    if (plane === 'front') grid.rotation.x = Math.PI / 2;
    if (plane === 'side') grid.rotation.z = Math.PI / 2;
    grid.position.copy(vec(PLANES[plane].n).multiplyScalar(depth));
    scene.add(grid);
  }

  // ---- projections ---------------------------------------------------------
  // Where a point is shown in each view. This is the whole idea of the spike:
  // a view is a function from a point's channels to a position.
  function shown(pt, view) {
    if (view === 'scene' && projection === 'making') return [pt[0], pt[1], (pt[3] - t0) * TIME_DEPTH];
    return [pt[0], pt[1], pt[2]];
  }

  function positionsFor(mark, view) {
    const pts = mark.points;
    if (pts.length === 1) { // a single point is shown as a short dash
      const [x, y, z] = shown(pts[0], view), u = PLANES[mark.plane]?.u ?? [1, 0, 0], e = 0.035;
      return [x - u[0] * e, y - u[1] * e, z - u[2] * e, x + u[0] * e, y + u[1] * e, z + u[2] * e];
    }
    const out = new Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) { const s = shown(pts[i], view); out[i * 3] = s[0]; out[i * 3 + 1] = s[1]; out[i * 3 + 2] = s[2]; }
    return out;
  }

  function makeLine(positions, material, layer) {
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.layers.set(layer);
    scene.add(line);
    return line;
  }
  function dropLine(line) { scene.remove(line); line.geometry.dispose(); }

  function addMark(mark) {
    const { material, uSel, uHot } = makeMaterial(mark.points.length === 1 ? 6 : 2.4);
    const a = makeLine(positionsFor(mark, 'canvas'), material, L_CANVAS);
    const b = makeLine(positionsFor(mark, 'scene'), material, L_SCENE);
    lines.set(mark.id, { mark, a, b, material, uSel, uHot, total: Math.max(1, mark.points.length - 1) });
  }
  function removeMark(id) {
    const l = lines.get(id); if (!l) return;
    dropLine(l.a); dropLine(l.b); l.material.dispose(); lines.delete(id);
  }
  function refreshSceneLines() {
    for (const l of lines.values()) l.b.geometry.setPositions(positionsFor(l.mark, 'scene'));
  }

  function sync(marks) {
    for (const id of [...lines.keys()]) if (!marks.has(id)) removeMark(id);
    let min = Infinity;
    for (const m of marks.values()) min = Math.min(min, m.points[0][3]);
    const newT0 = min === Infinity ? 0 : min;
    const shifted = newT0 !== t0;
    t0 = newT0;
    for (const m of marks.values()) if (!lines.has(m.id)) addMark(m);
    if (shifted && projection === 'making') refreshSceneLines();
  }

  function setSelection(ids) {
    for (const [id, l] of lines) l.uSel.value = ids.has(id) ? 1 : 0;
  }
  function setHot(id, v) { const l = lines.get(id); if (l) l.uHot.value = v; }

  // ---- stroke preview ------------------------------------------------------
  const preview = makeMaterial(2.4);
  preview.uSel.value = 1;
  let previewLine = null;
  function setPreview(points, markPlane) {
    if (previewLine) { dropLine(previewLine); previewLine = null; }
    if (!points || points.length < 2) return;
    const m = { points, plane: markPlane };
    previewLine = makeLine(positionsFor(m, 'canvas'), preview.material, L_CANVAS);
    previewLine.layers.enable(L_SCENE);
  }

  // ---- frame and playhead --------------------------------------------------
  const helperMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
  const headMat = new THREE.LineBasicMaterial();
  const frames = { canvas: null, scene: null }, heads = { canvas: null, scene: null };
  const boxes = { canvas: new THREE.Box3(), scene: new THREE.Box3() };

  function setFrame(marks) {
    for (const view of ['canvas', 'scene']) {
      if (frames[view]) { scene.remove(frames[view]); frames[view].geometry.dispose(); frames[view] = null; }
      const box = boxes[view].makeEmpty();
      for (const m of marks) for (const pt of m.points) box.expandByPoint(vec(shown(pt, view)));
      if (box.isEmpty() || marks.length < 1) continue;
      box.expandByScalar(0.08);
      const helper = new THREE.Box3Helper(box.clone(), 0xffffff);
      helper.material = helperMat;
      helper.layers.set(view === 'canvas' ? L_CANVAS : L_SCENE);
      scene.add(helper);
      frames[view] = helper;
    }
  }

  // info: { channel: 'x' | 'z' | 't', value } or null
  function setPlayhead(info) {
    for (const view of ['canvas', 'scene']) {
      let axis = -1, at = 0;
      if (info && !boxes[view].isEmpty()) {
        const making = view === 'scene' && projection === 'making';
        if (info.channel === 't') { if (making) { axis = 2; at = (info.value - t0) * TIME_DEPTH; } }
        else if (!(making && info.channel === 'z')) { axis = AXIS[info.channel]; at = info.value; }
      }
      if (axis < 0) { if (heads[view]) heads[view].visible = false; continue; }
      if (!heads[view]) {
        const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
        heads[view] = new THREE.Line(g, headMat);
        heads[view].frustumCulled = false;
        heads[view].layers.set(view === 'canvas' ? L_CANVAS : L_SCENE);
        scene.add(heads[view]);
      }
      const b = boxes[view], [o1, o2] = [0, 1, 2].filter((k) => k !== axis);
      const lo = b.min.toArray(), hi = b.max.toArray();
      const corner = (c1, c2) => { const p = [0, 0, 0]; p[axis] = at; p[o1] = c1 ? hi[o1] : lo[o1]; p[o2] = c2 ? hi[o2] : lo[o2]; return p; };
      const arr = heads[view].geometry.attributes.position.array;
      [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1), corner(0, 0)].forEach((p, i) => arr.set(p, i * 3));
      heads[view].geometry.attributes.position.needsUpdate = true;
      heads[view].visible = true;
    }
  }

  // ---- progressive reveal (used when replaying a take) ---------------------
  function reveal(id, seconds) {
    const l = lines.get(id);
    if (!l || l.total < 2) return Promise.resolve();
    return new Promise((resolve) => {
      const start = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / (seconds * 1000));
        const n = Math.max(1, Math.round(k * l.total));
        l.a.geometry.instanceCount = n; l.b.geometry.instanceCount = n;
        if (k < 1 && lines.get(id) === l) requestAnimationFrame(step); else resolve();
      };
      step();
    });
  }

  // ---- pointer geometry ----------------------------------------------------
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitPlane = new THREE.Plane(), tmp = new THREE.Vector3();
  const cam = (view) => (view === 'canvas' ? canvasCam : sceneCam);
  const pane = (view) => (view === 'canvas' ? paneCanvas : paneScene);

  // Where a pointer lands on the drawing plane, as [x, y, z], or null.
  function toWorld(view, clientX, clientY) {
    const r = pane(view).getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam(view));
    const n = vec(PLANES[plane].n);
    hitPlane.setFromNormalAndCoplanarPoint(n, n.clone().multiplyScalar(depth));
    const hit = raycaster.ray.intersectPlane(hitPlane, tmp);
    return hit ? [hit.x, hit.y, hit.z] : null;
  }

  function toScreen(view, p, r) {
    tmp.set(p[0], p[1], p[2]).project(cam(view));
    return [(tmp.x + 1) / 2 * r.width + r.left, (1 - tmp.y) / 2 * r.height + r.top, tmp.z];
  }
  function screenPath(view, mark, r) {
    const pos = positionsFor(mark, view), out = [];
    for (let i = 0; i < pos.length; i += 3) out.push(toScreen(view, [pos[i], pos[i + 1], pos[i + 2]], r));
    return out;
  }
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
    const k = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
    return Math.hypot(px - (a[0] + k * dx), py - (a[1] + k * dy));
  }

  function pick(view, clientX, clientY, tolerance = 9) {
    const r = pane(view).getBoundingClientRect();
    let best = null, bestD = tolerance;
    for (const [id, l] of lines) {
      const path = screenPath(view, l.mark, r);
      for (let i = 0; i < path.length - 1; i++) {
        if (path[i][2] > 1 || path[i + 1][2] > 1) continue; // behind the camera
        const d = segDist(clientX, clientY, path[i], path[i + 1]);
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  }
  function pickRect(view, x0, y0, x1, y1) {
    const r = pane(view).getBoundingClientRect();
    const [l, rr, t, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    const ids = [];
    for (const [id, ln] of lines) {
      if (screenPath(view, ln.mark, r).some((p) => p[2] <= 1 && p[0] >= l && p[0] <= rr && p[1] >= t && p[1] <= b)) ids.push(id);
    }
    return ids;
  }

  // ---- canvas navigation: wheel pans, pinch or ctrl+wheel zooms, middle-drag pans
  const unitsPerPixel = () => (7 / view2.zoom) / size.h;
  paneCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = paneCanvas.getBoundingClientRect();
      const ox = (e.clientX - r.left - r.width / 2) * unitsPerPixel(), oy = -(e.clientY - r.top - r.height / 2) * unitsPerPixel();
      const next = Math.min(40, Math.max(0.05, view2.zoom * Math.exp(-e.deltaY * 0.01)));
      const k = 1 - view2.zoom / next;
      view2.cx += ox * k; view2.cy += oy * k; view2.zoom = next;
    } else {
      view2.cx += e.deltaX * unitsPerPixel(); view2.cy -= e.deltaY * unitsPerPixel();
    }
    updateCanvasCam();
  }, { passive: false });
  let pan = null;
  paneCanvas.addEventListener('pointerdown', (e) => { if (e.button === 1) { pan = [e.clientX, e.clientY]; paneCanvas.setPointerCapture(e.pointerId); e.preventDefault(); } });
  paneCanvas.addEventListener('pointermove', (e) => {
    if (!pan) return;
    view2.cx -= (e.clientX - pan[0]) * unitsPerPixel(); view2.cy += (e.clientY - pan[1]) * unitsPerPixel();
    pan = [e.clientX, e.clientY]; updateCanvasCam();
  });
  paneCanvas.addEventListener('pointerup', (e) => { if (e.button === 1) pan = null; });

  // ---- theme, size, loop ---------------------------------------------------
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    const get = (name) => css.getPropertyValue(name).trim();
    colors.bg.set(get('--bg')); colors.grid.set(get('--line')); colors.gridStrong.set(get('--muted'));
    uInk.value.set(get('--ink')); uAccent.value.set(get('--accent'));
    uHotColor.value.set(get('--hot'));
    helperMat.color.set(get('--muted')); headMat.color.set(get('--accent'));
    renderer.setClearColor(colors.bg, 1);
    rebuildGrid();
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    size.w = Math.max(2, Math.floor(r.width)); size.h = Math.max(2, Math.floor(r.height)); size.wl = Math.floor(size.w / 2);
    renderer.setSize(size.w, size.h, false);
    sceneCam.aspect = (size.w - size.wl) / size.h; sceneCam.updateProjectionMatrix();
    updateCanvasCam();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);

  readTheme(); resize();

  renderer.setAnimationLoop(() => {
    onFrame?.();
    controls.update();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.w, size.h);
    renderer.clear();
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, size.wl, size.h); renderer.setScissor(0, 0, size.wl, size.h);
    renderer.render(scene, canvasCam);
    renderer.setViewport(size.wl, 0, size.w - size.wl, size.h); renderer.setScissor(size.wl, 0, size.w - size.wl, size.h);
    renderer.render(scene, sceneCam);
  });

  return {
    sync, setSelection, setHot, setPreview, setFrame, setPlayhead, reveal, toWorld, pick, pickRect,
    setPlane(name, d) { plane = name; depth = d; view2.cx = 0; view2.cy = 0; rebuildGrid(); updateCanvasCam(); },
    setProjection(name) { projection = name; refreshSceneLines(); },
    get projection() { return projection; },
    backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
  };
}
