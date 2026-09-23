/**
 * The seed contract across generators: one arrangement seed, one stream per
 * generator. Re-seeding one part leaves every other part's output byte-identical.
 */
import { describe, expect, it } from 'vitest';

import { Arpeggiator, DEFAULT_ARPEGGIATOR_CONFIG } from './arpeggiator';
import { DEFAULT_EUCLIDEAN_CONFIG, EuclideanSequencer } from './euclideanSequencer';
import { GENERATOR_SEED_STRIDE, generatorRng, generatorSeed } from './generatorSeed';
import { ScaleSampler, uniformWeights } from './scaleSampler';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import { DEFAULT_STEP_SEQUENCER_CONFIG, StepSequencer } from './stepSequencer';

interface Seeds {
  kick: number;
  hat: number;
  arp: number;
  drone: number;
}

/** The four parts of the record's §7, driven together for `bars`, as JSON per part. */
function arrangement(seeds: Seeds, bars = 16): Record<keyof Seeds, string> {
  const sampler = new ScaleSampler({
    root: 48,
    scale: 'dorian',
    weights: uniformWeights('dorian'),
  });
  const transport = new TickTransport(96);
  const out = {
    kick: [] as unknown[],
    hat: [] as unknown[],
    arp: [] as unknown[],
    drone: [] as unknown[],
  };

  const kick = new EuclideanSequencer({
    ...DEFAULT_EUCLIDEAN_CONFIG,
    seed: seeds.kick,
    generatorIndex: 0,
    density: { kind: 'walk', stepChance: 0.8 },
  });
  const hat = new EuclideanSequencer({
    ...DEFAULT_EUCLIDEAN_CONFIG,
    seed: seeds.hat,
    generatorIndex: 1,
    divisor: 3,
    steps: 32,
    pulses: { min: 8, max: 24, start: 12 },
    density: { kind: 'walk', stepChance: 0.9 },
  });
  const arp = new Arpeggiator(sampler, {
    ...DEFAULT_ARPEGGIATOR_CONFIG,
    seed: seeds.arp,
    generatorIndex: 2,
  });
  const drone = new StepSequencer(sampler, {
    ...DEFAULT_STEP_SEQUENCER_CONFIG,
    seed: seeds.drone,
    generatorIndex: 3,
  });
  kick.onOnset = (e) => out.kick.push(e);
  hat.onOnset = (e) => out.hat.push(e);
  arp.onNote = (e) => out.arp.push(e);
  drone.onNote = (e) => out.drone.push(e);
  kick.attach(transport);
  hat.attach(transport);
  arp.attach(transport);
  drone.attach(transport);

  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
  return {
    kick: JSON.stringify(out.kick),
    hat: JSON.stringify(out.hat),
    arp: JSON.stringify(out.arp),
    drone: JSON.stringify(out.drone),
  };
}

describe('generatorSeed', () => {
  it('derives a distinct 32-bit seed per generator index', () => {
    expect(generatorSeed(7, 0)).toBe(7);
    expect(generatorSeed(7, 1)).toBe((7 + GENERATOR_SEED_STRIDE) >>> 0);
    expect(generatorSeed(7, 1)).not.toBe(generatorSeed(8, 0));
    const seeds = new Set(Array.from({ length: 64 }, (_, i) => generatorSeed(123, i)));
    expect(seeds.size).toBe(64);
  });

  it('gives each index its own stream from the same arrangement seed', () => {
    const a = generatorRng(9, 0);
    const b = generatorRng(9, 1);
    const again = generatorRng(9, 0);
    const first = Array.from({ length: 8 }, () => a());
    expect(Array.from({ length: 8 }, () => again())).toEqual(first);
    expect(Array.from({ length: 8 }, () => b())).not.toEqual(first);
  });
});

describe('an arrangement of four generators', () => {
  const base: Seeds = { kick: 1000, hat: 1000, arp: 1000, drone: 1000 };

  it('is byte-identical for the same seeds', () => {
    expect(arrangement(base)).toEqual(arrangement(base));
  });

  it('changing one generator seed changes only that generator', () => {
    const before = arrangement(base);
    const after = arrangement({ ...base, hat: 2000 });
    expect(after.hat).not.toBe(before.hat);
    expect(after.kick).toBe(before.kick);
    expect(after.arp).toBe(before.arp);
    expect(after.drone).toBe(before.drone);

    const arpOnly = arrangement({ ...base, arp: 2000 });
    expect(arpOnly.arp).not.toBe(before.arp);
    expect(arpOnly.hat).toBe(before.hat);
    expect(arpOnly.drone).toBe(before.drone);
  });

  it('parts sharing one arrangement seed still get different streams by index', () => {
    const one = arrangement(base);
    expect(one.kick).not.toBe(one.hat);
  });
});
