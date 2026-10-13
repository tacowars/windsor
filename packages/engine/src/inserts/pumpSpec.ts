/**
 * The Pump insert's song-owned settings (record `2026-10-13-pump-insert`):
 * the key source, the drawn shape, the cycle's length and the detector's two
 * controls. The shape is a list of breakpoints, kept sorted, the first at 0
 * and the last at 1; a point's `bend` shapes the segment that leaves it.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import {
  DEFAULT_PUMP_POINTS,
  PUMP_BOUNDS,
  PUMP_DEFAULTS,
  PUMP_DIVISIONS,
  PUMP_MAX_POINTS,
  PUMP_MIN_POINTS,
  PUMP_POINT_BOUNDS,
  PUMP_SYNC_DEFAULTS,
} from './pumpConstants';
import type { PumpDivision } from './pumpConstants';
import { normaliseSidechain, type SidechainSource } from './sidechainSource';

export interface PumpPoint {
  /** Where in the cycle, 0 to 1. */
  readonly at: number;
  /** The gain there, linear, 0 to 1. */
  readonly level: number;
  /** The bend of the segment that leaves this point: 0 straight, above 0 early, below 0 late. */
  readonly bend: number;
}

export interface PumpSpec {
  readonly kind: 'pump';
  readonly sidechain?: SidechainSource;
  readonly points: readonly PumpPoint[];
  /** The cycle follows the song's tempo at `division`; off, it lasts `lengthMs`. */
  readonly sync: boolean;
  readonly division: PumpDivision;
  readonly lengthMs: number;
  readonly depth: number;
  readonly sensitivity: number;
  readonly holdMs: number;
  readonly smoothMs: number;
  readonly enabled: boolean;
}

export const DEFAULT_PUMP: PumpSpec = {
  kind: 'pump',
  sidechain: 'internal',
  points: DEFAULT_PUMP_POINTS,
  ...PUMP_SYNC_DEFAULTS,
  ...PUMP_DEFAULTS,
  enabled: true,
};

export const PUMP_FIELDS = Object.keys(DEFAULT_PUMP);
export const PUMP_NUMBERS = Object.keys(PUMP_BOUNDS) as Array<keyof typeof PUMP_BOUNDS>;
const POINT_FIELDS = Object.keys(PUMP_POINT_BOUNDS);

function normalisePoint(raw: unknown, path: string, n: FieldNormaliser): PumpPoint | null {
  if (!isRecord(raw)) {
    n.correction(`${path}: ${show(raw)} is not a point — dropped`);
    return null;
  }
  n.dropUnknown(raw, POINT_FIELDS, path);
  const B = PUMP_POINT_BOUNDS;
  return {
    at: n.num(raw.at, 0, B.at[0], B.at[1], `${path}.at`),
    level: n.num(raw.level, 1, B.level[0], B.level[1], `${path}.level`),
    bend: n.num(raw.bend, 0, B.bend[0], B.bend[1], `${path}.bend`),
  };
}

/** `points` sorted by `at` (ties keep their order), the ends pinned to 0 and 1. */
function pinned(points: PumpPoint[], path: string, n: FieldNormaliser): PumpPoint[] {
  const sorted = points.map((point, i) => ({ point, i }));
  sorted.sort((a, b) => a.point.at - b.point.at || a.i - b.i);
  if (sorted.some(({ i }, at) => i !== at)) n.correction(`${path}: points sorted by position`);
  const out = sorted.map(({ point }) => point);
  const last = out.length - 1;
  if (out[0]!.at !== 0) {
    n.correction(`${path}[0].at: the first point is at 0`);
    out[0] = { ...out[0]!, at: 0 };
  }
  if (out[last]!.at !== 1) {
    n.correction(`${path}[${last}].at: the last point is at 1`);
    out[last] = { ...out[last]!, at: 1 };
  }
  return out;
}

/** A shape of 2 to `PUMP_MAX_POINTS` points; anything less is the default shape. */
export function normalisePumpPoints(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
): readonly PumpPoint[] {
  if (raw === undefined) return DEFAULT_PUMP.points;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of points — using the default shape`);
    return DEFAULT_PUMP.points;
  }
  if (raw.length > PUMP_MAX_POINTS)
    n.correction(`${path}: ${raw.length} points — kept the first ${PUMP_MAX_POINTS}`);
  const points = raw
    .slice(0, PUMP_MAX_POINTS)
    .map((point, i) => normalisePoint(point, `${path}[${i}]`, n))
    .filter((point): point is PumpPoint => point !== null);
  if (points.length < PUMP_MIN_POINTS) {
    n.correction(`${path}: fewer than ${PUMP_MIN_POINTS} points — using the default shape`);
    return DEFAULT_PUMP.points;
  }
  return pinned(points, path, n);
}

export function normalisePump(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): PumpSpec {
  n.dropUnknown(raw, PUMP_FIELDS, path);
  const values = { ...PUMP_DEFAULTS };
  for (const name of PUMP_NUMBERS) {
    const [min, max] = PUMP_BOUNDS[name];
    values[name] = n.num(raw[name], PUMP_DEFAULTS[name], min, max, `${path}.${name}`);
  }
  return {
    kind: 'pump',
    sidechain: normaliseSidechain(raw.sidechain, `${path}.sidechain`, n),
    points: normalisePumpPoints(raw.points, `${path}.points`, n),
    sync: n.bool(raw.sync, DEFAULT_PUMP.sync, `${path}.sync`),
    division: n.pick(raw.division, PUMP_DIVISIONS, DEFAULT_PUMP.division, `${path}.division`),
    ...values,
    enabled: n.bool(raw.enabled, DEFAULT_PUMP.enabled, `${path}.enabled`),
  };
}
