/**
 * The Acid Ladder at large signals (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode` decision 9): the shipped 2× Newton
 * count against a converged solve on the research matrix's worst cells, at
 * 44.1 and 48 kHz;
 * finite and bounded output at Drive's ceiling and under a cutoff sweep;
 * where the loop decays and grows against the analog threshold, and a
 * tail at the Reso ceiling of 17.2 (windsor#593) decaying at every cutoff
 * at both rates; the
 * feedback high-pass thinning the peak at low cutoffs; odd harmonics with
 * level; a resonant tail that ends, and a reset that clears it, the output
 * mix's high-pass included (windsor#577). The small-signal response and the
 * tuning are `ladder.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { thresholdK } from '../../__fixtures__/ladderAnalog';
import {
  LADDER_CUTOFF_MAX_HZ,
  LADDER_FEEDBACK_HP_HZ,
  LADDER_FEEDBACK_MAX,
  LADDER_INPUT_SCALE,
  LADDER_NEWTON_STEPS,
  LADDER_OVERSAMPLE,
} from './fmConstants';
import { Ladder } from './ladder';
import { tuneLadder } from './voiceLadder';

const RATE = 48000;
/** The two rates the convergence and the tail are read at. */
const RATES = [44100, 48000];
const TOP = LADDER_CUTOFF_MAX_HZ;

/** A ladder at `cutoffHz` tuned at `rate` (48 kHz) with the Reso knob at `resonance` (its bottom, the output mix off, by default), its feedback then set to `k`. */
function tuned(cutoffHz: number, k: number, resonance = 0.5, rate = RATE): Ladder {
  const ladder = new Ladder();
  ladder.cutoffHz = cutoffHz;
  ladder.resonance = resonance;
  tuneLadder(ladder, rate);
  ladder.k = k;
  return ladder;
}

const step = (ladder: Ladder, x: number): number => {
  ladder.point = x;
  ladder.process();
  return ladder.point;
};

/** A 110 Hz saw or square at `rate`, harmonics through 127, at `peak` in the ladder's units, 0.5 s: the research matrix's input. */
function bandLimited(kind: 'saw' | 'square', peak: number, rate: number): Float64Array {
  const out = new Float64Array(rate / 2);
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let h = 1; h <= 127; h += kind === 'square' ? 2 : 1) {
      v += Math.sin((2 * Math.PI * 110 * h * i) / rate) / h;
    }
    out[i] = v;
    max = Math.max(max, Math.abs(v));
  }
  // The ladder's units are the carrier's times LADDER_INPUT_SCALE.
  return out.map((v) => (v * peak) / max / LADDER_INPUT_SCALE);
}

/** A seeded uniform draw in −1..1 (an LCG: the test's own, not the part's). */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

describe('the solver (decision 6)', () => {
  it('holds the shipped Newton count at 2× below −60 dBr of a 24-step solve on the worst cells: the top cutoff, k 17.2, saw and square at peak 8, at 44.1 and 48 kHz', () => {
    for (const [rate, kind] of RATES.flatMap((r) => [
      [r, 'saw'] as const,
      [r, 'square'] as const,
    ])) {
      const input = bandLimited(kind, 8, rate);
      const shipped = tuned(TOP, LADDER_FEEDBACK_MAX, 0.5, rate);
      const converged = tuned(TOP, LADDER_FEEDBACK_MAX, 0.5, rate);
      expect([shipped.oversample, shipped.steps]).toEqual([LADDER_OVERSAMPLE, LADDER_NEWTON_STEPS]);
      converged.steps = 24;
      let peak = 0;
      let error = 0;
      for (let i = 0; i < input.length; i++) {
        const want = step(converged, input[i]!);
        const got = step(shipped, input[i]!);
        if (i < input.length / 2) continue;
        peak = Math.max(peak, Math.abs(want));
        error = Math.max(error, Math.abs(got - want));
      }
      expect(20 * Math.log10(error / peak), `${kind} at ${rate} Hz`).toBeLessThan(-60);
    }
  });
});

