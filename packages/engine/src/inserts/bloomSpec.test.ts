/**
 * bloom's song contract: the defaults round-trip untouched, every valid value
 * is kept, and junk is corrected and reported. Windsor's spec tests also
 * round-trip the kind through `makeArrangement`.
 */
import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { BLOOM_BOUNDS } from './bloomConstants';
import { BLOOM_INSERT } from './bloomInsert';
import { DEFAULT_BLOOM } from './bloomSpec';
import type { BloomSpec } from './bloomSpec';

describe('the bloom spec', () => {
  it('keeps the defaults and every valid value without a correction', () => {
    const n = new FieldNormaliser();
    expect(BLOOM_INSERT.normalise({ ...DEFAULT_BLOOM }, 'fx', n)).toEqual(DEFAULT_BLOOM);
    const edited: BloomSpec = {
      ...DEFAULT_BLOOM,
      amount: 0.25,
      mix: 1,
      swell: BLOOM_BOUNDS.swell[1],
      sustain: 12,
      freeze: true,
      spread: 1,
      shape: 2.5,
      bright: BLOOM_BOUNDS.bright[0],
      octave: -12,
      key: 'F#',
      scale: 'pentatonic-minor',
      low: 48,
      high: 72,
      focus: 0.5,
      density: 0,
      enabled: false,
    };
    expect(BLOOM_INSERT.normalise({ ...edited }, 'fx', n)).toEqual(edited);
    expect(BLOOM_INSERT.normalise({}, 'fx', n)).toEqual(DEFAULT_BLOOM);
    expect(n.corrections).toEqual([]);
  });

  it('clamps, rounds, replaces and drops junk, and reports each fix', () => {
    const n = new FieldNormaliser();
    const fixed = BLOOM_INSERT.normalise(
      {
        kind: 'bloom',
        amount: 2,
        mix: NaN,
        swell: -1,
        freeze: 'yes',
        shape: 'saw',
        octave: 5,
        key: 'H',
        scale: 'blues',
        low: 47.4,
        high: 200,
        slot: { kind: 'chorus' },
        shimmer: 0.5,
      },
      'fx',
      n,
    );
    expect(fixed).toEqual({
      ...DEFAULT_BLOOM,
      amount: BLOOM_BOUNDS.amount[1],
      swell: BLOOM_BOUNDS.swell[0],
      octave: 7,
      low: 47,
      high: BLOOM_BOUNDS.high[1],
    });
    expect(n.corrections).toHaveLength(12);
    for (const field of ['shimmer', 'mix', 'freeze', 'shape', 'octave', 'key', 'scale', 'slot'])
      expect(n.corrections.some((c) => c.startsWith(`fx.${field}:`))).toBe(true);
  });
});
