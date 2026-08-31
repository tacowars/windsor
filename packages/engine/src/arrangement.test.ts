/**
 * `mergeArrangement` implements the apply-over-defaults contract (issue #69,
 * refinement decision 3). The shipped arrangement's own validity is asserted
 * where the arrangement now lives (issue #75): `arrangementGate.test.ts`, on
 * the committed JSON document.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import { mergeArrangement, type Arrangement, type DeepPartial } from './arrangement';

describe('mergeArrangement', () => {
  it('changes only the named fields and leaves the input untouched', () => {
    const before = JSON.stringify(FULL_ARRANGEMENT);
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      bpm: 90,
      arp: { velocity: 0.5 },
    });
    expect(ignored).toEqual([]);
    expect(merged.bpm).toBe(90);
    expect(merged.arp?.velocity).toBe(0.5);
    expect(merged.arp?.driver).toEqual(FULL_ARRANGEMENT.arp.driver);
    expect(merged.kick).toEqual(FULL_ARRANGEMENT.kick);
    expect(JSON.stringify(FULL_ARRANGEMENT)).toBe(before);
  });

  it('reports unknown keys by path and ignores them', () => {
    const partial = { bogus: 1, kick: { nope: 2, velocity: 0.9 } } as DeepPartial<Arrangement>;
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, partial);
    expect(ignored.sort()).toEqual(['bogus', 'kick.nope']);
    expect(merged.kick?.velocity).toBe(0.9);
  });

  it('ignores and reports an object arriving where a leaf lives', () => {
    const partial = { bpm: { oops: 1 } } as unknown as DeepPartial<Arrangement>;
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, partial);
    expect(ignored).toEqual(['bpm']);
    expect(merged.bpm).toBe(FULL_ARRANGEMENT.bpm);
  });

  it('ignores and reports a partial naming an absent part slot', () => {
    // A part that was never initialised has no AudioPart; it cannot be added live.
    const kickOnly: Arrangement = {
      seed: FULL_ARRANGEMENT.seed,
      bpm: FULL_ARRANGEMENT.bpm,
      key: FULL_ARRANGEMENT.key,
      kick: FULL_ARRANGEMENT.kick,
    };
    const { merged, ignored } = mergeArrangement(kickOnly, { drone: { velocity: 0.5 } });
    expect(ignored).toEqual(['drone']);
    expect(merged.drone).toBeUndefined();
    expect(merged.kick).toEqual(FULL_ARRANGEMENT.kick);
  });

  it('replaces a tagged union wholesale when the kind changes', () => {
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      hat: { driver: { density: { kind: 'walk', stepChance: 0.5 } } },
    });
    expect(ignored).toEqual([]);
    // No lfoBars fields left lying around in the data (#70 round-trips it).
    expect(merged.hat?.driver.density).toEqual({ kind: 'walk', stepChance: 0.5 });
  });

  it('merges within a union when the kind is unchanged', () => {
    const { merged } = mergeArrangement(FULL_ARRANGEMENT, {
      kick: { driver: { density: { kind: 'lfoBars', bars: 4 } } },
    });
    expect(merged.kick?.driver.density).toEqual({ kind: 'lfoBars', bars: 4, shape: 'tri' });
  });

  it('replaces arrays and the scale wholesale', () => {
    const { merged, ignored } = mergeArrangement(FULL_ARRANGEMENT, {
      key: { scale: [0, 3, 7], weights: [3, 1, 2] },
    });
    expect(ignored).toEqual([]);
    expect(merged.key.scale).toEqual([0, 3, 7]);
    expect(merged.key.weights).toEqual([3, 1, 2]);
    expect(merged.key.root).toBe(FULL_ARRANGEMENT.key.root);
  });
});
