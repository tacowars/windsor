// Writes the scenario songs for windsor#222 into ./songs: one FM part and no
// inserts, the same part with one insert kind on the master (one song per
// kind), and a dense song of eight parts with two or three inserts each.
// Patches are copied from the shipped library, so each song is self-contained.
// Run: node docs/research/2026-09-30-worklet-gc-in-chrome/generate-songs.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const patchDir = join(here, '../../../packages/engine/src/patches');
const outDir = join(here, 'songs');

const BARS = 32;
const TICKS_PER_BAR = 96;
const SONG_TICKS = BARS * TICKS_PER_BAR;
const BARS_PER_CHORD = 4;
const DEGREES = [0, 5, 3, 4];
// One chord hit per base step, held to the next (gate 1).
const HIT = { kind: 'hit', duration: 1, repeat: 1 };

/** Every insert kind the issue names, by its song `kind`. */
const KINDS = [
  'advanced-drive',
  'compressor',
  'delay',
  'phaser',
  'retro-reverb',
  'plate',
  'tape',
  'eq',
];

const patch = (id) => JSON.parse(readFileSync(join(patchDir, `${id}.json`), 'utf8')).patch;

function harmony() {
  const span = BARS_PER_CHORD * TICKS_PER_BAR;
  const events = [];
  for (let start = 0; start < SONG_TICKS; start += span) {
    events.push({ start, duration: span, degree: DEGREES[events.length % 4], size: 3 });
  }
  return { root: 0, scale: 'naturalMinor', events };
}

function part(slot, preset, { octave, divisor, inserts = [] }) {
  return {
    slot,
    name: `Part ${slot + 1}`,
    preset,
    velocity: 0.8,
    strip: { level: 0.5, pan: 0, lowCut: 20, sends: {}, inserts },
    regions: [{ start: 0, duration: SONG_TICKS }],
    sequencer: { kind: 'chord', divisor, gate: 1, voicing: 'close', register: { octave }, steps: [HIT] },
  };
}

function song(parts, patchIds, masterInserts) {
  return {
    version: 4,
    transport: { bpm: 120, bars: BARS },
    harmony: harmony(),
    parts,
    patches: Object.fromEntries(patchIds.map((id) => [id, patch(id)])),
    master: { level: 1, inserts: masterInserts },
  };
}

function write(name, document) {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(document, null, 2)}\n`);
}

mkdirSync(outDir, { recursive: true });

// (a) and (b): the Node probe's part, a held chord of pad-drift, one chord a bar.
const fmPart = () => part(0, 'pad-drift', { octave: 3, divisor: TICKS_PER_BAR });
write('a-fm', song([fmPart()], ['pad-drift'], []));
for (const kind of KINDS) write(`b-${kind}`, song([fmPart()], ['pad-drift'], [{ kind }]));

// (c): eight parts, each with two or three of the seven registered kinds.
const DENSE = [
  ['pad-drift', 3, 96],
  ['bass-digital', 2, 24],
  ['lead-bell', 4, 48],
  ['saw-arp', 4, 24],
  ['drone-sqr', 2, 96],
  ['ai-voice', 3, 48],
  ['horde-horn', 3, 96],
  ['lead-width-sweep', 4, 48],
];
const REGISTERED = KINDS.filter((kind) => kind !== 'eq');
const denseParts = DENSE.map(([id, octave, divisor], slot) => {
  const count = slot % 2 === 0 ? 3 : 2;
  const inserts = [];
  for (let i = 0; i < count; i += 1) {
    inserts.push({ kind: REGISTERED[(slot * 2 + i) % REGISTERED.length] });
  }
  return part(slot, id, { octave, divisor, inserts });
});
write(
  'c-dense',
  song(
    denseParts,
    DENSE.map(([id]) => id),
    [],
  ),
);
