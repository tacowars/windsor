/**
 * The plate's output taps (windsor#766, `worklet/reverb/reverbTapTables.ts`):
 * Build's direct path keeps `main`'s gain under the new trim, each output
 * leads with its own input's half of the tank, and every tap
 * reads inside its own line, behind the write head, at every Size, at every
 * rate, and on every sample of a Size move. The early density, the width, the
 * mono sum, the level and the CPU are measured in
 * `docs/research/2026-10-12-plate-output-taps/`.
 */
import { describe, expect, it } from 'vitest';

import type { ReverbInternals } from '../__fixtures__/reverbHarness';
import { impulseAt, internals, loadReverb, renderReverb } from '../__fixtures__/reverbHarness';

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

describe("Build's direct path", () => {
  /**
   * `main`'s direct gain at Build 0: its output trim, 0.6, times the Build 0
   * direct row, 0.6, at the default wet of 1.
   */
  const MAIN_DIRECT = 0.6 * 0.6;

  /** The plate's Build state, and its Build line's write head after the block. */
  type BuildRead = ReverbInternals & { _buildWrite: number };

  /**
   * Each side's Build sum for the first `count` samples of the block just
   * rendered, read back from its line as the tank's loop reads it. Build 0 is
   * settled, so no tap's time or gain moves across the block.
   */
  function buildSums(plate: BuildRead, count: number) {
    const lines = [plate._buildLine, plate._buildLineRight];
    const mask = plate._buildLine.length - 1;
    const half = plate._buildTime.length / 2;
    const sums: [number[], number[]] = [[], []];
    for (let i = 0; i < count; i++) {
      const write = (plate._buildWrite - BLOCK + i) & mask;
      for (const side of [0, 1] as const) {
        let sum = 0;
        for (let t = side * half; t < (side + 1) * half; t++) {
          const position = write - plate._buildTime[t]!;
          const whole = Math.floor(position);
          const a = lines[side]![whole & mask]!;
          const b = lines[side]![(whole + 1) & mask]!;
          sum += (a + (b - a) * (position - whole)) * plate._buildGain[t]!;
        }
        sums[side].push(sum);
      }
    }
    return sums;
  }

  it("keeps main's gain ahead of the first output tap, at Build 0 in the default space", () => {
    const loaded = loadReverb();
    const click = jumpAt(loaded.sampleRate);
    // Pre-delay 0 and Size 1 by default: no tap reads the tank before its shortest time.
    const window = Math.floor(Math.min(...loaded.topology.tapTime) * loaded.sampleRate);
    let sums: [number[], number[]] = [[], []];
    const { samples } = renderReverb(
      loaded,
      0.6,
      impulseAt(click),
      { build: 0 },
      {
        collectSamples: true,
        create: { sleep: false },
        afterBlock: (block, processor) => {
          if (block === click) sums = buildSums(internals(processor) as BuildRead, window);
        },
      },
    );
    for (const side of [0, 1] as const) {
      let peak = 0;
      let error = 0;
      for (let i = 0; i < window; i++) {
        const expected = MAIN_DIRECT * sums[side][i]!;
        peak = Math.max(peak, Math.abs(expected));
        error = Math.max(error, Math.abs(samples[(click * BLOCK + i) * 2 + side]! - expected));
      }
      expect(peak, `side ${side}: the direct burst sounds`).toBeGreaterThan(0.01);
      expect(error / peak, `side ${side}`).toBeLessThan(1e-6);
    }
  });
});

describe('each output leads with its own input', () => {
  it("puts the larger share of each side's tap weight on the half its own input feeds, in each voicing", () => {
    // L's chain feeds the right loop (lines 8 to 11), R's the left (4 to 7).
    const { voicings, tapsPerSide } = loadReverb().topology;
    const fed = [(line: number) => line >= 8, (line: number) => line < 8];
    for (const [voicing, { tapLine, tapGain }] of voicings.entries()) {
      for (const side of [0, 1]) {
        let own = 0;
        let other = 0;
        for (let t = side * tapsPerSide; t < (side + 1) * tapsPerSide; t++) {
          if (fed[side]!(tapLine[t]!)) own += Math.abs(tapGain[t]!);
          else other += Math.abs(tapGain[t]!);
        }
        expect(own, `voicing ${voicing}, side ${side}`).toBeGreaterThan(other);
      }
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
  function watch(plate: ReverbInternals, tapLine: ArrayLike<number>) {
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

  it.each([44100, 48000, 96000])('at %s Hz, through every Size move, in each voicing', (rate) => {
    const loaded = loadReverb(rate);
    for (const [voicing, { tapLine }] of loaded.topology.voicings.entries()) {
      for (const [name, size] of moves) {
        let margins = { behind: NaN, inside: NaN };
        renderReverb(
          loaded,
          3,
          () => {},
          { size: size(0, rate), voicing },
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
        const cell = `voicing ${voicing}, ${name}`;
        expect(margins.behind, `${cell}: behind the head`).toBeGreaterThanOrEqual(0);
        expect(margins.inside, `${cell}: inside the line`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