/** The largest |sample| of `ladder` under `input` (carrier units), retuned to `cutoff(i)` every 32 samples; NaN if any sample is not finite. */
function largest(
  ladder: Ladder,
  n: number,
  input: () => number,
  cutoff?: (i: number) => number,
): number {
  let max = 0;
  for (let i = 0; i < n; i++) {
    if (cutoff && i % 32 === 0) {
      const k = ladder.k;
      ladder.cutoffHz = cutoff(i);
      tuneLadder(ladder, RATE);
      ladder.k = k;
    }
    const y = step(ladder, input());
    if (!Number.isFinite(y)) return NaN;
    max = Math.max(max, Math.abs(y));
  }
  return max;
}

/**
 * The bound the output keeps at any input (carrier units): past |x| ≈ 5
 * the saturator holds a diode pair's current at ±1, so a state stops where
 * its pair saturates, and the solve's x₄ stays under 4 of the ladder's
 * units; the output mix, y + g hp(y), adds at most 2g times that, since its
 * one-pole low-pass never passes its input's largest value. Leaving the
 * ladder divides by LADDER_INPUT_SCALE.
 */
const LADDER_UNITS_BOUND = 4;
const outputBound = (ladder: Ladder): number =>
  (LADDER_UNITS_BOUND * (1 + 2 * ladder.mixGain)) / LADDER_INPUT_SCALE;
/** The Reso knob's top, where k is LADDER_FEEDBACK_MAX and the output mix is at its full gain. */
const RESO_TOP = 12;

describe('the bounds (decision 6)', () => {
  it('keeps a full-scale noise burst at 64× finite and bounded at the top cutoff, k 0 and 17.2 (the mix in), and a 64× square too', () => {
    for (const [k, resonance] of [
      [0, 0.5],
      [LADDER_FEEDBACK_MAX, RESO_TOP],
    ] as const) {
      const draw = noise(0xa204);
      const bound = outputBound(tuned(TOP, k, resonance));
      const burst = largest(tuned(TOP, k, resonance), RATE / 2, () => 64 * draw());
      let i = 0;
      const square = largest(tuned(TOP, k, resonance), RATE / 2, () =>
        i++ % 960 < 480 ? 64 : -64,
      );
      expect(burst, `k ${k}`).toBeLessThan(bound);
      expect(square, `k ${k}`).toBeLessThan(bound);
    }
  });

  it('stays finite and bounded through a cutoff sweep 30 Hz → top → 30 Hz over 50 ms at k 17.2, the mix in', () => {
    const n = RATE / 20;
    const sweep = (i: number): number => 30 * (TOP / 30) ** (1 - Math.abs((2 * i) / n - 1));
    for (const level of [1, 64]) {
      const draw = noise(level);
      const ladder = tuned(30, LADDER_FEEDBACK_MAX, RESO_TOP);
      const max = largest(ladder, n, () => level * draw(), sweep);
      expect(max, `${level}×`).toBeLessThan(outputBound(ladder));
    }
  });
});

/** An impulse of 1e-6 through `ladder` at `rate`: the peak |y| in two windows, 2–5 ms and 180–200 ms. */
function ring(ladder: Ladder, rate = RATE): [number, number] {
  let early = 0;
  let late = 0;
  for (let i = 0; i < rate / 5; i++) {
    const y = Math.abs(step(ladder, i === 0 ? 1e-6 : 0));
    if (i >= rate / 500 && i < rate / 200) early = Math.max(early, y);
    if (i >= (9 * rate) / 50) late = Math.max(late, y);
  }
  return [early, late];
}

