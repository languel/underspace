// MIDI: notes out to instruments (Web MIDI) and recorded notes as a Standard
// MIDI File. After Artist Model Studio (src/score/midifile.js, outputs/webmidi.js).

const PPQ = 480;
const be = (n, len) => Array.from({ length: len }, (_, i) => (n >> (8 * (len - 1 - i))) & 0xff);
const vlq = (n) => { let v = Math.max(0, Math.round(n)); const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
const text = (type, s) => { const b = [...new TextEncoder().encode(s)]; return [0xff, type, ...vlq(b.length), ...b]; };

// notes: [{ beat, midi, vel, len (beats), ch? }] -> a format 0 file (Uint8Array).
export function midiFile(notes, { bpm = 120, meter = [4, 4], name = '' } = {}) {
  const ev = [];
  for (const n of notes) {
    const ch = ((n.ch ?? 1) - 1) & 15, key = Math.max(0, Math.min(127, Math.round(n.midi))), vel = Math.max(1, Math.min(127, Math.round(n.vel ?? 100)));
    ev.push({ tick: Math.round(n.beat * PPQ), off: 0, data: [0x90 | ch, key, vel] });
    ev.push({ tick: Math.round((n.beat + Math.max(1 / 64, n.len ?? 0.25)) * PPQ), off: 1, data: [0x80 | ch, key, 0] });
  }
  ev.sort((a, b) => a.tick - b.tick || b.off - a.off); // at one tick, a note ends before the next begins
  const track = [];
  if (name) track.push(0, ...text(0x03, name));
  track.push(0, 0xff, 0x51, 0x03, ...be(Math.round(60000000 / bpm), 3));
  track.push(0, 0xff, 0x58, 0x04, meter[0], Math.round(Math.log2(meter[1])), 24, 8);
  let last = 0;
  for (const e of ev) { track.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
  track.push(0, 0xff, 0x2f, 0x00);
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...be(6, 4), ...be(0, 2), ...be(1, 2), ...be(PPQ, 2), 0x4d, 0x54, 0x72, 0x6b, ...be(track.length, 4), ...track]);
}

// Read back the channel messages of a file made here: [{ tick, bytes }].
export function readMidiFile(bytes) {
  const out = [], LEN = { 0x80: 3, 0x90: 3, 0xa0: 3, 0xb0: 3, 0xc0: 2, 0xd0: 2, 0xe0: 3 };
  let p = 22, tick = 0, status = 0;
  const end = 22 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(18);
  const readVlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  while (p < end) {
    tick += readVlq();
    const b = bytes[p];
    if (b === 0xff) { const type = bytes[p + 1]; p += 2; const len = readVlq(); p += len; if (type === 0x2f) break; continue; }
    if (b & 0x80) { status = b; p++; }
    const len = LEN[status & 0xf0];
    out.push({ tick, bytes: [status, ...bytes.slice(p, p + len - 1)] });
    p += len - 1;
  }
  return out;
}

// Web MIDI out. connect() asks the browser (call it from a click); notes go to
// the chosen port, or every port ('all'), or none.
export function createMidiOut() {
  let access = null, selected = 'none';
  const list = () => (access ? [...access.outputs.values()] : []);
  const targets = () => (selected === 'all' ? list() : list().filter((p) => p.id === selected));
  return {
    get connected() { return !!access; },
    async connect() {
      if (!navigator.requestMIDIAccess) throw new Error('this browser has no Web MIDI');
      access ??= await navigator.requestMIDIAccess({ sysex: false });
      if (selected === 'none' && list().length) selected = list()[0].id;
      return this.ports();
    },
    ports: () => list().map((p) => ({ id: p.id, name: p.name || p.id })),
    get selected() { return selected; },
    select(id) { selected = id; },
    send(bytes, atMs) { for (const p of targets()) { try { p.send(bytes, atMs); } catch { /* a port that went away */ } } },
    // a note now: on, and off after `seconds`
    note(midi, vel = 100, seconds = 0.3, ch = 1) {
      if (!targets().length) return;
      const c = (ch - 1) & 15, k = Math.max(0, Math.min(127, Math.round(midi))), now = performance.now();
      this.send([0x90 | c, k, Math.max(1, Math.min(127, Math.round(vel)))], now);
      this.send([0x80 | c, k, 0], now + Math.max(0.02, seconds) * 1000);
    },
    panic() { for (const p of targets()) for (let c = 0; c < 16; c++) for (const n of [64, 120, 123]) { try { p.send([0xb0 | c, n, 0]); } catch { /* ignore */ } } },
  };
}
