import { describe, expect, it } from 'vitest';

import { makePatch } from '../../patch/patch';
import type { PartialPatch, Patch } from '../../patch/patch';
import { patchLeafDifferences } from '../../patch/patchLibrary';
import { DRIVE_SHAPE } from './modeIds';
import { FORMANT_VOWELS } from './formantTables';
import {
  DRIVE_BIAS_RANGE,
  DRIVE_GAIN_RANGE,
  DRIVE_TONE_RANGE,
  TONE_RANGE,
  VOWEL_RANGE,
} from './patchDefaults';
import { WAVE } from './waveIds';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { normalisePatch } = await import('./patchNormalise');

/** The worklet's fill. */
function workletFill(partial: PartialPatch): Patch {
  return normalisePatch(partial);
}

describe('the patch defaults (#670)', () => {
  it('fills an empty patch identically in the worklet and in makePatch()', () => {
    expect(patchLeafDifferences(workletFill({}), makePatch(), 'defaults')).toEqual([]);
  });

  it.each<[string, PartialPatch]>([
    ['an operator field', { ops: [{}, { level: 0.5, env: { attackTime: 0.1 } }] }],
    ['the pitch envelope', { pitchEnvAmount: 3, pitchEnv: { attackTime: 0.05 } }],
    [
      'the filter and its envelope',
      { filter: { cutoff: 500, env: { releaseTime: 1 } } } as PartialPatch,
    ],
    // makePatch() takes an array wholesale where the worklet fills per index, so a full one.
    ['the LFO', { lfo: { rate: 2, toOp: [0.5, 0, 0, 0] } }],
    // windsor#54: the operator width inside its range, the LFO fields and LFO 2.
    ['an operator width', { ops: [{ width: 0.5 }, { wave: WAVE.PULSE, width: 0.25 }] }],
    [
      "the LFO's one-shot, unipolar and width depths",
      { lfo: { oneShot: true, unipolar: true, toWidth: [0, 0.4, 0, 0] } },
    ],
    ['LFO 2', { lfo2: { rate: 0.5, amount: 1, toOp: [0, 0, 0.2, 0], toWidth: [0.3, 0, 0, 0] } }],
    ["the filter's LFO 2 depth", { filter: { lfo2Amount: 2 } } as PartialPatch],
    // windsor#300: the drive stage, inside its ranges.
    ['the drive', { drive: { gain: 2, shape: 3, bias: 0.3 } }],
    // windsor#309: the switch written, and derived from a bias alone.
    ['the drive switched off', { drive: { on: false, gain: 2 } }],
    ['a drive biased with no switch', { drive: { bias: -0.4 } }],
    // windsor#331: the Formant mode and its vowel, inside its range.
    ['the Formant vowel', { filter: { mode: 5, vowel: 2.5 } } as PartialPatch],
    // windsor#559: a macro and its mapping, inside their ranges.
    [
      'a macro',
      {
        macros: [
          {
            name: 'Accent',
            value: 0.5,
            mappings: [{ target: 'filter.cutoff', min: 200, max: 900 }],
          },
        ],
      },
    ],
    // windsor#560: a mapping that omits its ends, on a row whose minimum is not 0 (30 Hz).
    ['a mapping with no ends', { macros: [{ mappings: [{ target: 'filter.cutoff' }] }] }],
    // windsor#646: sync masters, a cycle the one rule turns off, and the LFO ratio depths.
    [
      'operator syncs and a cycle',
      { ops: [{ sync: 'B' }, { sync: 'A' }, { sync: 'note' }, { sync: 'C' }] },
    ],
    ['an unknown sync', { ops: [{ sync: 'X' } as never] }],
    ['the LFO ratio depths', { lfo: { toRatio: [0, 0.5, 0, -1] } }],
  ])('fills the rest of a partial naming %s identically', (_what, partial) => {
    expect(patchLeafDifferences(workletFill(partial), makePatch(partial), 'partial')).toEqual([]);
  });

  it('names the leaf where the two fills part (the comparator is not vacuous)', () => {
    // The worklet clamps `tone` to its floor; makePatch() keeps what it is given.
    expect(patchLeafDifferences(workletFill({ tone: 0 }), makePatch({ tone: 0 }), 'p')).toEqual([
      `p.tone: ${TONE_RANGE.min} ≠ 0`,
    ]);
  });

  it('clamps the drive to its ranges and plays an unknown shape as soft (windsor#300)', () => {
    const drive = workletFill({ drive: { gain: 3, shape: 9, bias: -4, tone: 2 } }).drive;
    expect(drive).toEqual({
      on: true,
      gain: 3,
      shape: DRIVE_SHAPE.SOFT,
      bias: DRIVE_BIAS_RANGE.min,
      tone: DRIVE_TONE_RANGE.max,
    });
  });

  it('ranges the Formant vowel over the vowel table, one unit a row (windsor#331)', () => {
    expect(VOWEL_RANGE).toEqual({ min: 0, max: FORMANT_VOWELS.length - 1 });
    expect(FORMANT_VOWELS.map((v) => v.name)).toEqual(['a', 'e', 'i', 'o', 'u']);
  });

  it('clamps the drive gain to its range, so the shaper never sees an overflow (windsor#308)', () => {
    expect(workletFill({ drive: { gain: 1e308 } }).drive.gain).toBe(DRIVE_GAIN_RANGE.max);
    expect(workletFill({ drive: { gain: -3 } }).drive.gain).toBe(DRIVE_GAIN_RANGE.min);
    expect(DRIVE_GAIN_RANGE.max).toBeGreaterThanOrEqual(6); // the console's Drive knob
  });
});
