/**
 * bloom's Density (`worklet/bloom/bloomDynamics.ts`), through the shipped
 * bundle: the ratio 1/(1 − Density) as the slope of E1 against the input,
 * Density 0 following the source's dynamics 1:1, Density 1 levelling a
 * −30/−6 dBFS pair, the −12 dBFS pivot staying put, and a move without a
 * click. The default (1 − 1/1.8) is pinned to the bit by `bloomGolden.test.ts`.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { describe, expect, it } from 'vitest';
import { lineDb, renderBloom, tone } from '../__fixtures__/bloomHarness';
import { BLOOM_DEFAULTS } from './bloomConstants';

const RATE = 48000;
const QUANTUM = 128;
const WET = { mix: 1 } as const;
const HZ = 220;
/** Slopes within this, in dB. */
const SLOPE_DB = 0.5;
/** Density 1 levels a 24 dB pair to within this. */
const LEVELLED_DB = 3;
/** The pivot (−12 dBFS) moves by under this across Density. */
const PIVOT_DB = 1;
const STEP_FACTOR = 1.1;

const seconds = (s: number): number => Math.round(s * RATE);
const amplitude = (dbfs: number): number => 10 ** (dbfs / 20);

/** E1 in dBFS of a 220 Hz sine at `dbfs` through bloom at `density`, wet only. */
function e1(density: number, dbfs: number): number {
  const out = renderBloom(
    { ...WET, density },
    { seconds: 1.6, source: tone(HZ, amplitude(dbfs), RATE) },
  );
  return lineDb(out.left, {
    hz: HZ,
    rate: RATE,
    from: seconds(0.6),
    to: seconds(1.6),
    reference: 1,
  });
}

describe('Density', () => {
  it.each([0, 0.25, BLOOM_DEFAULTS.density, 0.75])(
    'at %f gives the ratio 1/(1 − Density): 20 dB in, 20 (1 − Density) dB out',
    (density) => {
      const slope = e1(density, -20) - e1(density, -40);
      expect(Math.abs(slope - 20 * (1 - density))).toBeLessThan(SLOPE_DB);
    },
  );

  it('the default reads as a 1.8:1 ratio', () => {
    expect(1 / (1 - BLOOM_DEFAULTS.density)).toBeCloseTo(1.8, 12);
  });

  it('0 follows the source 1:1 (below the ceiling)', () => {
    expect(Math.abs(e1(0, -24) - e1(0, -44) - 20)).toBeLessThan(SLOPE_DB);
  });

  it('1 levels a −30 and a −6 dBFS note to within a few dB', () => {
    expect(Math.abs(e1(1, -6) - e1(1, -30))).toBeLessThan(LEVELLED_DB);
  });

  it('keeps a −12 dBFS note where the default puts it, at every Density', () => {
    const pivot = e1(BLOOM_DEFAULTS.density, -12);
    for (const density of [0, 0.25, 0.75, 1])
      expect(Math.abs(e1(density, -12) - pivot)).toBeLessThan(PIVOT_DB);
  });

  it('moves 0 → 1 without a click', () => {
    const change = seconds(1);
    const out = renderBloom(
      { ...WET, density: 0 },
      {
        seconds: 1.4,
        source: tone(HZ, amplitude(-30), RATE),
        onBlock: (frame, params) => {
          if (frame === Math.round(change / QUANTUM) * QUANTUM) params.density![0] = 1;
        },
      },
    ).left;
    let steady = 0,
      moving = 0;
    for (let i = seconds(0.6); i < out.length; i++) {
      const step = Math.abs(out[i]! - out[i - 1]!);
      if (i < change) steady = Math.max(steady, step);
      else moving = Math.max(moving, step);
    }
    // Density 1 lifts a −30 dBFS note (by the makeup), so compare against where it settles.
    const settled = (() => {
      let s = 0;
      for (let i = change + seconds(0.25); i < out.length; i++)
        s = Math.max(s, Math.abs(out[i]! - out[i - 1]!));
      return s;
    })();
    expect(moving).toBeLessThan(Math.max(steady, settled) * STEP_FACTOR);
  });
});
