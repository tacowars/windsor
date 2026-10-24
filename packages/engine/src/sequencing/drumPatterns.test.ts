/**
 * The Drum's pattern bank (windsor#950): the thirty patterns are well
 * formed, the row notation expands exactly, and applying and matching a
 * pattern touch only the line.
 */
import { describe, expect, it } from 'vitest';

import { RATCHET_MAX } from '../audioConstants';
import { DRUM_PITCH_MAX } from './drumConstants';
import { assertDrumConfig, DEFAULT_DRUM_CONFIG, type DrumSequencerConfig } from './drumSequencer';
import {
  applyDrumPattern,
  DRUM_PATTERN_GROUPS,
  DRUM_PATTERNS,
  drumPatternOf,
  expandDrumRows,
  type DrumPattern,
} from './drumPatterns';
import { DRUM_REST, assertDrumStep, drumHit, type DrumStep } from './drumSteps';

const pattern = (id: string): DrumPattern => DRUM_PATTERNS.find((p) => p.id === id)!;

describe('the bank', () => {
  it('holds thirty patterns of sixteen steps, with unique kebab-case ids and names', () => {
    expect(DRUM_PATTERNS).toHaveLength(30);
    expect(new Set(DRUM_PATTERNS.map((p) => p.id)).size).toBe(30);
    expect(new Set(DRUM_PATTERNS.map((p) => p.name)).size).toBe(30);
    for (const p of DRUM_PATTERNS) {
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.steps, p.id).toHaveLength(16);
    }
  });

  it('writes every step as the Drum checks it, velocity in (0, 1], pitch ±24, ratchet 1–4', () => {
    for (const p of DRUM_PATTERNS) {
      p.steps.forEach((step, i) => {
        assertDrumStep(step, i);
        if (step.kind !== 'hit') return;
        expect(step.velocity ?? 1, `${p.id} ${i}`).toBeGreaterThan(0);
        expect(step.velocity ?? 1).toBeLessThanOrEqual(1);
        expect(Math.abs(step.pitch ?? 0)).toBeLessThanOrEqual(DRUM_PITCH_MAX);
        expect(step.ratchet ?? 1).toBeGreaterThanOrEqual(1);
        expect(step.ratchet ?? 1).toBeLessThanOrEqual(RATCHET_MAX);
      });
      expect(() => assertDrumConfig(applyDrumPattern(DEFAULT_DRUM_CONFIG, p.id))).not.toThrow();
    }
  });

  it('puts every pattern in one of the groups and at least one pattern in each', () => {
    for (const p of DRUM_PATTERNS) expect(DRUM_PATTERN_GROUPS).toContain(p.group);
    for (const group of DRUM_PATTERN_GROUPS) {
      expect(
        DRUM_PATTERNS.some((p) => p.group === group),
        group,
      ).toBe(true);
    }
  });
});

describe('expandDrumRows', () => {
  it('expands the snare roll: tenths rising, ratchets 2 2 3 4, the last hit accented', () => {
    const tenths = [0.3, 0.3, 0.4, 0.4, 0.5, 0.5, 0.6, 0.6, 0.7, 0.7, 0.8, 0.8, 0.9, 0.9, 1, 1];
    const ratchets: Record<number, number> = { 12: 2, 13: 2, 14: 3, 15: 4 };
    const expected: DrumStep[] = tenths.map((velocity, i) =>
      drumHit({
        ...(velocity !== 1 && { velocity }),
        ...(ratchets[i] !== undefined && { ratchet: ratchets[i] }),
        accent: i === 15,
      }),
    );
    expect(pattern('snare-roll').steps).toEqual(expected);
  });

  it('expands the tom roll: halves, the pitch row, the accent', () => {
    const velocities = [0.5, 0.55, 0.65, 0.7, 0.8, 0.85, 0.95, 1];
    const pitches = [7, 7, 5, 5, 3, 3, 0, 0];
    const expected: DrumStep[] = [
      ...Array.from({ length: 8 }, () => DRUM_REST),
      ...velocities.map((velocity, k) =>
        drumHit({
          ...(velocity !== 1 && { velocity }),
          ...(pitches[k] !== 0 && { pitch: pitches[k] }),
          accent: k === 7,
        }),
      ),
    ];
    expect(pattern('tom-roll').steps).toEqual(expected);
  });

  it('refuses a short row, an unknown character and a mark on a rest', () => {
    const rows = { id: 't', name: 'T', velocity: 'X...............' };
    expect(() => expandDrumRows({ ...rows, velocity: 'X...' })).toThrow(/16/);
    expect(() => expandDrumRows({ ...rows, accent: '!' })).toThrow(/16/);
    expect(() => expandDrumRows({ ...rows, velocity: 'Y...............' })).toThrow(/velocity/);
    expect(() => expandDrumRows({ ...rows, ratchet: '5...............' })).toThrow(/ratchet/);
    expect(() => expandDrumRows({ ...rows, half: '+...............' })).toThrow(/full/);
    expect(() => expandDrumRows({ ...rows, accent: '.!..............' })).toThrow(/rest/);
  });
});

describe('applyDrumPattern', () => {
  const config: DrumSequencerConfig = {
    ...DEFAULT_DRUM_CONFIG,
    steps: Array.from({ length: 32 }, () => DRUM_REST),
    length: 24,
    note: 48,
    gate: 0.8,
    divisor: 12,
    randomness: 0.4,
    probability: 0.6,
    restsSound: true,
    octaveMode: true,
    chancePerEffect: true,
    seed: 7,
    lanes: [{ param: 'filter.cutoff', values: Array.from({ length: 32 }, () => 0.5) }],
  };

  it('sets the steps and a loop of sixteen and keeps every other field', () => {
    const applied = applyDrumPattern(config, 'hat-gallop');
    expect(applied).toEqual({ ...config, steps: pattern('hat-gallop').steps, length: 16 });
  });

  it('throws on an unknown id', () => {
    expect(() => applyDrumPattern(config, 'no-such-pattern')).toThrow(/no-such-pattern/);
  });
});

describe('drumPatternOf', () => {
  it('finds every pattern from its own steps', () => {
    for (const p of DRUM_PATTERNS) {
      const { steps, length } = applyDrumPattern(DEFAULT_DRUM_CONFIG, p.id);
      expect(drumPatternOf(steps, length)).toBe(p.id);
    }
  });

  it('reads an absent key as its default, so an explicit velocity of 1 still matches', () => {
    const steps = pattern('kick-four').steps.map((s) =>
      s.kind === 'hit' ? { ...s, velocity: 1 } : s,
    );
    expect(drumPatternOf(steps)).toBe('kick-four');
  });

  it('is null after one velocity edit, and for a loop other than sixteen', () => {
    const steps = [...pattern('snare-ghosts').steps];
    steps[3] = drumHit({ velocity: 0.4 });
    expect(drumPatternOf(steps)).toBeNull();
    const own = pattern('snare-ghosts').steps;
    expect(drumPatternOf(own, 12)).toBeNull();
    expect(drumPatternOf([...own, ...own], 32)).toBeNull();
    expect(drumPatternOf([...own, ...own], 16)).toBe('snare-ghosts');
  });
});
