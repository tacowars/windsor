/**
 * The magnetic Tape core against the research ruler (windsor#219 decision 8):
 * `worklet/tape/tapeMagnetic.ts`'s RK4 core, knee, field guard, state guard
 * and output normalisation.
 *
 * The ruler is `__fixtures__/tapeMagneticReference.json`, written once by
 * `scripts/tape-magnetic-fixtures.mjs` from the research core; this test
 * reads nothing under `docs/research/`. Each case runs the same oversampled
 * (H, dH) stage sequence through this core, with its own guard and knee, and
 * compares the magnetization. The negative controls break the stage timing
 * and the knee's chain derivative on purpose and expect the comparison to
 * fail, so a tolerance that passes anything cannot hide.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TapeMagneticCore,
  condition,
  guardField,
  originSusceptibility,
} from '../worklet/tape/tapeMagnetic';
import { TapeOversampler } from '../worklet/tape/tapeOversample';
import {
  TAPE_DRIVE_GAIN,
  TAPE_MAGNETIC,
  TAPE_MAGNETIC_DEFAULT_CONTROLS,
  driveGain,
  type TapeMagneticControls,
} from './tapeMagneticConstants';

interface Reference {
  rate: number;
  factor: number;
  steps: number;
  stride: number;
  controls: TapeMagneticControls[];
  inputs: { name: string; h: string; dh: string }[];
  trajectories: { controls: number; input: number; m: string }[];
  condition: { h: string; field: string; slope: string };
}

const REFERENCE = JSON.parse(
  readFileSync(new URL('../__fixtures__/tapeMagneticReference.json', import.meta.url), 'utf8'),
) as Reference;

function decode(text: string): Float64Array {
  const bytes = Buffer.from(text, 'base64');
  return new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

const INPUTS = REFERENCE.inputs.map((input) => ({
  name: input.name,
  h: decode(input.h),
  dh: decode(input.dh),
}));

type Mutation = 'none' | 'midpoint-is-start' | 'no-chain-derivative';

/** This core on one fixture case: the magnetization every `stride` steps, raw and de-normalised. */
function run(controls: TapeMagneticControls, input: (typeof INPUTS)[number], mutation: Mutation) {
  const { rate, factor, steps, stride } = REFERENCE;
  const core = new TapeMagneticCore(rate, factor, controls);
  const stages = new Float64Array(6);
  const m = new Float64Array(steps / stride);
  const undone = new Float64Array(steps / stride);
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < 3; j++) {
      const point = mutation === 'midpoint-is-start' && j === 1 ? 2 * i : 2 * i + j;
      stages[2 * j] = input.h[point]!;
      stages[2 * j + 1] = input.dh[point]!;
      guardField(stages, 2 * j);
      condition(stages, 2 * j);
      if (mutation === 'no-chain-derivative') stages[2 * j + 1] = input.dh[point]!;
    }
    core.tick(stages, 0);
    if ((i + 1) % stride === 0) {
      m[(i + 1) / stride - 1] = core.m;
      undone[(i + 1) / stride - 1] = core.out / core.gain;
    }
  }
  return { m, undone, resets: core.resets };
}

/** The worst absolute difference from the research trajectory over every case, and the resets. */
function compare(mutation: Mutation) {
  let worst = 0;
  let worstUndone = 0;
  let resets = 0;
  const perCase: number[] = [];
  for (const trajectory of REFERENCE.trajectories) {
    const expected = decode(trajectory.m);
    const got = run(REFERENCE.controls[trajectory.controls]!, INPUTS[trajectory.input]!, mutation);
    let error = 0;
    for (let n = 0; n < expected.length; n++) {
      error = Math.max(error, Math.abs(got.m[n]! - expected[n]!));
      worstUndone = Math.max(worstUndone, Math.abs(got.undone[n]! - expected[n]!));
    }
    perCase.push(Number.isNaN(error) ? Infinity : error);
    worst = Math.max(worst, perCase.at(-1)!);
    resets += got.resets;
  }
  return { worst, worstUndone, resets, perCase };
}

