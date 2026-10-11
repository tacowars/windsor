/**
 * bloom's pitch set (windsor#728): Key and Scale are Windsor's own lists,
 * `pitchMask` folds every scale above every root into the 12-bit set, and the
 * corrections the processor works out from a set (`bloomMaskCorrections`,
 * from the shipped bundle) are the old per-scale table's for Bloom's
 * original seven scales, so a song on one of them sounds as it did. The
 * corners: every class, the empty set, one class (±6, the tie down), two
 * adjacent classes.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { describe, expect, it } from 'vitest';
import { CHORD_NOTE_NAMES } from '../harmony/chordTables';
import { SCALE_NAMES, SCALES } from '../sequencing/scaleSampler';
import { bloomMaskCorrections } from '../__fixtures__/bloomHarness';
import { BLOOM_PITCHES_ALL } from './bloomConstants';
import { BLOOM_GENERATOR } from './bloomGeneratorConstants';
import { BLOOM_KEY_CHOICES, BLOOM_SCALE_CHOICES, bloomPitches, pitchMask } from './bloomPitches';
import type { BloomScale } from './bloomPitches';

/** The classes of a set, ascending. */
const classesOf = (mask: number): number[] =>
  Array.from({ length: 12 }, (_, p) => p).filter((p) => (mask >> p) & 1);

const writeCorrections = bloomMaskCorrections();
const corrections = (mask: number): number[] => {
  const out = new Int32Array(12);
  writeCorrections(mask, out);
  return [...out];
};

/**
 * The table the worklet held before windsor#728 (`bloomScaleCorrections`),
 * per degree above the key, under each scale's name today.
 */
const OLD_TABLE: [BloomScale, number[]][] = [
  ['chromatic', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['major', [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0]],
  ['naturalMinor', [0, -1, 0, 0, -1, 0, -1, 0, 0, -1, 0, -1]],
  ['dorian', [0, -1, 0, 0, -1, 0, -1, 0, -1, 0, 0, -1]],
  ['mixolydian', [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, 0, -1]],
  ['pentatonicMajor', [0, -1, 0, -1, 0, -1, 1, 0, -1, 0, -1, 1]],
  ['pentatonicMinor', [0, -1, 1, 0, -1, 0, -1, 0, -1, 1, 0, -1]],
];

describe("bloom's lists are Windsor's", () => {
  it('Scale is chromatic, then SCALE_NAMES in order; Key is CHORD_NOTE_NAMES itself', () => {
    expect(BLOOM_SCALE_CHOICES).toEqual(['chromatic', ...SCALE_NAMES]);
    expect(BLOOM_KEY_CHOICES).toBe(CHORD_NOTE_NAMES);
  });
});

describe('pitchMask', () => {
  it('folds every SCALES entry above every root into its pitch classes', () => {
    for (let root = 0; root < 12; root++) {
      for (const name of SCALE_NAMES) {
        const want = [...new Set(SCALES[name].map((o) => (root + o) % 12))].sort((a, b) => a - b);
        const mask = pitchMask(root, SCALES[name]);
        expect(classesOf(mask), `${root} ${name}`).toEqual(want);
        const key = CHORD_NOTE_NAMES[root]!;
        expect(bloomPitches({ key, scale: name })).toBe(mask);
      }
      expect(bloomPitches({ key: CHORD_NOTE_NAMES[root]!, scale: 'chromatic' })).toBe(
        BLOOM_PITCHES_ALL,
      );
    }
  });

  it('folds offsets past an octave either way, and no offsets is the empty set', () => {
    expect(pitchMask(11, [0, 13, -1, 24])).toBe(pitchMask(11, [0, 1, 11]));
    expect(pitchMask(3, [])).toBe(0);
  });
});

describe("the corrections from a pitch set's mask", () => {
  it("are the old table's for the original seven scales, at every key", () => {
    for (const [scale, row] of OLD_TABLE) {
      for (let key = 0; key < 12; key++) {
        const got = corrections(bloomPitches({ key: CHORD_NOTE_NAMES[key]!, scale }));
        const want = Array.from({ length: 12 }, (_, p) => row[(p - key + 12) % 12]!);
        expect(got, `${CHORD_NOTE_NAMES[key]} ${scale}`).toEqual(want);
      }
    }
  });

  it('are 0 for every class, and the empty set reads as every class', () => {
    expect(corrections(BLOOM_PITCHES_ALL)).toEqual(new Array(12).fill(0));
    expect(corrections(0)).toEqual(new Array(12).fill(0));
  });

  it('move every class to a single one, round the circle, up to ±6 and the tie down', () => {
    for (let q = 0; q < 12; q++) {
      const got = corrections(1 << q);
      for (let p = 0; p < 12; p++) {
        const up = (q - p + 12) % 12;
        expect(got[p], `${p} to {${q}}`).toBe(up === 0 ? 0 : up < 6 ? up : up - 12);
      }
      expect(got[(q + 6) % 12]).toBe(-6);
    }
  });

  it('two adjacent classes: the far side splits, ties down', () => {
    // {C, C♯}: F♯ is 5 above C♯ and 6 below C, so down; G is 6 above C♯ and 5 below C, so up.
    expect(corrections(0b11)).toEqual([0, 0, -1, -2, -3, -4, -5, 5, 4, 3, 2, 1]);
    // {B, C}: across the circle's seam.
    expect(corrections((1 << 11) | 1)).toEqual([0, -1, -2, -3, -4, -5, 5, 4, 3, 2, 1, 0]);
  });

  it('never need more than the tables reach, over every set', () => {
    let most = 0;
    for (let mask = 0; mask <= BLOOM_PITCHES_ALL; mask++)
      for (const m of corrections(mask)) most = Math.max(most, Math.abs(m));
    expect(most).toBe(BLOOM_GENERATOR.pitchReach);
  });
});
