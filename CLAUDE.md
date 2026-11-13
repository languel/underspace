# underspace

Read `HANDOFF.md` first: it holds the design, the state of this folder and the next steps.

- `app/` is the product. The root page (`index.html`, `src/`) is **spike A** and `spike-b/` is **spike B**: throwaways, do not grow them.
- Static site, no build: `python3 -m http.server 5310`. Tests: `npm test`.
- three.js r187 (WebGPU renderer, TSL) is vendored in `vendor/three/` and p5.js 2.4.0 in `vendor/p5/`; do not swap them for a CDN. Keep both on the latest release.
- Every state change must go through `call()` in `app/src/space.js` so it is recorded in the take. Every user-facing action goes in the `ACTIONS` table in `app/src/main.js` so it has a key, a menu entry and a palette entry.
- UI is glyphs with hover tips. No explanatory text on screen.
- Object code is plain JS. Do not invent syntax.
- A new capability is one file. Nothing becomes shared kernel code until two things need it.
