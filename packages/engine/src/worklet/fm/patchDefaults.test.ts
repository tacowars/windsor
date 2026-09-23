import { describe, expect, it } from 'vitest';

import { makePatch } from '../../patch/patch';
import type { PartialPatch, Patch } from '../../patch/patch';
import { patchLeafDifferences } from '../../patch/patchLibrary';
import type { WorkletPatch } from './patchNormalise';

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
  ])('fills the rest of a partial naming %s identically', (_what, partial) => {
    expect(patchLeafDifferences(workletFill(partial), makePatch(partial), 'partial')).toEqual([]);
  });

  it('names the leaf where the two fills part (the comparator is not vacuous)', () => {
    expect(patchLeafDifferences(workletFill({ tone: 0 }), makePatch({ tone: 0 }), 'p')).toEqual([
      'p.tone: 0.02 ≠ 0',
    ]);
  });
});
