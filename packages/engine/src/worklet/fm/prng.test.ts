import { mulberry32 } from '../../sequencing/mulberry32';
import { describe, expect, it } from 'vitest';

import { makeRandom, randomSeed32 } from './prng';

describe('the worklet PRNG', () => {
  it('is mulberry32, line for line with the main-thread copy', () => {
    const ours = makeRandom(0xa204);
    const theirs = mulberry32(0xa204);
    for (let i = 0; i < 1000; i++) expect(ours()).toBe(theirs());
  });

  it('repeats a seed, and hands back Math.random without one', () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    expect(Array.from({ length: 8 }, () => a())).toEqual(Array.from({ length: 8 }, () => b()));
    expect(makeRandom(null)).toBe(Math.random);
    expect(makeRandom(undefined)).toBe(Math.random);
  });

  it('never hands out the xorshift fixed point', () => {
    expect(randomSeed32(() => 0)).toBe(1);
    expect(randomSeed32(() => 0.5)).toBe(0x7fffffff);
    expect(randomSeed32(() => 1 - 2 ** -32)).toBe(0xfffffffe);
  });
});
