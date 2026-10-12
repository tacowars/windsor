/**
 * The plate's output taps (windsor#766, `worklet/reverb/reverbTapTables.ts`):
 * each output leads with its own input's half of the tank, and every tap
 * reads inside its own line, behind the write head, at every Size, at every
 * rate, and on every sample of a Size move. The early density, the width, the
 * mono sum, the level and the CPU are measured in
 * `docs/research/2026-10-12-plate-output-taps/`.
 */
import { describe, expect, it } from 'vitest';

import type { ReverbInternals } from '../__fixtures__/reverbHarness';
import { internals, loadReverb, renderReverb } from '../__fixtures__/reverbHarness';

const BLOCK = 128;

/**
 * The linear read's reach: a tap `d` samples back reads the samples at
 * `floor(write − d)` and one after it, so it needs one sample behind the
 * head, and stays within its line with the margin `_applySize` keeps.
 */
const BEHIND_HEAD = 1;
const LINE_MARGIN = 2;

/** The block a one-block jump lands on: half a second in, once the plate has settled. */
const jumpAt = (rate: number): number => Math.round((0.5 * rate) / BLOCK);

describe('each output leads with its own input', () => {
  it("puts the larger share of each side's tap weight on the half its own input feeds", () => {
    // L's chain feeds the right loop (lines 8 to 11), R's the left (4 to 7).
    const { tapLine, tapGain, tapsPerSide } = loadReverb().topology;
    const fed = [(line: number) => line >= 8, (line: number) => line < 8];
    for (const side of [0, 1]) {
      let own = 0;
      let other = 0;
      for (let t = side * tapsPerSide; t < (side + 1) * tapsPerSide; t++) {
        if (fed[side]!(tapLine[t]!)) own += Math.abs(tapGain[t]!);
        else other += Math.abs(tapGain[t]!);
      }
      expect(own, `side ${side}`).toBeGreaterThan(other);
    }
  });
});

describe('every tap reads inside its line', () => {
  /**
   * Replays each block's taps and lengths a sample at a time, as the tank's
   * loop steps them (Float32 adds, only while the block steps), from the
   * values `_applySize` leaves at the block's start, and keeps the tightest
   * margin either side.
   */
  function watch(plate: ReverbInternals, tapLine: number[]) {
    const margins = { behind: Infinity, inside: Infinity };
    const apply = plate._applySize;
    plate._applySize = function (this: ReverbInternals, immediate: boolean) {
      apply.call(this, immediate);
      const tap = Float32Array.from(this._tap);
      const length = Float32Array.from(this._length);
      for (let i = 0; i < BLOCK; i++) {
        for (let t = 0; t < tap.length; t++) {
          margins.behind = Math.min(margins.behind, tap[t]! - BEHIND_HEAD);
          margins.inside = Math.min(margins.inside, length[tapLine[t]!]! - LINE_MARGIN - tap[t]!);
        }
        if (!this._stepping) continue;
        for (let t = 0; t < tap.length; t++) tap[t] = tap[t]! + this._tapStep[t]!;
        for (let l = 0; l < length.length; l++) length[l] = length[l]! + this._lengthStep[l]!;
      }
    };
    return margins;
  }

  /** Each move as Size at a block, at the rate: the jumps last one block, the sweep 1 s each way. */
  const moves: [string, (block: number, rate: number) => number][] = [
    ['0.05 to 4 and back in one block', (block, rate) => (block === jumpAt(rate) ? 4 : 0.05)],
    ['4 to 0.05 and back in one block', (block, rate) => (block === jumpAt(rate) ? 0.05 : 4)],
    [
      '0.05 to 4 and back over 1 s each way',
      (block, rate) => 0.05 + 3.95 * Math.max(0, 1 - Math.abs((block * BLOCK) / rate - 1.5)),
    ],
  ];

  it.each([44100, 48000, 96000])('at %s Hz, through every Size move', (rate) => {
    const loaded = loadReverb(rate);
    const { tapLine } = loaded.topology;
    for (const [name, size] of moves) {
      let margins = { behind: NaN, inside: NaN };
      renderReverb(
        loaded,
        3,
        () => {},
        { size: size(0, rate) },
        {
          create: { sleep: false },
          automate: (block, values) => {
            values.size![0] = size(block, rate);
          },
          afterBlock: (block, processor) => {
            if (block === 0) margins = watch(internals(processor), tapLine);
          },
        },
      );
      expect(margins.behind, `${name}: behind the head`).toBeGreaterThanOrEqual(0);
      expect(margins.inside, `${name}: inside the line`).toBeGreaterThanOrEqual(0);
    }
  });
});
