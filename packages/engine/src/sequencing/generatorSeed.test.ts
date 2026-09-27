/**
 * The seed contract across generators (#705): every sequencer carries its own
 * seed and draws one stream per region entry. Re-seeding one part leaves every
 * other part's output byte-identical.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_EUCLIDEAN_CONFIG, EuclideanSequencer } from './euclideanSequencer';
import { GENERATOR_SEED_STRIDE, hashSeed, streamRng } from './generatorSeed';
import { DEFAULT_GRID_CONFIG, GridSequencer } from './gridSequencer';
import { ScaleSampler } from './scaleSampler';
import { TICKS_PER_BAR, TickTransport } from './scheduler';

interface Seeds {
  kick: number;
  hat: number;
  arp: number;
  drone: number;
}

/** The four parts of the record's §7, driven together for `bars`, as JSON per part. */
function arrangement(seeds: Seeds, bars = 16): Record<keyof Seeds, string> {
  const sampler = new ScaleSampler({ root: 0, scale: 'dorian' });
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
    density: { kind: 'walk', stepChance: 0.8 },
  });
  const hat = new EuclideanSequencer({
    ...DEFAULT_EUCLIDEAN_CONFIG,
    seed: seeds.hat,
    divisor: 3,
    steps: 32,
    pulses: { min: 8, max: 24, start: 12 },
    density: { kind: 'walk', stepChance: 0.9 },
  });
  // The two pitched parts are grids whose only draw is the seeded skip (#704:
  // the arpeggiator and step sequencer that held these slots are gone).
  const arp = new GridSequencer(sampler, {
    ...DEFAULT_GRID_CONFIG,
    skipChance: 0.5,
    seed: seeds.arp,
  });
  const drone = new GridSequencer(sampler, {
    ...DEFAULT_GRID_CONFIG,
    divisor: 24,
    skipChance: 0.5,
    seed: seeds.drone,
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

describe('hashSeed', () => {
  it('derives a distinct 32-bit seed per region index', () => {
    expect(hashSeed(7, 0)).toBe(7);
    expect(hashSeed(7, 1)).toBe((7 + GENERATOR_SEED_STRIDE) >>> 0);
    expect(hashSeed(7, 1)).not.toBe(hashSeed(8, 0));
    const seeds = new Set(Array.from({ length: 64 }, (_, i) => hashSeed(123, i)));
    expect(seeds.size).toBe(64);
  });

  it('gives each region its own stream from the same seed', () => {
    const a = streamRng(9, 0);
    const b = streamRng(9, 1);
    const again = streamRng(9, 0);
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

  it('one part entering a later region draws a different stream from the same seed (#705)', () => {
    const run = (region: number): string => {
      const transport = new TickTransport(96);
      const out: unknown[] = [];
      const hat = new EuclideanSequencer({
        ...DEFAULT_EUCLIDEAN_CONFIG,
        seed: 1000,
        density: { kind: 'walk', stepChance: 0.9 },
      });
      hat.enter(region);
      hat.onOnset = (e) => out.push(e);
      hat.attach(transport);
      for (let i = 0; i < 16 * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
      return JSON.stringify(out);
    };
    expect(run(0)).toBe(run(0));
    expect(run(1)).not.toBe(run(0));
  });
});