describe('the magnetic core against the research ruler', () => {
  it('covers the centre, the eight corners, three tones and the signed pulse', () => {
    expect(REFERENCE.controls).toHaveLength(9);
    expect(INPUTS.map((input) => input.name)).toEqual([
      'tone-17',
      'tone-173',
      'tone-1361',
      'pulse-4',
    ]);
    expect(REFERENCE.trajectories).toHaveLength(36);
    expect(INPUTS[3]!.h.reduce((a, b) => Math.max(a, Math.abs(b)), 0)).toBe(4);
  });

  it('matches every research trajectory within 1e-9, with zero resets', () => {
    const result = compare('none');
    expect(result.worst).toBeLessThan(1e-9);
    expect(result.worstUndone, 'after the output normalisation is undone').toBeLessThan(1e-9);
    expect(result.resets).toBe(0);
  });

  it('fails when the midpoint stages read the step start instead', () => {
    const result = compare('midpoint-is-start');
    expect(Math.min(...result.perCase)).toBeGreaterThan(1e-9);
  });

  it("fails when the knee's chain derivative is dropped", () => {
    const result = compare('no-chain-derivative');
    // Only the ±4 pulse passes the knee; the unit tones stay in its identity region.
    const pulses = REFERENCE.trajectories.map((t, i) => (t.input === 3 ? result.perCase[i]! : 0));
    expect(Math.min(...pulses.filter((e) => e !== 0))).toBeGreaterThan(1e-9);
  });
});

describe('the knee', () => {
  const grid = decode(REFERENCE.condition.h);
  const fields = decode(REFERENCE.condition.field);
  const slopes = decode(REFERENCE.condition.slope);

  function worst(table = TAPE_MAGNETIC): number {
    const stages = new Float64Array(2);
    let error = 0;
    for (let i = 0; i < grid.length; i++) {
      stages[0] = grid[i]!;
      stages[1] = 1;
      condition(stages, 0, table);
      error = Math.max(error, Math.abs(stages[0] - fields[i]!), Math.abs(stages[1] - slopes[i]!));
    }
    return error;
  }

  it('equals the research knee and its derivative on [-8, 8] within 1e-15', () => {
    expect(grid[0]).toBe(-8);
    expect(grid.at(-1)).toBe(8);
    expect(worst()).toBeLessThanOrEqual(1e-15);
  });

  it('is the identity to |h| = 1, odd, and approaches the asymptote', () => {
    const stages = new Float64Array(2);
    for (const h of [-1, -0.5, -1e-12, 0, 1e-12, 0.75, 1]) {
      stages[0] = h;
      stages[1] = 3;
      condition(stages, 0);
      expect([stages[0], stages[1]]).toEqual([h, 3]);
    }
    const at = (h: number) => {
      stages[0] = h;
      stages[1] = 1;
      condition(stages, 0);
      return [stages[0], stages[1]];
    };
    expect(at(-2.5)).toEqual(at(2.5).map((v, i) => (i === 0 ? -v : v)));
    expect(at(4)[0]).toBe(2.5);
    expect(at(1e9)[0]).toBeLessThan(4);
    expect(at(1e9)[0]).toBeGreaterThan(3.99);
  });

  it('fails the comparison when the asymptote is moved by a millionth', () => {
    expect(worst({ ...TAPE_MAGNETIC, asymptote: 4.000001 })).toBeGreaterThan(1e-15);
  });
});

describe('the field guard', () => {
  it('clips ±4.5 to ±4 with a zero derivative and counts, and passes ±4 untouched', () => {
    const stages = new Float64Array([4.5, 7, -4.5, -7, 4, 7, -4, -7, NaN, NaN]);
    const engaged = [0, 2, 4, 6, 8].map((at) => guardField(stages, at));
    expect(engaged).toEqual([1, 1, 0, 0, 1]);
    expect([...stages]).toEqual([4, 0, -4, 0, 4, 7, -4, -7, 0, 0]);
  });

  it('engages on an over-level input, keeps the core finite, and never within ±4', () => {
    for (const factor of TAPE_MAGNETIC.factors) {
      const over = new TapeOversampler(48000, factor);
      const under = new TapeOversampler(48000, factor);
      let peak = 0;
      for (let n = 0; n < 4800; n++) {
        const s = Math.sin((2 * Math.PI * 440 * n) / 48000);
        expect(Number.isFinite(over.process(4.5 * s))).toBe(true);
        under.process(3.9 * s);
        for (let q = 2; q < over.stages.length; q += 2)
          peak = Math.max(peak, Math.abs(over.stages[q]!));
      }
      expect(over.guards).toBeGreaterThan(0);
      expect(peak, 'the knee of a field within ±4 is within ±2.5').toBeLessThanOrEqual(2.5);
      expect(over.core.resets).toBe(0);
      expect(under.guards).toBe(0);
    }
  });
});

