/**
 * The live model switch (design decision 6 of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`, windsor#289
 * decision 2): now that every model has its own magnetic row, switching
 * models under a steady full-scale tone glides the core's three controls with
 * the 10 ms time constant and keeps the magnetization. The glide passes
 * through control points the survival record did not sample, and this test is
 * the evidence for them.
 *
 * Per rate (44.1, 48 and 96 kHz), one shipped DSP (`__fixtures__/tapeDspProbe.ts`,
 * the whole path as heard: Bias and model EQ, Drive 0, the core, the DC block,
 * Mix 1) plays a full-scale 300 Hz sine, a whole number of samples per cycle
 * at every rate, at 2× and then at 4×. At each factor it first reads every
 * model's steady peak after 100 ms on it, then walks an Eulerian circuit of
 * the seven models, so each of the 42 ordered pairs is one switch, held 60 ms
 * (six time constants) before the next. Across every switch: no state reset
 * on any core, no sample above the larger steady peak of the pair, and no
 * cycle whose peak falls below the smaller, each within `GLIDE_TOLERANCE`.
 * One DSP per rate rather than per factor: in one process, the sixth bundle
 * instance ran this loop about five times slower than the first five.
 *
 * The tolerance is the glide's block steps. The stage reconfigures the core
 * once per 128-sample block (decision 6), so each block steps Ms, a, c and the
 * output normalisation with the magnetization kept, and a step near a crest
 * overshoots for a sample or two; the overshoot recurs where the block and
 * the tone's cycles realign, and decays with the glide. Measured on Node 24
 * (arm64), the worst sample of this walk reached 1.064 of the larger steady
 * peak at 44.1 kHz, 1.075 at 48 kHz and 1.037 at 96 kHz, where a block is half
 * as long (Ferric to Metal each time), and the lowest cycle peak was 0.983 of
 * the smaller (30ips Studio to Vintage, 96 kHz). Other alignments of the same
 * switches, tried while writing this, reached 1.093 (48 kHz, 4×, EQ
 * bypassed). There, with the controls smoothed every sample instead, the
 * worst was 1.005, and no point along any pair's straight line (sampled at
 * twentieths, the core alone) had a steady peak above the larger end's.
 * Runs in about 8 s.
 */
import { describe, expect, it } from 'vitest';
import { tapeRig, type TapeRig } from '../__fixtures__/tapeDspProbe';
import { TAPE_OVERSAMPLING, TAPE_TYPES } from './tapeConstants';
import { sine } from './tapePortableMath';

const RATES = [44100, 48000, 96000] as const;
const HZ = 300;
const QUANTUM = 128;
const STEADY_SECONDS = 0.1;
const HOLD_SECONDS = 0.06;
/** The glide's block-step overshoot allowance, either side of the envelope (see above). */
const GLIDE_TOLERANCE = 0.1;

/** A closed walk through every ordered pair of `count` nodes once (Hierholzer), from node 0. */
function circuit(count: number): number[] {
  const unused = Array.from({ length: count }, (_, a) =>
    Array.from({ length: count }, (_, b) => b).filter((b) => b !== a),
  );
  const stack = [0];
  const walk: number[] = [];
  while (stack.length > 0) {
    const next = unused[stack[stack.length - 1]!]!.pop();
    if (next === undefined) walk.push(stack.pop()!);
    else stack.push(next);
  }
  return walk.reverse();
}

/** `frames` samples of the tone from sample `start`, both channels, each left output to `each`. */
function play(
  rig: TapeRig,
  rate: number,
  start: number,
  frames: number,
  each: (y: number) => void,
) {
  const { dsp, params } = rig;
  for (let n = start; n < start + frames; n++) {
    if (n % QUANTUM === 0) dsp.configure(params, QUANTUM);
    const x = sine((2 * Math.PI * HZ * n) / rate);
    dsp.tick(x, x);
    each(dsp.left);
  }
}

const resets = (rig: TapeRig): number =>
  rig.dsp.magnetic.oversamplers.reduce((sum, pair) => sum + pair.core.resets, 0);

describe('switching tape models live (decision 6)', () => {
  const walk = circuit(TAPE_TYPES.length);

  it('walks every ordered pair of models exactly once', () => {
    const pairs = walk.slice(1).map((b, s) => `${walk[s]}>${b}`);
    expect(pairs).toHaveLength(TAPE_TYPES.length * (TAPE_TYPES.length - 1));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.every((pair) => pair[0] !== pair[2])).toBe(true);
  });

  /** Each model's steady peak, from `STEADY_SECONDS` on it in turn, ending on the walk's first model. */
  function steadyPeaks(rig: TapeRig, rate: number, at: { n: number }): number[] {
    const period = rate / HZ;
    const frames = Math.round((rate * STEADY_SECONDS) / period) * period;
    const steady: number[] = [];
    for (const model of TAPE_TYPES.map((_, i) => (i + 1) % TAPE_TYPES.length)) {
      rig.params.model![0] = model;
      play(rig, rate, at.n, frames, () => {});
      at.n += frames;
      let peak = 0;
      play(rig, rate, at.n, 4 * period, (y) => (peak = Math.max(peak, Math.abs(y))));
      at.n += 4 * period;
      steady[model] = peak;
    }
    return steady;
  }

  /** The walk from its first model: each switch held `HOLD_SECONDS`, checked against the pair's steady peaks. */
  function walkModels(rig: TapeRig, rate: number, at: { n: number }, steady: number[]): void {
    const period = rate / HZ;
    const hold = Math.round((rate * HOLD_SECONDS) / period) * period;
    for (let s = 1; s < walk.length; s++) {
      const from = steady[walk[s - 1]!]!,
        to = steady[walk[s]!]!;
      rig.params.model![0] = walk[s]!;
      let worst = 0,
        cyclePeak = 0,
        lowest = Infinity,
        i = 0;
      play(rig, rate, at.n, hold, (y) => {
        worst = Math.max(worst, Math.abs(y));
        cyclePeak = Math.max(cyclePeak, Math.abs(y));
        if (++i % period === 0) {
          lowest = Math.min(lowest, cyclePeak);
          cyclePeak = 0;
        }
      });
      at.n += hold;
      const pair = `${rate} Hz ${rig.dsp.magnetic.factor}×, ${TAPE_TYPES[walk[s - 1]!]} to ${TAPE_TYPES[walk[s]!]}`;
      expect(worst, pair).toBeLessThanOrEqual(Math.max(from, to) * (1 + GLIDE_TOLERANCE));
      expect(lowest, pair).toBeGreaterThanOrEqual(Math.min(from, to) * (1 - GLIDE_TOLERANCE));
    }
  }

  // One DSP per rate, 2× then 4×: the factor switch starts the 4× pair from rest, and the
  // steady peaks are read again at the new factor before its walk.
  it.each(RATES)(
    'at %i Hz, 2× then 4×: no reset, and every sample inside the two steady states',
    (rate) => {
      expect(walk[0]).toBe(0);
      const rig = tapeRig({ model: TAPE_TYPES[1], oversampling: TAPE_OVERSAMPLING[0] }, rate);
      const at = { n: 0 };
      for (const oversampling of TAPE_OVERSAMPLING) {
        rig.params.oversampling![0] = oversampling;
        walkModels(rig, rate, at, steadyPeaks(rig, rate, at));
        expect(rig.dsp.magnetic.factor).toBe(oversampling);
      }
      expect(resets(rig)).toBe(0);
    },
    60_000,
  );
});
