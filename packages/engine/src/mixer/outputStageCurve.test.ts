/**
 * The output stage's static curves (windsor#193 decision 6): each mode's
 * shape, and the clipper's residual built on it, pinned bit for bit against
 * the residual it replaced, so the DSP and the console's plot share one
 * formula without the render moving (`outputStageGolden.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { OUTPUT_SOFT_CLIP } from './outputStageConstants';
import { OversampledClipper } from './outputStageClipper';
import { outputStageCurve } from './outputStageCurve';
import { dbToGain } from './outputStageDsp';

const CEILING = Math.fround(dbToGain(-1));
const KNEE = CEILING * dbToGain(-OUTPUT_SOFT_CLIP.kneeDb);

/** The clipper's residual as it read before it called the curve (windsor#93). */
function formerResidual(soft: boolean, c: number, k: number, w: number): number {
  const a = w < 0 ? -w : w;
  if (!soft) {
    if (a <= c) return 0;
    return w > 0 ? c - w : -c - w;
  }
  if (a <= k) return 0;
  const u = (a - k) / (c - k);
  const y = k + ((c - k) * u) / (1 + u);
  return w > 0 ? y - w : -y - w;
}

/** The clipper's private residual, configured as the stage configures it. */
function residualOf(soft: boolean): (w: number) => number {
  const clipper = new OversampledClipper();
  clipper.configure(soft, CEILING, KNEE);
  const open = clipper as unknown as { residual(w: number): number };
  return (w) => open.residual(w);
}

/** The named points: the knee, just below and above the ceiling, and +6 dB. */
const POINTS = {
  knee: KNEE,
  belowCeiling: CEILING * (1 - 1e-6),
  aboveCeiling: CEILING * (1 + 1e-6),
  plus6: dbToGain(6),
};

describe('outputStageCurve', () => {
  it('is the identity in Off, however loud', () => {
    for (const x of [0, 0.5, CEILING, 1, POINTS.plus6]) {
      expect(outputStageCurve('off', CEILING, x)).toBe(x);
    }
  });

  it('is the identity to the ceiling, then flat, in Limiter and Hard clip', () => {
    for (const mode of ['limiter', 'hard'] as const) {
      expect(outputStageCurve(mode, CEILING, POINTS.knee)).toBe(POINTS.knee);
      expect(outputStageCurve(mode, CEILING, POINTS.belowCeiling)).toBe(POINTS.belowCeiling);
      expect(outputStageCurve(mode, CEILING, POINTS.aboveCeiling)).toBe(CEILING);
      expect(outputStageCurve(mode, CEILING, POINTS.plus6)).toBe(CEILING);
    }
  });

  it('bends from the knee in Soft clip and stays under the ceiling', () => {
    expect(outputStageCurve('soft', CEILING, POINTS.knee)).toBe(POINTS.knee);
    expect(outputStageCurve('soft', CEILING, KNEE * 0.5)).toBe(KNEE * 0.5);
    const below = outputStageCurve('soft', CEILING, POINTS.belowCeiling);
    const plus6 = outputStageCurve('soft', CEILING, POINTS.plus6);
    expect(below).toBeLessThan(POINTS.belowCeiling);
    expect(below).toBeGreaterThan(KNEE);
    expect(plus6).toBeGreaterThan(below);
    expect(plus6).toBeLessThan(CEILING);
  });

  it('takes its knee from the shipped table unless one is passed', () => {
    for (const x of Object.values(POINTS)) {
      expect(outputStageCurve('soft', CEILING, x)).toBe(outputStageCurve('soft', CEILING, x, KNEE));
    }
  });
});

describe("the clipper's residual is the curve less the input", () => {
  for (const soft of [true, false]) {
    const mode = soft ? 'soft' : 'hard';
    const residual = residualOf(soft);

    it(`matches the curve at the named points, both signs (${mode})`, () => {
      for (const x of Object.values(POINTS)) {
        const y = outputStageCurve(mode, CEILING, x);
        expect(residual(x)).toBe(y === x ? 0 : y - x);
        expect(residual(-x)).toBe(y === x ? 0 : -y + x);
      }
    });

    it(`is bit for bit the residual it replaced across a sweep (${mode})`, () => {
      for (let i = -4000; i <= 4000; i++) {
        const w = Math.fround((i / 1000) * POINTS.plus6);
        expect(Object.is(residual(w), formerResidual(soft, CEILING, KNEE, w))).toBe(true);
      }
      for (const x of Object.values(POINTS)) {
        for (const w of [x, -x]) {
          expect(Object.is(residual(w), formerResidual(soft, CEILING, KNEE, w))).toBe(true);
        }
      }
    });
  }
});
