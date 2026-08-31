import { describe, expect, it } from 'vitest';

import { euclid, patternToString, rotatePattern } from './euclid';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  EuclideanSequencer,
  LFO_SHAPES,
  lfoValue,
  type DensityMod,
  type EuclideanConfig,
  type OnsetEvent,
} from './euclideanSequencer';
import { TICKS_PER_BAR, TickTransport } from './scheduler';

interface StepTrace {
  tick: number;
  tickInBar: number;
  bar: number;
  k: number;
  pattern: string;
  onset: OnsetEvent | null;
}

/** Drive a sequencer from a real transport and record what it held at every step. */
function trace(config: EuclideanConfig, bars: number, bpm = 120): StepTrace[] {
  const transport = new TickTransport(bpm);
  const seq = new EuclideanSequencer(config);
  const out: StepTrace[] = [];
  transport.subscribe(config.divisor, (event) => {
    const onset = seq.handleTick(event);
    out.push({
      tick: event.tick,
      tickInBar: event.tickInBar,
      bar: event.bar,
      k: seq.currentK,
      pattern: patternToString(seq.currentPattern),
      onset,
    });
  });
  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
  return out;
}

function withDensity(density: DensityMod, extra: Partial<EuclideanConfig> = {}): EuclideanConfig {
  return { ...DEFAULT_EUCLIDEAN_CONFIG, density, ...extra };
}

const KINDS: ReadonlyArray<[string, DensityMod]> = [
  ['lfoBars', { kind: 'lfoBars', bars: 8, shape: 'tri' }],
  ['lfoHz', { kind: 'lfoHz', hz: 0.37, shape: 'sine' }],
  ['walk', { kind: 'walk', stepChance: 1 }],
];

