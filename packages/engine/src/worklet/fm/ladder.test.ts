/**
 * The Acid Ladder directly (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode` decision 9): the saturator against
 * `Math.tanh`; the shipped solver's linearised chain against Stinchcombe's
 * polynomial; its small-signal magnitude and phase against the analog
 * 1 / (D(s) + k HP(s)) at the bilinear image, and with the output mix
 * (windsor#577) times 1 + g HP_mix(s) and the makeup; the mix's absence
 * at the Reso knob's bottom, to the bit; the makeup (windsor#587) as a gain
 * alone, (1 + k)^`LADDER_MAKEUP_POWER` times the output before it; the
 * tuning. The large-signal
 * readings (convergence, bounds, threshold, the high-pass, harmonics, the
 * end of a ring) are `ladderLimits.test.ts`; the voice is
 * `synth/fmProcessorFilterLadder.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  characteristicPolynomial,
  inverse,
  ladderResponse,
  mixedLadderResponse,
} from '../../__fixtures__/ladderAnalog';
import type { Response } from '../../__fixtures__/ladderAnalog';
import {
  LADDER_BOTTOM_CAP,
  LADDER_CUTOFF_MAX_HZ,
  LADDER_CUTOFF_MIN_HZ,
  LADDER_FEEDBACK_HP_HZ,
  LADDER_FEEDBACK_MAX,
  LADDER_INPUT_SCALE,
  LADDER_MAKEUP_POWER,
  LADDER_MIX_GAIN,
  LADDER_MIX_HP_HZ,
} from './fmConstants';
import { Ladder } from './ladder';
import { LADDER_SATURATOR } from './ladderTables';
import { tuneLadder } from './voiceLadder';

const RATE = 48000;

/** A ladder at `cutoffHz` and `resonance`, tuned at 48 kHz, its feedback then set to `k` if given. */
function tuned(cutoffHz: number, k?: number, resonance = 0.5): Ladder {
  const ladder = new Ladder();
  ladder.cutoffHz = cutoffHz;
  ladder.resonance = resonance;
  tuneLadder(ladder, RATE);
  if (k !== undefined) ladder.k = k;
  return ladder;
}

const step = (ladder: Ladder, x: number): number => {
  ladder.point = x;
  ladder.process();
  return ladder.point;
};

