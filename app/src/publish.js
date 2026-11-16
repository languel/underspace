// Published parameters: the half of an object's blanket that is not ports. A parameter an object
// publishes shows on the face of the group it is in, and is set from there; the group may publish
// it again, to the group it is in, and so on up. So a filter's cutoff can be on the voice, the
// voice's on the instrument: each level's face is that level's interface, and nothing else of the
// inside shows.
//
// o.publish: the keys of the parameters o shows one level up. A key is a parameter's name; for a
// group, which has only what is published to it (publishedOf), it is "<the object it comes
// from>.<its key there>", so it still means the same parameter when others come and go. Setting a published parameter is object.set on
// the object that owns it, however deep: there is one value, shown at several scales.

import { state, define, argTypes as T } from './space.js';
import { blanketOf } from './object.js';

const label = (o) => o.name || blanketOf(o)?.name || o.id;

// What an object can publish: its own parameters, or for a group what is published to it.
// -> [{ key, name, value, id, param }] (id, param: the object and the parameter that hold the value)
export function paramsOf(objects, o, seen = new Set()) {
  if (!o || seen.has(o.id)) return [];
  if (o.kind === 'group') return publishedOf(objects, o.id, seen);
  return (blanketOf(o)?.params ?? []).map((p) => ({ key: p.name, name: p.name, value: o.params?.[p.name] ?? p.value, id: o.id, param: p.name }));
}

// The parameters published to group gid by what is in it. Two of the same name are told apart
// by their object's name (cutoff, then "filter 2.cutoff").
export function publishedOf(objects, gid, seen = new Set()) {
  seen.add(gid);
  const out = [], names = new Set();
  for (const x of objects.values()) {
    if (x.space !== gid || !x.publish?.length) continue;
    const own = paramsOf(objects, x, seen);
    for (const n of x.publish) {
      const p = own.find((q) => q.key === n);
      if (!p) continue;
      let name = p.name;
      if (names.has(name)) name = `${label(x)}.${p.name}`;
      if (names.has(name)) name = `${x.id}.${p.name}`;
      names.add(name);
      out.push({ key: `${x.id}.${p.key}`, name, value: p.value, id: p.id, param: p.param });
    }
  }
  return out;
}

define({
  name: 'object.publish',
  doc: 'Show a parameter of an object on the face of the group it is in (its interface one level up), or take it off. id: the object; name: the parameter (all of them when left out); on: false takes it off. A group publishes, by the same command, what is published to it, to the group it is in turn in: so a parameter deep inside can be set from any level. Setting it anywhere is object.set on the object that owns it. Returns what the object now publishes, and what it could.',
  args: { id: T.id, name: T.str, on: { type: 'boolean' } }, required: ['id'],
  run(a) {
    const o = state.objects.get(a.id);
    if (!o) return false;
    const can = paramsOf(state.objects, o), names = can.map((p) => p.name);
    const one = a.name != null ? can.find((p) => p.name === a.name || p.key === a.name) : null;
    if (a.name != null && !one) throw new Error(`${a.id} has no parameter "${a.name}" to publish` + (names.length ? ` (it has: ${names.join(', ')})` : o.kind === 'group' ? ' (nothing inside it is published yet: publish from the inside first)' : ' (it has no parameters)'));
    const set = new Set((o.publish ?? []).filter((k) => can.some((p) => p.key === k)));
    for (const p of one ? [one] : can) { if (a.on === false) set.delete(p.key); else set.add(p.key); }
    if (set.size) o.publish = can.filter((p) => set.has(p.key)).map((p) => p.key); else delete o.publish;
    return { publish: can.filter((p) => set.has(p.key)).map((p) => p.name), can: names };
  },
  hold: (a) => [a.id],
});
