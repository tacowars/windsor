// Writes the reference songs for windsor#343: 16 copies of the shipped
// `pad-drift` part, each a held three-note chord struck once a bar, with the
// harmony moving every four bars, at 124 bpm for 16 bars. No inserts and no
// sends, so the 16 FM processors are the load. The patch is copied from the
// shipped library, so each song is self-contained.
//   ./sixteen-pads.json        the patch as shipped (spread 12: two detuned
//                              voices a note, 96 held voices in all)
//   ./sixteen-pads-light.json  the same with spread 0 (one voice a note, 48),
//                              light enough to play in real time here
// Run: node docs/research/2026-10-01-automation-param-cost/generate-song.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const patchFile = join(here, '../../../packages/engine/src/patches/pad-drift.json');

const PARTS = 16;
const BPM = 124;
const BARS = 16;
const TICKS_PER_BAR = 96;
const SONG_TICKS = BARS * TICKS_PER_BAR;
const BARS_PER_CHORD = 4;
const DEGREES = [0, 5, 3, 4];
const OCTAVES = [2, 3, 4];
// One chord hit per bar, held to the next (gate 1).
const HIT = { kind: 'hit', duration: 1, repeat: 1 };

function harmony() {
  const span = BARS_PER_CHORD * TICKS_PER_BAR;
  const events = [];
  for (let start = 0; start < SONG_TICKS; start += span) {
    events.push({ start, duration: span, degree: DEGREES[events.length % 4], size: 3 });
  }
  return { root: 0, scale: 'naturalMinor', events };
}

function part(slot) {
  return {
    slot,
    name: `Pad ${slot + 1}`,
    preset: 'pad-drift',
    velocity: 0.8,
    strip: { level: 0.25, pan: (slot / (PARTS - 1)) * 2 - 1, lowCut: 20, sends: {}, inserts: [] },
    regions: [{ start: 0, duration: SONG_TICKS }],
    sequencer: {
      kind: 'chord',
      divisor: TICKS_PER_BAR,
      gate: 1,
      voicing: 'close',
      register: { octave: OCTAVES[slot % OCTAVES.length] },
      steps: [HIT],
    },
  };
}

const song = (patch) => ({
  version: 6,
  transport: { bpm: BPM, bars: BARS },
  harmony: harmony(),
  parts: Array.from({ length: PARTS }, (_, slot) => part(slot)),
  patches: { 'pad-drift': patch },
  master: { level: 1, inserts: [] },
});

const shipped = JSON.parse(readFileSync(patchFile, 'utf8')).patch;
const write = (name, document) =>
  writeFileSync(join(here, name), `${JSON.stringify(document, null, 2)}\n`);
write('sixteen-pads.json', song(shipped));
write('sixteen-pads-light.json', song({ ...shipped, spread: 0 }));
