/**
 * The shipped arrangement is valid against everything it names — presets,
 * strips, scale shape, driver bounds — and `mergeArrangement` implements the
 * apply-over-defaults contract (issue #69, refinement decision 3).
 */
import { describe, expect, it } from 'vitest';

import { Arpeggiator } from './arpeggiator';
import { ARRANGEMENT, mergeArrangement, type DeepPartial, type Arrangement } from './arrangement';
import { GENERATOR_INDEX, MUSIC_PART_IDS } from './arrangementPlayer';
import { EuclideanSequencer } from './euclideanSequencer';
import { MIX } from './mix';
import { PRESETS } from './presets';
import { ScaleSampler, scaleOffsets } from './scaleSampler';
import { StepSequencer } from './stepSequencer';

describe('the shipped ARRANGEMENT', () => {
  it('names only presets that exist', () => {
    for (const id of MUSIC_PART_IDS) {
      expect(PRESETS[ARRANGEMENT[id].preset], `${id} preset`).toBeDefined();
    }
  });

  it('names only parts the MIX has a strip for', () => {
    const strips = MIX as Record<string, unknown>;
    for (const id of MUSIC_PART_IDS) {
      expect(strips[ARRANGEMENT[id].part], `${id} strip`).toBeDefined();
    }
  });

  it('weights every degree of its scale exactly once', () => {
    expect(ARRANGEMENT.key.weights).toHaveLength(scaleOffsets(ARRANGEMENT.key.scale).length);
  });

  it('constructs all four generators without throwing', () => {
    const sampler = new ScaleSampler(ARRANGEMENT.key);
    const seeded = <T>(
      driver: T,
      id: keyof typeof GENERATOR_INDEX,
    ): T & {
      seed: number;
      generatorIndex: number;
    } => ({ ...driver, seed: ARRANGEMENT.seed, generatorIndex: GENERATOR_INDEX[id] });
    expect(() => new EuclideanSequencer(seeded(ARRANGEMENT.kick.driver, 'kick'))).not.toThrow();
    expect(() => new EuclideanSequencer(seeded(ARRANGEMENT.hat.driver, 'hat'))).not.toThrow();
    expect(() => new Arpeggiator(sampler, seeded(ARRANGEMENT.arp.driver, 'arp'))).not.toThrow();
    expect(
      () => new StepSequencer(sampler, seeded(ARRANGEMENT.drone.driver, 'drone')),
    ).not.toThrow();
  });

  it('ties the drone: gate 1 at a full-bar step', () => {
    expect(ARRANGEMENT.drone.driver.gate).toBe(1);
    expect(ARRANGEMENT.drone.driver.divisor).toBe(96);
  });
});

describe('mergeArrangement', () => {
  it('changes only the named fields and leaves the input untouched', () => {
    const before = JSON.stringify(ARRANGEMENT);
    const { merged, ignored } = mergeArrangement(ARRANGEMENT, { bpm: 90, arp: { velocity: 0.5 } });
    expect(ignored).toEqual([]);
    expect(merged.bpm).toBe(90);
    expect(merged.arp.velocity).toBe(0.5);
    expect(merged.arp.driver).toEqual(ARRANGEMENT.arp.driver);
    expect(merged.kick).toEqual(ARRANGEMENT.kick);
    expect(JSON.stringify(ARRANGEMENT)).toBe(before);
  });

  it('reports unknown keys by path and ignores them', () => {
    const partial = { bogus: 1, kick: { nope: 2, velocity: 0.9 } } as DeepPartial<Arrangement>;
    const { merged, ignored } = mergeArrangement(ARRANGEMENT, partial);
    expect(ignored.sort()).toEqual(['bogus', 'kick.nope']);
    expect(merged.kick.velocity).toBe(0.9);
  });

  it('ignores and reports an object arriving where a leaf lives', () => {
    const partial = { bpm: { oops: 1 } } as unknown as DeepPartial<Arrangement>;
    const { merged, ignored } = mergeArrangement(ARRANGEMENT, partial);
    expect(ignored).toEqual(['bpm']);
    expect(merged.bpm).toBe(ARRANGEMENT.bpm);
  });

  it('replaces a tagged union wholesale when the kind changes', () => {
    const { merged, ignored } = mergeArrangement(ARRANGEMENT, {
      hat: { driver: { density: { kind: 'walk', stepChance: 0.5 } } },
    });
    expect(ignored).toEqual([]);
    // No lfoBars fields left lying around in the data (#70 round-trips it).
    expect(merged.hat.driver.density).toEqual({ kind: 'walk', stepChance: 0.5 });
  });

  it('merges within a union when the kind is unchanged', () => {
    const { merged } = mergeArrangement(ARRANGEMENT, {
      kick: { driver: { density: { kind: 'lfoBars', bars: 4 } } },
    });
    expect(merged.kick.driver.density).toEqual({ kind: 'lfoBars', bars: 4, shape: 'tri' });
  });

  it('replaces arrays and the scale wholesale', () => {
    const { merged, ignored } = mergeArrangement(ARRANGEMENT, {
      key: { scale: [0, 3, 7], weights: [3, 1, 2] },
    });
    expect(ignored).toEqual([]);
    expect(merged.key.scale).toEqual([0, 3, 7]);
    expect(merged.key.weights).toEqual([3, 1, 2]);
    expect(merged.key.root).toBe(ARRANGEMENT.key.root);
  });
});