describe('lfoValue', () => {
  it.each(LFO_SHAPES)('%s peaks at phase 0 and stays in [0, 1]', (shape) => {
    expect(lfoValue(shape, 0)).toBe(1);
    expect(lfoValue(shape, 1)).toBe(1);
    for (let i = 0; i <= 100; i++) {
      const v = lfoValue(shape, i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(lfoValue(shape, 0.5)).toBeLessThanOrEqual(0.5);
    expect(lfoValue(shape, 0.25)).toBeLessThan(1);
  });
});

describe('EuclideanSequencer', () => {
  it('emits onsets exactly where the current figure has them', () => {
    const rows = trace(withDensity({ kind: 'lfoBars', bars: 4, shape: 'saw' }), 8);
    for (const row of rows) {
      const step = (row.tick / DEFAULT_EUCLIDEAN_CONFIG.divisor) % DEFAULT_EUCLIDEAN_CONFIG.steps;
      const expected = row.pattern[step] === 'x';
      expect(row.onset !== null, `tick ${row.tick}`).toBe(expected);
      if (row.onset) expect(row.onset).toMatchObject({ tick: row.tick, step, k: row.k, n: 16 });
    }
  });

  it.each(KINDS)('%s: k stays within bounds and moves', (_name, density) => {
    const rows = trace(withDensity(density), 64);
    const ks = new Set(rows.map((r) => r.k));
    for (const k of ks) {
      expect(k).toBeGreaterThanOrEqual(DEFAULT_EUCLIDEAN_CONFIG.pulses.min);
      expect(k).toBeLessThanOrEqual(DEFAULT_EUCLIDEAN_CONFIG.pulses.max);
    }
    expect(ks.size).toBeGreaterThan(2);
  });

  it('the LFO kinds reach both bounds; the walk is clamped at both', () => {
    const { min, max } = DEFAULT_EUCLIDEAN_CONFIG.pulses;
    for (const [, density] of KINDS.slice(0, 2)) {
      const ks = new Set(trace(withDensity(density), 64).map((r) => r.k));
      expect(ks.has(min)).toBe(true);
      expect(ks.has(max)).toBe(true);
    }
    const walk = trace(withDensity({ kind: 'walk', stepChance: 1 }), 512).map((r) => r.k);
    expect(Math.min(...walk)).toBe(min);
    expect(Math.max(...walk)).toBe(max);
  });

  it.each(KINDS)('%s: the pattern changes only on a bar line', (_name, density) => {
    const rows = trace(withDensity(density), 64);
    let changes = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      if (cur.pattern !== prev.pattern || cur.k !== prev.k) {
        changes++;
        expect(cur.tickInBar, `pattern changed mid-bar at tick ${cur.tick}`).toBe(0);
      }
    }
    expect(changes).toBeGreaterThan(4);
  });

  it('under lfoBars the densest bar is the downbeat of every period', () => {
    const rows = trace(withDensity({ kind: 'lfoBars', bars: 8, shape: 'tri' }), 32);
    const kByBar = new Map<number, number>();
    for (const r of rows) kByBar.set(r.bar, r.k);
    for (const bar of [0, 8, 16, 24]) expect(kByBar.get(bar)).toBe(9);
    for (const bar of [4, 12, 20, 28]) expect(kByBar.get(bar)).toBe(3);
    expect(kByBar.get(2)).toBe(6);
  });

  it('under lfoHz the phase follows transport seconds, so tempo changes it', () => {
    const density: DensityMod = { kind: 'lfoHz', hz: 0.11, shape: 'tri' };
    const fast = trace(withDensity(density), 32, 160).map((r) => r.k);
    const slow = trace(withDensity(density), 32, 80).map((r) => r.k);
    expect(fast).not.toEqual(slow);
    // At 80 bpm a bar is 3 s; the phase at bar b is 0.33 b, and the LFO's k follows it.
    const slowRows = trace(withDensity(density), 4, 80);
    for (const bar of [0, 1, 2, 3]) {
      const row = slowRows.find((r) => r.bar === bar)!;
      const expected = 3 + Math.round(lfoValue('tri', bar * 3 * 0.11) * 6);
      expect(row.k).toBe(expected);
    }
  });

  it('walk moves at most one pulse per bar and never when stepChance is 0', () => {
    const rows = trace(withDensity({ kind: 'walk', stepChance: 1 }), 64);
    const ks = [...new Map(rows.map((r) => [r.bar, r.k])).values()];
    for (let i = 1; i < ks.length; i++)
      expect(Math.abs(ks[i]! - ks[i - 1]!)).toBeLessThanOrEqual(1);
    const still = trace(withDensity({ kind: 'walk', stepChance: 0 }), 16);
    expect(new Set(still.map((r) => r.k))).toEqual(
      new Set([DEFAULT_EUCLIDEAN_CONFIG.pulses.start]),
    );
  });

  it('applies a static rotation and nothing modulates it', () => {
    const rows = trace(withDensity({ kind: 'lfoBars', bars: 4, shape: 'tri' }, { rotate: 3 }), 8);
    for (const r of rows) {
      expect(r.pattern).toBe(patternToString(rotatePattern(euclid(r.k, 16), 3)));
      expect(r.pattern[3]).toBe('x');
    }
  });

  it('is reproducible for a seed and independent of other seeds', () => {
    const a = trace(withDensity({ kind: 'walk', stepChance: 0.7 }, { seed: 42 }), 32);
    const b = trace(withDensity({ kind: 'walk', stepChance: 0.7 }, { seed: 42 }), 32);
    const c = trace(withDensity({ kind: 'walk', stepChance: 0.7 }, { seed: 43 }), 32);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('started mid-bar, plays the constructor figure out to the next bar line', () => {
    const config = withDensity({ kind: 'lfoBars', bars: 8, shape: 'tri' });
    const transport = new TickTransport(120);
    const seq = new EuclideanSequencer(config);
    const initial = patternToString(seq.currentPattern);
    const rows: { tick: number; k: number; pattern: string }[] = [];
    transport.subscribe(config.divisor, (e) => {
      seq.handleTick(e);
      rows.push({ tick: e.tick, k: seq.currentK, pattern: patternToString(seq.currentPattern) });
    });
    transport.reset(48);
    for (let i = 0; i < TICKS_PER_BAR; i++) transport.advance(0);
    expect(seq.currentK).not.toBe(config.pulses.start); // the LFO's k, once the bar line came
    for (const r of rows) {
      if (r.tick < 96) {
        expect(r.k, `tick ${r.tick}`).toBe(config.pulses.start);
        expect(r.pattern).toBe(initial);
      } else {
        expect(r.k).toBe(8); // bar 1 of an 8-bar triangle
      }
    }
  });

  it('rejects a probability or period outside its contract', () => {
    const bad = (density: DensityMod) => () => new EuclideanSequencer(withDensity(density));
    expect(bad({ kind: 'walk', stepChance: 1.2 })).toThrow(RangeError);
    expect(bad({ kind: 'walk', stepChance: -0.1 })).toThrow(RangeError);
    expect(bad({ kind: 'lfoBars', bars: 0, shape: 'tri' })).toThrow(RangeError);
    expect(bad({ kind: 'lfoHz', hz: -1, shape: 'sine' })).toThrow(RangeError);
    expect(bad({ kind: 'walk', stepChance: 0 })).not.toThrow();
    expect(bad({ kind: 'walk', stepChance: 1 })).not.toThrow();
  });

  it('rejects a divisor that does not nest in the bar, and pulses outside the figure', () => {
    expect(() => new EuclideanSequencer({ ...DEFAULT_EUCLIDEAN_CONFIG, divisor: 5 })).toThrow(
      RangeError,
    );
    expect(
      () =>
        new EuclideanSequencer({
          ...DEFAULT_EUCLIDEAN_CONFIG,
          pulses: { min: 0, max: 17, start: 1 },
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new EuclideanSequencer({
          ...DEFAULT_EUCLIDEAN_CONFIG,
          pulses: { min: 5, max: 3, start: 4 },
        }),
    ).toThrow(RangeError);
  });
});
