/**
 * bloom's pitch set in the shipped bundle (windsor#728): at the corners (every
 * class, the empty set, one class, two adjacent classes) and at every Octave,
 * no band reads outside the pitch tables and every band's ratio stays in the
 * generator's range, F2 and E6 included; a single class re-pitches a tone by
 * up to six semitones, and a set changed mid-render retunes.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { describe, expect, it } from 'vitest';
import { bloomRig, lineDb, tone } from '../__fixtures__/bloomHarness';
import { BLOOM_LOWEST_NOTE, BLOOM_OCTAVES, BLOOM_PITCHES_ALL } from './bloomConstants';
import { BLOOM_GENERATOR, BLOOM_OCTAVE_RATIOS } from './bloomGeneratorConstants';
import { bloomPitches } from './bloomPitches';

const RATE = 48000;
const BANDS = 48;
const NOTE_HZ = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

interface PitchInternals {
  reach: number;
  corrections: Int32Array;
  noteCos: Float64Array;
  ratio: Float64Array;
  mode: Int32Array;
  stepRe: Float64Array;
  stepIm: Float64Array;
  partials: Int32Array;
}

const pitchOf = (rig: ReturnType<typeof bloomRig>): PitchInternals =>
  (rig.processor.dsp as unknown as { generator: { pitch: PitchInternals } }).generator.pitch;

/** A rig whose pitch set is `mask`, retuned (nothing sounds, so at once). */
function rigAt(mask: number, octave: number, rate = RATE): ReturnType<typeof bloomRig> {
  const rig = bloomRig({ octave }, rate);
  rig.params['pitches']![0] = mask;
  rig.render(128);
  return rig;
}

const CORNERS: [string, number][] = [
  ['every class', BLOOM_PITCHES_ALL],
  ['the empty set', 0],
  ['C alone', 1],
  ['F♯ alone', 1 << 6],
  ['A♯ alone (E6 moves −6)', 1 << 10],
  ['B alone (F2 moves −6)', 1 << 11],
  ['C and C♯', 0b11],
  ['B and C', (1 << 11) | 1],
  ['D dorian', bloomPitches({ key: 'D', scale: 'dorian' })],
];

describe("bloom's pitch set at the corners", () => {
  const reach = BLOOM_GENERATOR.pitchReach;
  const lowest = BLOOM_OCTAVE_RATIOS[0]![0] / BLOOM_OCTAVE_RATIOS[0]![1] / 2 ** (reach / 12);
  const highest = (BLOOM_OCTAVE_RATIOS.at(-1)![0] / BLOOM_OCTAVE_RATIOS.at(-1)![1]) * 2 ** (5 / 12);

  for (const rate of [44100, RATE, 96000]) {
    it(`reads inside the tables, every ratio in range, at ${rate} Hz`, () => {
      for (const [what, mask] of CORNERS) {
        BLOOM_OCTAVES.forEach((octave, step) => {
          const pitch = pitchOf(rigAt(mask, octave, rate));
          const [num, den] = BLOOM_OCTAVE_RATIOS[step]!;
          expect(pitch.reach).toBe(reach);
          for (let b = 0; b < BANDS; b++) {
            const at = `${what}, ${octave} st, band ${b}`;
            const m = pitch.corrections[(BLOOM_LOWEST_NOTE + b) % 12]!;
            expect(b + m + reach, at).toBeGreaterThanOrEqual(0);
            expect(b + m + reach, at).toBeLessThan(pitch.noteCos.length);
            const r = pitch.ratio[b]!;
            expect(r, at).toBeCloseTo((num / den) * 2 ** (m / 12), 12);
            expect(r, at).toBeGreaterThanOrEqual(lowest * (1 - 1e-12));
            expect(r, at).toBeLessThanOrEqual(highest * (1 + 1e-12));
            expect(pitch.partials[b], at).toBeGreaterThanOrEqual(1);
            expect(Math.hypot(pitch.stepRe[b]!, pitch.stepIm[b]!), at).toBeCloseTo(1, 12);
          }
        });
      }
    });
  }

  it('moves F2 and E6, the band range’s ends, by the full six semitones, down', () => {
    expect(pitchOf(rigAt(1 << 11, 0)).ratio[0]).toBeCloseTo(2 ** (-6 / 12), 12);
    expect(pitchOf(rigAt(1 << 10, 0)).ratio[BANDS - 1]).toBeCloseTo(2 ** (-6 / 12), 12);
  });
});

describe("bloom's pitch set in the render", () => {
  const level = (data: Float32Array, hz: number): number =>
    lineDb(data, { hz, rate: RATE, from: 0.5 * RATE, to: RATE, reference: 1 });

  it('a single class re-pitches a tone six semitones down on the tie: D♯4 to A3 alone', () => {
    const rig = bloomRig({ mix: 1 });
    rig.params['pitches']![0] = 1 << 9;
    const data = rig.render(RATE, tone(NOTE_HZ(63), 0.25, RATE)).left;
    expect(level(data, NOTE_HZ(57)) - level(data, NOTE_HZ(63))).toBeGreaterThan(20);
  });

  it('a set changed mid-render retunes: C♯4 under chromatic, then C4 under C alone', () => {
    const rig = bloomRig({ mix: 1 });
    const source = tone(NOTE_HZ(61), 0.25, RATE);
    const before = rig.render(RATE, source).left;
    expect(level(before, NOTE_HZ(61)) - level(before, NOTE_HZ(60))).toBeGreaterThan(20);
    const after = rig.render(RATE, source, {
      onBlock: (frame, params) => {
        if (frame === 0) params['pitches']![0] = 1;
      },
    }).left;
    expect(level(after, NOTE_HZ(60)) - level(after, NOTE_HZ(61))).toBeGreaterThan(20);
  });
});