describe('the diode law (decision 6)', () => {
  it('is the [7/6] rational, within 1e-4 of Math.tanh and its slope within 2e-4, odd, monotone and held at ±1', () => {
    const ladder = new Ladder();
    const at = (x: number): [number, number] => {
      ladder.satIn = x;
      ladder.saturate();
      return [ladder.satOut, ladder.satSlope];
    };
    let previous = -2;
    for (let i = -8000; i <= 8000; i++) {
      const x = i / 1000;
      const [y, slope] = at(x);
      const t = Math.tanh(x);
      expect(Math.abs(y - t), `x ${x}`).toBeLessThan(1e-4);
      expect(Math.abs(slope - (1 - t * t)), `x ${x}`).toBeLessThan(2e-4);
      expect(at(-x)[0]).toBe(-y);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
    expect(at(LADDER_SATURATOR.limit)).toEqual([1, 0]);
    expect(at(-40)).toEqual([-1, 0]);
    // Continuous at the hold: just under the limit the rational is 1 to the last ulps.
    const under = at(LADDER_SATURATOR.limit * (1 - 1e-15))[0];
    expect(under).toBeLessThanOrEqual(1);
    expect(under).toBeGreaterThan(1 - 1e-14);
    expect(at(0)[1]).toBe(1);
  });
});

/**
 * The continuous chain the shipped solver integrates, read back from it: a
 * step with no input from memories s solves x⁺ = s + h A x⁺ exactly in the
 * linear region, so x⁺ = (I − h A)⁻¹ s, and the memories' column j after a
 * unit s_j gives that inverse; A = (I − M⁻¹) / h, in units of τ.
 */
function chainMatrix(): number[][] {
  const ladder = tuned(1000, 0);
  const h = 0.01;
  ladder.h = h;
  const eps = 1e-7;
  const columns: number[][] = [];
  for (let j = 0; j < 4; j++) {
    ladder.reset();
    const before = [0, 0, 0, 0];
    before[j] = eps;
    [ladder.s1, ladder.s2, ladder.s3, ladder.s4] = before;
    step(ladder, 0);
    const after = [ladder.s1, ladder.s2, ladder.s3, ladder.s4];
    columns.push(after.map((s, i) => (s + before[i]!) / 2 / eps));
  }
  const m = [0, 1, 2, 3].map((i) => columns.map((column) => column[i]!));
  const mInverse = inverse(m);
  return mInverse.map((row, i) => row.map((v, j) => ((i === j ? 1 : 0) - v) / h));
}

describe('the circuit (decision 3)', () => {
  it("linearised, is Stinchcombe's TB-303 polynomial with the bottom capacitor half the others", () => {
    expect(LADDER_BOTTOM_CAP).toBe(0.5);
    const a = chainMatrix();
    // Row 1 is c₁ τ ẋ₁ = (x₂ − x₁) − u, with c₁ = ½.
    expect(a[0]![0]).toBeCloseTo(-2, 6);
    expect(a[0]![1]).toBeCloseTo(2, 6);
    const poly = characteristicPolynomial(a);
    [1, 8, 20, 16, 2].forEach((c, i) => expect(poly[i]).toBeCloseTo(c, 5));
    // In units of ω_c = 2^¼ / τ, where the constant term is 1.
    const wc = poly[4]! ** 0.25;
    const normalised = poly.map((c, i) => c / wc ** i);
    [1, 6.727, 14.142, 9.514, 1].forEach((c, i) =>
      expect(Math.abs(normalised[i]! - c), `s^${4 - i}`).toBeLessThan(0.001),
    );
  });
});

/**
 * The ladder's small-signal response at `hz`: a sine of 1e-4 for 0.2 s,
 * then its single-bin DFT over 0.25 s, whole cycles for any multiple of 4 Hz.
 */
function measured(ladder: Ladder, hz: number): Response {
  ladder.reset();
  const amp = 1e-4;
  const warm = RATE / 5;
  const n = RATE / 4;
  let re = 0;
  let im = 0;
  for (let i = 0; i < warm + n; i++) {
    const phase = (2 * Math.PI * hz * i) / RATE;
    const y = step(ladder, amp * Math.sin(phase));
    if (i < warm) continue;
    re += y * Math.sin(phase);
    im += y * Math.cos(phase);
  }
  return {
    db: 20 * Math.log10((2 * Math.hypot(re, im)) / n / amp),
    degrees: (Math.atan2(im, re) * 180) / Math.PI,
  };
}

/** Probe frequencies from `lowHz` (100 Hz) to 2 f_c (or near Nyquist), log-spaced and on the 4 Hz grid, with f_c among them. */
function probes(cutoffHz: number, lowHz = 100): number[] {
  const top = Math.min(2 * cutoffHz, 0.46 * RATE);
  const list = Array.from({ length: 14 }, (_, i) => lowHz * (top / lowHz) ** (i / 13));
  list.push(cutoffHz, 1.15 * cutoffHz);
  return list.map((hz) => 4 * Math.round(hz / 4));
}

const wrap = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180;

describe('the small-signal response (decision 9)', () => {
  it('matches 1 / (D(s) + k HP(s)) at the bilinear image within 0.5 dB and 5°, 100 Hz to 2 f_c, f_c 500 Hz to the top, k 0, 8 and 16', () => {
    let worstDb = 0;
    let worstDegrees = 0;
    for (const cutoff of [500, 2000, 10000, LADDER_CUTOFF_MAX_HZ]) {
      for (const k of [0, 8, 16]) {
        const ladder = tuned(cutoff, k);
        for (const hz of probes(cutoff)) {
          const got = measured(ladder, hz);
          const want = ladderResponse(hz, cutoff, k, RATE, LADDER_FEEDBACK_HP_HZ);
          const label = `f_c ${cutoff}, k ${k}, ${hz} Hz`;
          expect(Math.abs(got.db - want.db), label).toBeLessThan(0.5);
          expect(Math.abs(wrap(got.degrees - want.degrees)), label).toBeLessThan(5);
          worstDb = Math.max(worstDb, Math.abs(got.db - want.db));
          worstDegrees = Math.max(worstDegrees, Math.abs(wrap(got.degrees - want.degrees)));
        }
      }
    }
    // The discretisation is the bilinear image itself: what is left is the DFT's.
    expect(worstDb).toBeLessThan(0.01);
    expect(worstDegrees).toBeLessThan(0.1);
  });

  it("with the output mix and the makeup at the Reso knob's top, matches √17.5 (1 + g HP_mix(s)) / (D(s) + k HP(s)) within 0.5 dB and 5°, 48 Hz to 2 f_c, f_c 300 Hz, 2 kHz and 8 kHz", () => {
    const mix = { gain: LADDER_MIX_GAIN, hpHz: LADDER_MIX_HP_HZ };
    const makeupDb = 20 * Math.log10(Math.sqrt(1 + LADDER_FEEDBACK_MAX));
    let worstDb = 0;
    for (const cutoff of [300, 2000, 8000]) {
      const ladder = tuned(cutoff, undefined, 12);
      expect(ladder.k).toBe(LADDER_FEEDBACK_MAX);
      expect(ladder.mixGain).toBe(LADDER_MIX_GAIN);
      for (const hz of probes(cutoff, 48)) {
        const got = measured(ladder, hz);
        const want = mixedLadderResponse(
          hz,
          { cutoffHz: cutoff, k: LADDER_FEEDBACK_MAX, hpHz: LADDER_FEEDBACK_HP_HZ },
          mix,
          RATE,
        );
        want.db += makeupDb;
        const label = `f_c ${cutoff}, ${hz} Hz`;
        expect(Math.abs(got.db - want.db), label).toBeLessThan(0.5);
        expect(Math.abs(wrap(got.degrees - want.degrees)), label).toBeLessThan(5);
        worstDb = Math.max(worstDb, Math.abs(got.db - want.db));
      }
    }
    // The mix is a TPT one-pole, the bilinear image of its analog high-pass.
    expect(worstDb).toBeLessThan(0.01);
  });

  it('is −21.9 dB at the cutoff itself with no feedback, at every cutoff up to the top', () => {
    for (const cutoff of [200, 1000, 5000, LADDER_CUTOFF_MAX_HZ]) {
      expect(measured(tuned(cutoff, 0), cutoff).db).toBeCloseTo(-21.91, 1);
    }
  });
});

describe("the output mix at the Reso knob's bottom (windsor#577)", () => {
  it("adds nothing: each output is the solve's own x₄, to the bit, while the mix's high-pass runs on", () => {
    const ladder = tuned(700, undefined, 0.5);
    expect(ladder.mixGain).toBe(0);
    expect(ladder.makeup).toBe(1);
    let seed = 0x577;
    for (let i = 0; i < 4800; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const out = step(ladder, (seed / 2 ** 31 - 1) * (i < 2400 ? 1 : 0));
      expect(Object.is(out, -ladder.y * (1 / LADDER_INPUT_SCALE)), `sample ${i}`).toBe(true);
    }
    expect(ladder.mixS).not.toBe(0);
  });

  it('comes in with the Reso knob, its gain LADDER_MIX_GAIN × p', () => {
    for (const resonance of [0.707, 3, 12]) {
      const ladder = tuned(1000, undefined, resonance);
      const p = Math.log2(resonance / 0.5) / Math.log2(24);
      expect(ladder.mixGain).toBeCloseTo(LADDER_MIX_GAIN * p, 12);
    }
  });
});

describe('the makeup (windsor#587)', () => {
  it("is (1 + k)^LADDER_MAKEUP_POWER: 1 at the Reso knob's bottom, √17.5 (+12.4 dB) at its top", () => {
    expect(LADDER_MAKEUP_POWER).toBe(0.5);
    expect(tuned(1000, undefined, 0.5).makeup).toBe(1);
    expect(tuned(1000, undefined, 0.2).makeup).toBe(1);
    const top = tuned(1000, undefined, 12).makeup;
    expect(Math.abs(top / Math.sqrt(17.5) - 1)).toBeLessThan(1e-15);
    expect(20 * Math.log10(top)).toBeCloseTo(12.43, 2);
  });

  it('is a gain alone: at Reso floor, 25, 50, 75 and 100 % each output is the output before it times (1 + k)^0.5, within 1e-12', () => {
    for (const place of [0, 0.25, 0.5, 0.75, 1]) {
      const resonance = 0.5 * 24 ** place;
      const ladder = tuned(500, undefined, resonance);
      const before = tuned(500, undefined, resonance);
      before.makeup = 1;
      expect(ladder.k).toBeCloseTo(LADDER_FEEDBACK_MAX * place, 12);
      const gain = Math.sqrt(1 + ladder.k);
      let seed = 0x587;
      for (let i = 0; i < 4800; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        // A loud saw with noise on it, past the input pair's knee, then the ring after it.
        const x =
          i < 3600
            ? 2 * ((i * 110) / RATE - Math.floor((i * 110) / RATE)) - 1 + (seed / 2 ** 32 - 0.5)
            : 0;
        const got = step(ladder, x);
        const want = step(before, x) * gain;
        const label = `p ${place}, sample ${i}`;
        // At the knob's bottom the makeup is 1, so the output is the one before it to the bit.
        if (place === 0) expect(Object.is(got, want), label).toBe(true);
        expect(Math.abs(got - want), label).toBeLessThanOrEqual(1e-12 * Math.abs(want));
      }
    }
  });
});

describe('the tuning (decisions 4 and 5)', () => {
  it('maps Reso 0.5..12 to k 0..16.5 on its log scale', () => {
    const k = (resonance: number): number => tuned(1000, undefined, resonance).k;
    expect(k(0.5)).toBe(0);
    expect(k(0.2)).toBe(0);
    expect(k(12)).toBe(LADDER_FEEDBACK_MAX);
    expect(k(30)).toBe(LADDER_FEEDBACK_MAX);
    for (const resonance of [0.707, 1, 2, 6, 11.99]) {
      const p = Math.log2(resonance / 0.5) / Math.log2(24);
      expect(k(resonance)).toBeCloseTo(LADDER_FEEDBACK_MAX * p, 12);
    }
    expect(k(0.707)).toBeCloseTo(1.8, 1);
  });

  it('steps by tan(π f_c / f_s) / 2^¼, holding the cutoff to 20 Hz .. the top, and the high-pass by its own tangent', () => {
    const h = (hz: number): number => Math.tan((Math.PI * hz) / RATE) / 2 ** 0.25;
    for (const cutoff of [30, 440, 5000, LADDER_CUTOFF_MAX_HZ]) {
      expect(tuned(cutoff).h).toBeCloseTo(h(cutoff), 14);
    }
    expect(tuned(18000).h).toBe(tuned(LADDER_CUTOFF_MAX_HZ).h);
    expect(tuned(5).h).toBe(tuned(LADDER_CUTOFF_MIN_HZ).h);
    expect(tuned(-1).h).toBe(tuned(LADDER_CUTOFF_MIN_HZ).h);
    const g = Math.tan((Math.PI * LADDER_FEEDBACK_HP_HZ) / RATE);
    expect(tuned(1000).hpG).toBeCloseTo(g / (1 + g), 15);
    const gm = Math.tan((Math.PI * LADDER_MIX_HP_HZ) / RATE);
    expect(tuned(1000).mixG).toBeCloseTo(gm / (1 + gm), 15);
  });

  it('works a coefficient out again only when its input changed, the makeup only when k did', () => {
    const ladder = tuned(1000, undefined, 3);
    ladder.h = ladder.k = ladder.makeup = -1;
    tuneLadder(ladder, RATE);
    expect([ladder.h, ladder.k, ladder.makeup]).toEqual([-1, -1, -1]);
    ladder.cutoffHz = 1001;
    ladder.resonance = 3.5;
    tuneLadder(ladder, RATE);
    expect(ladder.h).toBeGreaterThan(0);
    expect(ladder.k).toBeGreaterThan(0);
    expect(ladder.makeup).toBeCloseTo(Math.sqrt(1 + ladder.k), 14);
    // A Reso that moves under the knob's floor leaves k at 0, and the makeup is not worked out again.
    const floor = tuned(1000, undefined, 0.4);
    floor.makeup = -1;
    floor.resonance = 0.3;
    tuneLadder(floor, RATE);
    expect([floor.k, floor.makeup]).toEqual([0, -1]);
  });
});
