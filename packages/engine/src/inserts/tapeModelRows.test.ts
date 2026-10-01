/**
 * Each tape model's magnetic row (windsor#289 decision 1,
 * `docs/log/2026-10-01-tape-per-model-magnetic-rows.md`): every row is one of
 * the seeded interior points windsor#204's dynamic-survival record sampled,
 * written as the exact double the schedule drew.
 *
 * The schedule is reproduced here, as closed PR #278's candidate test did,
 * rather than imported, because the research program imports the GPL research
 * core. Its README's "Control schedule": the edits segment runs 10 s at a new
 * point every 50 ms, 200 points, in blocks of a `mulberry32(204)` shuffle of
 * the eight corners and the centre followed by one seeded interior point.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../sequencing/mulberry32';
import { originSusceptibility } from '../worklet/tape/tapeMagnetic';
import { assertMagneticRows } from '../worklet/tape/tapeMagneticRows';
import { TAPE_MODELS, TAPE_TYPES } from './tapeConstants';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';

type Row = readonly [number, number, number];

/** The research table's values (`dynamicConstants.ts`): seed, segment length and step. */
const SEED = 204;
const EDITS_SECONDS = 10;
const STEP_SECONDS = 0.05;
const NINE: Row[] = [
  ...[0, 1].flatMap((d) => [0, 1].flatMap((w) => [0, 1].map((s): Row => [d, w, s]))),
  [0.5, 0.5, 0.5],
];

/** The issue's two-decimal labels, which name the points: drive / width / saturation. */
const LABELS: Record<(typeof TAPE_TYPES)[number], Row> = {
  studio: [0.16, 0.28, 0.32],
  ferric: [0.72, 0.51, 0.59],
  vintage: [0.74, 0.83, 0.53],
  studio15: [0.55, 0.59, 0.56],
  chrome: [0.34, 0.13, 0.56],
  metal: [0.34, 0.49, 0.13],
  vhs: [0.84, 0.77, 0.97],
};

/** The interior points of `controlSchedule`, in the order the research program draws them. */
function interiorPoints(): Row[] {
  const random = mulberry32(SEED);
  const blocks = Math.round(EDITS_SECONDS / STEP_SECONDS) / (NINE.length + 1);
  const interior: Row[] = [];
  for (let b = 0; b < blocks; b++) {
    // The block's Fisher–Yates shuffle of the nine draws first; only its draws matter here.
    for (let i = NINE.length - 1; i > 0; i--) random();
    interior.push([random(), random(), random()]);
  }
  return interior;
}

const label = (row: Row): string => row.map((v) => v.toFixed(2)).join(' / ');

describe('the tape models’ magnetic rows (windsor#289)', () => {
  const interior = interiorPoints();

  it('draws the twenty interior points of the survival schedule', () => {
    expect(interior).toHaveLength(20);
    for (const point of interior) expect(point.every((v) => v > 0 && v < 1)).toBe(true);
  });

  it('gives each model the exact seeded point its label names, and no two models the same', () => {
    TAPE_TYPES.forEach((type, i) => {
      const matches = interior.filter((point) => label(point) === label(LABELS[type]));
      expect(matches, type).toHaveLength(1);
      expect(TAPE_MODELS[i]!.magnetic, type).toEqual(matches[0]);
    });
    expect(new Set(TAPE_MODELS.map(({ magnetic }) => label(magnetic))).size).toBe(
      TAPE_MODELS.length,
    );
  });

  it('keeps every row above the susceptibility floor, as the load-time assertion requires', () => {
    expect(() => assertMagneticRows()).not.toThrow();
    for (const { magnetic } of TAPE_MODELS) {
      const [drive, width, saturation] = magnetic;
      expect(originSusceptibility({ drive, width, saturation })).toBeGreaterThan(
        TAPE_MAGNETIC.susceptibilityFloor,
      );
    }
  });
});