describe('resonance (decision 4)', () => {
  it("decays just under the one-pole model's threshold at 5 kHz and grows at 1.1× it, the loop at the 2× step rate", () => {
    const k = thresholdK(5000, LADDER_OVERSAMPLE * RATE, LADDER_FEEDBACK_HP_HZ);
    expect(k).toBeGreaterThan(17);
    expect(k).toBeLessThan(18.5);
    const [early, late] = ring(tuned(5000, 0.99 * k));
    expect(late).toBeLessThan(early);
    // Past it the ring grows until the diodes hold it, at a level of its own.
    const [rising, risen] = ring(tuned(5000, 1.1 * k));
    expect(risen).toBeGreaterThan(1000 * rising);
  });

  it('decays at k 17.2 at every cutoff from 100 Hz to the top, at 44.1 and 48 kHz', () => {
    expect(LADDER_FEEDBACK_MAX).toBe(17.2);
    for (const rate of RATES) {
      for (const cutoff of [100, 500, 2000, 5000, 8000, TOP]) {
        const [early, late] = ring(tuned(cutoff, LADDER_FEEDBACK_MAX, 0.5, rate), rate);
        expect(late, `${cutoff} Hz at ${rate} Hz`).toBeLessThan(early);
      }
    }
  });

  it('peaks at least 4 dB lower at a 500 Hz cutoff than at 5 kHz with k 16, the high-pass thinning it', () => {
    const peakDb = (cutoff: number): number => {
      let best = -Infinity;
      for (let r = 0.6; r <= 1.6; r += 0.01) {
        const hz = cutoff * r;
        const ladder = tuned(cutoff, 16);
        let re = 0;
        let im = 0;
        const n = RATE / 4;
        for (let i = 0; i < RATE / 5 + n; i++) {
          const phase = (2 * Math.PI * hz * i) / RATE;
          const y = step(ladder, 1e-4 * Math.sin(phase));
          if (i < RATE / 5) continue;
          re += y * Math.sin(phase);
          im += y * Math.cos(phase);
        }
        best = Math.max(best, 20 * Math.log10((2 * Math.hypot(re, im)) / n / 1e-4));
      }
      return best;
    };
    expect(peakDb(5000) - peakDb(500)).toBeGreaterThan(4);
  });
});

describe('the saturation (decisions 3 and 7)', () => {
  it('gives a 110 Hz sine at ladder amplitude 2 through 1 kHz, k 12, an H3 of −60..−50 dB and no H2', () => {
    const ladder = tuned(1000, 12);
    const n = RATE;
    const bins = [0, 0, 0, 0].map(() => [0, 0]);
    for (let i = 0; i < RATE / 4 + n; i++) {
      const y = step(ladder, (2 / LADDER_INPUT_SCALE) * Math.sin((2 * Math.PI * 110 * i) / RATE));
      if (i < RATE / 4) continue;
      for (let h = 1; h <= 3; h++) {
        const phase = (2 * Math.PI * 110 * h * i) / RATE;
        bins[h]![0]! += y * Math.cos(phase);
        bins[h]![1]! += y * Math.sin(phase);
      }
    }
    const level = (h: number): number => Math.hypot(bins[h]![0]!, bins[h]![1]!);
    const h3 = 20 * Math.log10(level(3) / level(1));
    expect(h3).toBeGreaterThan(-60);
    expect(h3).toBeLessThan(-50);
    expect(20 * Math.log10(level(2) / level(1))).toBeLessThan(-100);
  });
});

describe('the end of a ring (decision 8)', () => {
  it('goes quiet after a resonant tail at k 17.2 and 200 Hz, the mix in, and not before', () => {
    const ladder = tuned(200, LADDER_FEEDBACK_MAX, RESO_TOP);
    const draw = noise(7);
    for (let i = 0; i < RATE / 10; i++) step(ladder, draw());
    expect(Ladder.quiet(ladder)).toBe(false);
    let samples = 0;
    while (!Ladder.quiet(ladder) && samples < 4 * RATE) {
      step(ladder, 0);
      samples++;
    }
    expect(samples).toBeGreaterThan(RATE / 100);
    expect(samples).toBeLessThan(4 * RATE);
  });

  it('clears every state on reset, the two high-passes and the oversampler included', () => {
    const ladder = tuned(800, LADDER_FEEDBACK_MAX, RESO_TOP);
    const draw = noise(9);
    for (let i = 0; i < 2000; i++) step(ladder, draw());
    expect(ladder.hpS).not.toBe(0);
    expect(ladder.mixS).not.toBe(0);
    ladder.reset();
    const states = [
      ladder.s1,
      ladder.s2,
      ladder.s3,
      ladder.s4,
      ladder.hpS,
      ladder.mixS,
      ladder.y,
      ladder.lastIn,
    ];
    expect(states).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...ladder.history]).toEqual([0, 0, 0]);
    expect(Ladder.quiet(ladder)).toBe(true);
    expect(Math.abs(step(ladder, 0))).toBe(0);
  });
});
