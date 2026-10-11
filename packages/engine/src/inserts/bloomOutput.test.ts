/**
 * bloom's Spread (`worklet/bloom/bloomOutput.ts`), through the shipped
 * bundle: mono at 0, bands alternating left (even, from F2) and right (odd)
 * at 1, equal power (L² + R²) at every Spread, and a move without a click.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { describe, expect, it } from 'vitest';
import { lineDb, mixed, renderBloom, tone } from '../__fixtures__/bloomHarness';
import type { BloomRender } from '../__fixtures__/bloomHarness';

const RATE = 48000;
const QUANTUM = 128;
const WET = { mix: 1 } as const;
const LEVEL = 0.25;
/** A3 (band 16, even: left) and A#3 (band 17, odd: right). */
const EVEN_HZ = 220;
const ODD_HZ = 233.0819;
/** Power within this across Spread, dB. */
const POWER_DB = 0.05;
/** The far side at Spread 1 stays under this, re the near side. */
const FAR_DB = -100;
const STEP_FACTOR = 1.1;

const seconds = (s: number): number => Math.round(s * RATE);
const db = (data: Float32Array, hz: number): number =>
  lineDb(data, { hz, rate: RATE, from: seconds(0.6), to: seconds(1.6), reference: LEVEL });
const render = (spread: number, ...hz: number[]): BloomRender =>
  renderBloom(
    { ...WET, spread },
    { seconds: 1.6, source: mixed(...hz.map((f) => tone(f, LEVEL / hz.length, RATE))) },
  );
/** L² + R² of `hz`'s E1, in dB. */
const power = (out: BloomRender, hz: number): number =>
  10 * Math.log10(10 ** (db(out.left, hz) / 10) + 10 ** (db(out.right, hz) / 10));

describe('Spread', () => {
  it('0 is mono to the bit', () => {
    const out = render(0, EVEN_HZ, ODD_HZ);
    expect(out.right).toEqual(out.left);
  });

  it('1 puts even bands left and odd bands right, each alone on its side', () => {
    const even = render(1, EVEN_HZ),
      odd = render(1, ODD_HZ);
    expect(db(even.right, EVEN_HZ) - db(even.left, EVEN_HZ)).toBeLessThan(FAR_DB);
    expect(db(odd.left, ODD_HZ) - db(odd.right, ODD_HZ)).toBeLessThan(FAR_DB);
    // Two neighbouring notes: each side carries its own band's note above the other's.
    const both = render(1, EVEN_HZ, ODD_HZ);
    expect(db(both.left, EVEN_HZ)).toBeGreaterThan(db(both.right, EVEN_HZ) + 10);
    expect(db(both.right, ODD_HZ)).toBeGreaterThan(db(both.left, ODD_HZ) + 10);
  });

  it.each([EVEN_HZ, ODD_HZ])('keeps L² + R² of %f Hz the same at every Spread', (hz) => {
    const mono = power(render(0, hz), hz);
    for (const spread of [0.3, 0.7, 1]) {
      const out = render(spread, hz);
      expect(Math.abs(power(out, hz) - mono)).toBeLessThan(POWER_DB);
    }
  });

  it('at 1, a band is +3 dB on its side and its mono fold-down (L + R) is −3 dB', () => {
    const mono = render(0, EVEN_HZ),
      wide = render(1, EVEN_HZ);
    expect(db(wide.left, EVEN_HZ) - db(mono.left, EVEN_HZ)).toBeCloseTo(3.01, 1);
    const sum = (o: BloomRender): Float32Array => o.left.map((v, i) => v + o.right[i]!);
    expect(db(sum(wide), EVEN_HZ) - db(sum(mono), EVEN_HZ)).toBeCloseTo(-3.01, 1);
  });

  it('moves 0 → 1 without a click', () => {
    const change = seconds(1);
    const out = renderBloom(WET, {
      seconds: 1.4,
      source: tone(EVEN_HZ, LEVEL, RATE),
      onBlock: (frame, params) => {
        if (frame === Math.round(change / QUANTUM) * QUANTUM) params.spread![0] = 1;
      },
    });
    const step = (y: Float32Array, from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s = Math.max(s, Math.abs(y[i]! - y[i - 1]!));
      return s;
    };
    const end = out.left.length;
    // The left side rises by √2 as it glides, so compare against where it settles.
    const settled = step(out.left, end - seconds(0.1), end);
    expect(step(out.left, change, end)).toBeLessThan(settled * STEP_FACTOR);
    expect(step(out.right, change, end)).toBeLessThan(
      step(out.right, seconds(0.6), change) * STEP_FACTOR,
    );
  });
});
