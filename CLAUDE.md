# underspace

Read `HANDOFF.md` first: it holds the design, the state of this folder and the next steps.

- This folder is **spike A**, a throwaway. Do not grow it into the product.
- Static site, no build: `python3 -m http.server 5310`. Tests: `npm test`.
- three.js r187 (WebGPU renderer, TSL) is vendored in `vendor/three/`; do not swap it for a CDN.
- Every state change must go through `call()` in `src/space.js` so it is recorded in the take.
- A new capability is one file. Nothing becomes shared kernel code until two things need it.
