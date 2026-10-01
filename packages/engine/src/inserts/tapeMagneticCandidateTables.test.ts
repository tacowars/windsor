/**
 * The allowed magnetic points (windsor#276 decision 1) against the research
 * generator they come from: windsor#204's control schedule
 * (`docs/research/2026-09-30-tape-dynamic-survival/program.ts`,
 * `controlSchedule`), reproduced here rather than imported, because that
 * program imports the GPL research core. Its README's "Control schedule":
 * the edits segment runs 10 s at a new point every 50 ms, 200 points, in
 * blocks of a `mulberry32(204)` shuffle of the eight corners and the centre
 * followed by one seeded interior point. The table must hold every sampled
 * point whose origin susceptibility is above the floor, and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../sequencing/mulberry32';
import { originSusceptibility } from '../worklet/tape/tapeMagnetic';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';
import { TAPE_MAGNETIC_CANDIDATES, type TapeMagneticRow } from './tapeMagneticCandidateTables';

/** The research table's values (`dynamicConstants.ts`): seed, segment length and step. */
const SEED = 204;
const EDITS_SECONDS = 10;
const STEP_SECONDS = 0.05;
const CENTRE: TapeMagneticRow = [0.5, 0.5, 0.5];
/** The eight corners in the research's order (drive, then width, then saturation), then the centre. */
const NINE: TapeMagneticRow[] = [
  ...[0, 1].flatMap((d) => [0, 1].flatMap((w) => [0, 1].map((s): TapeMagneticRow => [d, w, s]))),
  CENTRE,
];

/** `controlSchedule` as the research program draws it, and the interior points apart. */
function schedule(): { points: TapeMagneticRow[]; interior: TapeMagneticRow[] } {
  const random = mulberry32(SEED);
  const count = Math.round(EDITS_SECONDS / STEP_SECONDS);
  const points: TapeMagneticRow[] = [];
  const interior: TapeMagneticRow[] = [];
  while (points.length < count) {
    const block = NINE.map((p): TapeMagneticRow => [p[0], p[1], p[2]]);
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [block[i], block[j]] = [block[j]!, block[i]!];
    }
    const point: TapeMagneticRow = [random(), random(), random()];
    interior.push(point);
    points.push(...block, point);
  }
  return { points: points.slice(0, count), interior };
}

const susceptibility = (row: TapeMagneticRow): number =>
  originSusceptibility({ drive: row[0], width: row[1], saturation: row[2] });
const aboveFloor = (row: TapeMagneticRow): boolean =>
  susceptibility(row) > TAPE_MAGNETIC.susceptibilityFloor;
const key = (row: TapeMagneticRow): string => row.join(',');

describe('the allowed magnetic points (windsor#276 decision 1)', () => {
  const { points, interior } = schedule();

  it('regenerates the research schedule: 200 points, twenty blocks, every corner and the centre twenty times', () => {
    expect(points).toHaveLength(200);
    expect(interior).toHaveLength(20);
    for (const point of NINE) expect(points.filter((p) => key(p) === key(point))).toHaveLength(20);
    for (const point of interior) expect(point.every((v) => v > 0 && v < 1)).toBe(true);
  });

  it('holds every sampled point above the floor and nothing else, in table order', () => {
    const corners = NINE.slice(0, -1);
    const sampled = [CENTRE, ...corners, ...interior];
    expect(TAPE_MAGNETIC_CANDIDATES).toEqual(sampled.filter(aboveFloor));
    expect(new Set(TAPE_MAGNETIC_CANDIDATES.map(key)).size).toBe(TAPE_MAGNETIC_CANDIDATES.length);
  });

  it('lists only points above the floor, and no point at width 1', () => {
    for (const row of TAPE_MAGNETIC_CANDIDATES) {
      expect(row.every((v) => v >= 0 && v <= 1)).toBe(true);
      expect(susceptibility(row)).toBeGreaterThan(TAPE_MAGNETIC.susceptibilityFloor);
      expect(row[1]).not.toBe(1);
    }
    const excluded = NINE.filter((row) => !aboveFloor(row));
    expect(excluded.map(key)).toEqual(['0,1,0', '0,1,1', '1,1,0', '1,1,1']);
    expect(TAPE_MAGNETIC_CANDIDATES).toHaveLength(25);
  });
});
