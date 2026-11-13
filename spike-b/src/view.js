// The renderer: one three.js canvas. The canvas view is an orthographic
// camera over the ink (marks and wires); each scene object gets its own small
// perspective view, drawn into its rectangle. Boxes and their text are DOM
// (faces.js), laid over this.

import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const VIEW_H = 10; // world units from top to bottom at zoom 1

export async function createView({ canvas, stage, onFrame }) {
  const forceWebGL = new URLSearchParams(location.search).has('gl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
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
  function material(color, width) {
    const key = color + width;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.Line2NodeMaterial();
      m.linewidth = width;
      m.colorNode = colors[color];
      materials.set(key, m);
    }
    return m;
  }
  function makeLine(pts, color, width, z = 0) {
    const pos = [];
    if (pts.length === 1) pos.push(pts[0][0] - 0.03, pts[0][1], pts[0][2] ?? z, pts[0][0] + 0.03, pts[0][1], pts[0][2] ?? z);
    else for (const p of pts) pos.push(p[0], p[1], p[2] ?? z);
    const geometry = new LineGeometry();
    geometry.setPositions(pos);
    const line = new Line2(geometry, material(color, width));
    line.frustumCulled = false;
    return line;
  }
  function empty(group) { for (const c of [...group.children]) { group.remove(c); c.geometry?.dispose(); } }

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

  function setLines(list) {
    empty(inkLines);
    for (const l of list) inkLines.add(makeLine(l.pts, l.color, l.width));
  }

  // ---- scene objects -------------------------------------------------------
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
  // list: [{ id, px: { l, t, w, h }, marks: [points], spin, tilt }]
  function setScenes(list, rebuild) {
    const live = new Set(list.map((d) => d.id));
    for (const [id, s] of scenes) if (!live.has(id)) { empty(s.lines); empty(s.preview); scenes.delete(id); }
    for (const d of list) {
      const fresh = !scenes.has(d.id), s = sceneFor(d.id);
      s.px = d.px;
      if (rebuild || fresh) { empty(s.lines); for (const pts of d.marks) s.lines.add(makeLine(pts, 'ink', 2.2)); }
      const az = 0.5 + d.spin * Math.PI, el = Math.max(-1.4, Math.min(1.4, 0.3 + d.tilt)), dist = 13;
      s.cam.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
      s.cam.lookAt(0, 0, 0);
    }
  }

  // Where a pointer lands in a scene's space: on the plane through its centre
  // that faces the camera, so a stroke is drawn in 3D from wherever you look.
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3(), facing = new THREE.Vector3();
  function sceneToLocal(id, px, py) {
    const s = scenes.get(id);
    if (!s?.px) return null;
    s.cam.clearViewOffset(); s.cam.aspect = s.px.w / s.px.h; s.cam.updateProjectionMatrix(); s.cam.updateMatrixWorld();
    ndc.set(((px - s.px.l) / s.px.w) * 2 - 1, -((py - s.px.t) / s.px.h) * 2 + 1);
    raycaster.setFromCamera(ndc, s.cam);
    plane.setFromNormalAndCoplanarPoint(s.cam.getWorldDirection(facing), hit.set(0, 0, 0));
    return raycaster.ray.intersectPlane(plane, hit) ? [hit.x, hit.y, hit.z] : null;
  }

  // The stroke being drawn: on the canvas, or inside a scene.
  function setPreview(pts, sceneId = null) {
    empty(inkPreview);
    for (const s of scenes.values()) empty(s.preview);
    if (!pts || pts.length < 2) return;
    (sceneId ? scenes.get(sceneId)?.preview : inkPreview)?.add(makeLine(pts, 'accent', 2.2));
  }

  // ---- theme, size, loop ---------------------------------------------------
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    for (const name of Object.keys(colors)) colors[name].value.set(css.getPropertyValue('--' + name).trim());
    bg.set(css.getPropertyValue('--bg').trim());
    renderer.setClearColor(bg, 1);
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

  renderer.setAnimationLoop(() => {
    onFrame?.();
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
  });

  return {
    cam, size, unitsPerPx, toWorld, toScreen, setLines, setScenes, setPreview, sceneToLocal,
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
    backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
  };
}