describe('the state guard', () => {
  it('resets once past magnitude 20, counts once, and stays finite', () => {
    const core = new TapeMagneticCore(48000, 4);
    core.tick(new Float64Array([0, 0, 0.5, 1e12, 1, 1e12]), 0);
    expect(core.resets).toBe(1);
    expect([core.m, core.out]).toEqual([0, 0]);
    const steady = new Float64Array([1, 0, 1, 0, 1, 0]);
    for (let i = 0; i < 100; i++) core.tick(steady, 0);
    expect(core.resets).toBe(1);
    expect(Number.isFinite(core.out)).toBe(true);
  });
});

describe('the output normalisation', () => {
  it('passes a -60 dBFS tone at the centre row with unity gain within 0.01 dB', () => {
    const rate = 48000;
    const period = 48;
    const window = 100 * period;
    const amplitude = 1e-3;
    for (const factor of TAPE_MAGNETIC.factors) {
      const oversampler = new TapeOversampler(rate, factor);
      let re = 0;
      let im = 0;
      const settle = 20 * period;
      for (let n = 0; n < settle + window; n++) {
        const y = oversampler.process(amplitude * Math.sin((2 * Math.PI * n) / period));
        if (n < settle) continue;
        re += y * Math.cos((2 * Math.PI * n) / period);
        im += y * Math.sin((2 * Math.PI * n) / period);
      }
      const gain = (2 * Math.hypot(re, im)) / window / amplitude;
      expect(Math.abs(20 * Math.log10(gain)), `${factor}x`).toBeLessThan(0.01);
    }
  });

  it('divides by the origin susceptibility, floored at the width endpoint', () => {
    const centre = new TapeMagneticCore(48000, 2);
    expect(centre.susceptibility).toBe(originSusceptibility(TAPE_MAGNETIC_DEFAULT_CONTROLS));
    expect(centre.susceptibility).toBeGreaterThan(TAPE_MAGNETIC.susceptibilityFloor);
    expect(centre.gain).toBe(1 / centre.susceptibility);
    const endpoint = new TapeMagneticCore(48000, 2, { drive: 0.5, width: 1, saturation: 0.5 });
    expect(endpoint.susceptibility).toBe(0);
    expect(endpoint.gain).toBe(1 / TAPE_MAGNETIC.susceptibilityFloor);
  });

  it('refuses controls outside [0, 1] and a factor it does not build', () => {
    const core = new TapeMagneticCore(48000, 2);
    expect(() => core.configure(48000, 2, { drive: 1.01, width: 0, saturation: 0 })).toThrow();
    expect(() => core.configure(48000, 2, { drive: 0, width: NaN, saturation: 0 })).toThrow();
    expect(() => core.configure(48000, 8, TAPE_MAGNETIC_DEFAULT_CONTROLS)).toThrow();
  });
});

describe('the Drive gain and the default row', () => {
  it('is unity at 0, x4 at the maximum, 1/4 at the minimum, monotone, linear in dB and clamped', () => {
    const [low, high] = TAPE_DRIVE_GAIN.bounds;
    expect([driveGain(0), driveGain(high), driveGain(low)]).toEqual([1, 4, 0.25]);
    expect([driveGain(high + 1e-9), driveGain(high + 100)]).toEqual([4, 4]);
    expect([driveGain(low - 1e-9), driveGain(low - 100)]).toEqual([0.25, 0.25]);
    let previous = 0;
    for (let drive = low; drive <= high; drive += 0.25) {
      expect(driveGain(drive)).toBeGreaterThan(previous);
      previous = driveGain(drive);
    }
    const db = (drive: number) => 20 * Math.log10(driveGain(drive));
    expect(db(high / 2)).toBeCloseTo(db(high) / 2, 12);
    expect(db(low / 4)).toBeCloseTo(db(low) / 4, 12);
  });

  it('starts every model at the research centre', () => {
    expect(TAPE_MAGNETIC_DEFAULT_CONTROLS).toEqual({ drive: 0.5, width: 0.5, saturation: 0.5 });
  });
});
