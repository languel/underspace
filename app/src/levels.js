// Levels: at what size on screen an object is its glyph (far), its interface (mid: its name, its
// ports and the parameters published to it) or its inside (near: the interior, the code, what a
// group holds). Everywhere the same by default; an object may carry its own, as a brush carries
// its size: a patch that should stay shut until it nearly fills the view, a part whose inside
// should show early.
//
// o.levels: { far, near }, each in pixels of the object's longer side on screen, each optional.
//   far:  below this it is its glyph (0: never);
//   near: from this up it shows its inside (0: as soon as it is not its glyph; a huge number: never).

import { state, define, argTypes as T } from './space.js';

export const FAR = 48;                     // the default far, in pixels
export const NEAR = { w: 0.42, h: 0.5 };   // the default near, as parts of the view's width and height

// -> 'far' | 'mid' | 'near' for an object px: { w, h } on screen in a view of size { w, h }
export function faceOf(o, px, size) {
  const long = Math.max(px.w, px.h), lv = o.levels;
  if (long < (lv?.far ?? FAR)) return 'far';
  if (lv?.near != null) return long >= lv.near ? 'near' : 'mid';
  return px.w > size.w * NEAR.w || px.h > size.h * NEAR.h ? 'near' : 'mid';
}

// The levels an object has, with the defaults filled in for a view of this size. near is given
// for an object of this shape (the default near depends on which side meets the view first).
export function levelsOf(o, px, size) {
  const long = Math.max(px.w, px.h, 1e-9);
  return { far: o.levels?.far ?? FAR, near: o.levels?.near ?? Math.min(size.w * NEAR.w * (long / Math.max(px.w, 1e-9)), size.h * NEAR.h * (long / Math.max(px.h, 1e-9))) };
}

define({
  name: 'object.levels',
  doc: 'Set at what size on screen objects change face, each on its own. far: below this many pixels (its longer side) an object is its glyph; near: from this many pixels up it shows its inside (a group what it holds, a code object its code); between the two it is its interface: name, ports and published parameters. far 0: never a glyph. near 0: its inside as soon as it is not a glyph; near 100000: it stays shut at any zoom. Leave one out to keep it; null puts it back to the default (far 48; near about 0.42 of the view). view.get gives the pixels a canvas unit is now.',
  args: { ids: T.ids, far: { type: ['number', 'null'] }, near: { type: ['number', 'null'] } }, required: ['ids'],
  run(a) {
    let n = 0;
    for (const id of a.ids) {
      const o = state.objects.get(id);
      if (!o) continue;
      const lv = { ...(o.levels ?? {}) };
      for (const k of ['far', 'near']) if (k in a) { if (a[k] == null) delete lv[k]; else if (a[k] >= 0) lv[k] = Math.round(a[k] * 10) / 10; else throw new Error(`${k}: a size in pixels, 0 or more`); }
      if (lv.far != null && lv.near != null && lv.near < lv.far) lv.near = lv.far;
      if (Object.keys(lv).length) o.levels = lv; else delete o.levels;
      n++;
    }
    return n;
  },
  hold: (a) => a.ids ?? [],
});
