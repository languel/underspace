// Sketch containers: a code container whose code is a whole standalone
// sketch (p5.js or three.js) rather than a function body. It runs in its own
// frame, shown as the object's face. The header comments still declare ports:
// inside the sketch, `inp` and `p` hold the current inputs and parameters,
// and out({ y: 1 }) sets outputs.

// 'p5', 'three', or null for an ordinary function body.
export function sketchKind(code) {
  if (/^\s*import\s[^\n]*['"]three(\/[^'"]*)?['"]/m.test(code) || /\bnew\s+THREE\./.test(code)) return 'three';
  if (/\bfunction\s+(setup|draw)\s*\(/.test(code) || /\bcreateCanvas\s*\(/.test(code)) return 'p5';
  return null;
}

const BRIDGE = `
window.inp = {}; window.p = {};
window.out = (o) => parent.postMessage({ underspace: ID, out: o }, '*');
addEventListener('message', (e) => { if (e.data && e.data.inp) { Object.assign(window.inp, e.data.inp); Object.assign(window.p, e.data.p); } });
addEventListener('error', (e) => parent.postMessage({ underspace: ID, error: e.message }, '*'));
`;
const STYLE = '<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block}</style>';

// The document a sketch runs in. `vendor` is the absolute URL of vendor/three/;
// p5.js (2.4.0) is beside it in vendor/p5/.
export function sketchDoc(code, kind, id, vendor) {
  const bridge = `<script>const ID = ${JSON.stringify(id)};${BRIDGE}</script>`;
  const safe = code.replace(/<\/script/gi, '<\\/script');
  if (kind === 'p5') return `<!doctype html>${STYLE}${bridge}<script src="${new URL('../p5/p5.min.js', vendor).href}"></script><script>${safe}</script>`;
  const map = { imports: { three: vendor + 'build/three.webgpu.js', 'three/webgpu': vendor + 'build/three.webgpu.js', 'three/tsl': vendor + 'build/three.tsl.js', 'three/addons/': vendor + 'addons/' } };
  // A sketch written against the global THREE gets it; one with imports brings its own.
  const body = /^\s*import\s/m.test(code) ? safe : `import * as THREE from 'three';\n${safe}`;
  return `<!doctype html>${STYLE}${bridge}<script type="importmap">${JSON.stringify(map)}</script><script type="module">${body}</script>`;
}
