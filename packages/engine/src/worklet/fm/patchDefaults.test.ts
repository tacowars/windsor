import { describe, expect, it } from 'vitest';

import { makePatch } from '../../patch/patch';
import type { PartialPatch, Patch } from '../../patch/patch';
import { patchLeafDifferences } from '../../patch/patchLibrary';
import type { WorkletPatch } from './patchNormalise';
import { TONE_RANGE } from './patchDefaults';
import { WAVE } from './waveIds';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { normalisePatch } = await import('./patchNormalise');

/** The worklet's fill, less the audio loop's scratch, which is not a patch field. */
function workletFill(partial: PartialPatch): Patch {
  const patch: Partial<Pick<WorkletPatch, 'feedbackScratch'>> & Patch = normalisePatch(partial);
  delete patch.feedbackScratch;
  return patch;
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
  ])('fills the rest of a partial naming %s identically', (_what, partial) => {
    expect(patchLeafDifferences(workletFill(partial), makePatch(partial), 'partial')).toEqual([]);
  });

  it('names the leaf where the two fills part (the comparator is not vacuous)', () => {
    // The worklet clamps `tone` to its floor; makePatch() keeps what it is given.
    expect(patchLeafDifferences(workletFill({ tone: 0 }), makePatch({ tone: 0 }), 'p')).toEqual([
      `p.tone: ${TONE_RANGE.min} ≠ 0`,
    ]);
  });
});
