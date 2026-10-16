/* global structuredClone */
/** The cold-start cases (windsor#837). `bench` is the issue's own song,
 * `song('8-3ins', { parts: 8, inserts: 3, sends: true })` from the performance assessment
 * (eight Chord Player pads, three inserts a strip rotating through every kind, both sends,
 * no master inserts). `drums` is the same desk with a drum kit in place of
 * the pads: eight drum voices on fixed Euclidean lines at sixteenths, 120 BPM, each strip
 * carrying the same three inserts the bench song's strip in that slot carries, so the two
 * differ only in what the parts play.
 */
import { song, KINDS } from '../2026-10-13-performance-assessment/songs.mjs';
import kick from '../../../packages/engine/src/patches/tr909-kick.json' with { type: 'json' };
import snare from '../../../packages/engine/src/patches/tr909-snare.json' with { type: 'json' };
import clap from '../../../packages/engine/src/patches/tr909-clap.json' with { type: 'json' };
import hatClosed from '../../../packages/engine/src/patches/tr909-hat-closed.json' with { type: 'json' };
import hatOpen from '../../../packages/engine/src/patches/tr909-hat-open.json' with { type: 'json' };
import rim from '../../../packages/engine/src/patches/tr909-rimshot.json' with { type: 'json' };
import ride from '../../../packages/engine/src/patches/tr909-ride.json' with { type: 'json' };
import tom from '../../../packages/engine/src/patches/tr808-tom-mid.json' with { type: 'json' };

const BARS = 8;
const TICKS_PER_BAR = 96;
const SIXTEENTH = 6;
const INSERTS = 3;

/** Each drum: its patch file, the id the song names it by, its note, pulses of 16 and rotation. */
const KIT = [
  { id: 'tr909-kick', file: kick, note: 36, pulses: 4, rotate: 0 },
  { id: 'tr909-snare', file: snare, note: 38, pulses: 2, rotate: 4 },
  { id: 'tr909-clap', file: clap, note: 39, pulses: 3, rotate: 4 },
  { id: 'tr909-hat-closed', file: hatClosed, note: 42, pulses: 12, rotate: 0 },
  { id: 'tr909-hat-open', file: hatOpen, note: 46, pulses: 4, rotate: 2 },
  { id: 'tr909-rimshot', file: rim, note: 37, pulses: 5, rotate: 1 },
  { id: 'tr909-ride', file: ride, note: 51, pulses: 8, rotate: 1 },
  { id: 'tr808-tom-mid', file: tom, note: 45, pulses: 3, rotate: 3 },
];

function drumPart(slot, drum) {
  const inserts = [];
  for (let i = 0; i < INSERTS; i++) inserts.push({ kind: KINDS[(slot * INSERTS + i) % KINDS.length] });
  return {
    slot,
    name: drum.id,
    preset: drum.id,
    velocity: 0.9,
    strip: { level: 0.5, pan: ((slot % 5) - 2) / 4, lowCut: 20, sends: { a: 0.3, b: 0.2 }, inserts },
    regions: [{ start: 0, duration: BARS * TICKS_PER_BAR }],
    sequencer: {
      kind: 'euclidean',
      seed: 0,
      note: drum.note,
      hold: 0.1,
      steps: 16,
      divisor: SIXTEENTH,
      pulses: { min: drum.pulses, max: drum.pulses, start: drum.pulses },
      rotate: drum.rotate,
      density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
      pattern: null,
    },
  };
}

function drums() {
  const bench = song('8-3ins', { parts: 8, inserts: INSERTS, sends: true });
  const patches = {};
  for (const drum of KIT) patches[drum.id] = structuredClone(drum.file.patch);
  return {
    name: 'drums-3ins',
    document: {
      ...bench.document,
      parts: KIT.map((drum, slot) => drumPart(slot, drum)),
      patches,
    },
  };
}

/** The issue's bench song, exactly as the issue built it. */
export const CASES = {
  bench: song('8-3ins', { parts: 8, inserts: INSERTS, sends: true }),
  drums: drums(),
};
