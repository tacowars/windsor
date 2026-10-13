/**
 * The Pump's flat param vocabulary (record `2026-10-13-pump-insert`
 * decision 4): the spec as named k-rate params, shared by the insert, the
 * processor's descriptors and the harness. The shape travels as
 * `count`, `at<i>`, `level<i>` and `bend<i>` for every slot up to
 * `PUMP_MAX_POINTS`, unused slots at the last point; the length as
 * `lengthMs` whatever the sync, the tempo folded in on the main thread.
 * `external` is the mixer's (`detector.setExternal`) and `set` never writes it.
 */
import {
  DEFAULT_PUMP_POINTS,
  PUMP_BOUNDS,
  PUMP_DEFAULTS,
  PUMP_DSP,
  PUMP_MAX_POINTS,
  PUMP_MIN_POINTS,
  PUMP_POINT_BOUNDS,
  PUMP_SYNC_DEFAULTS,
} from './pumpConstants';
import { pumpLengthMs } from './pumpCurves';
import type { PumpDivision } from './pumpConstants';

/**
 * What the params are written from: a `PumpSpec`'s fields, stated here
 * rather than imported, so the worklet's project never reads the spec's
 * module and, through it, the rest of the engine.
 */
export interface PumpParamSource {
  readonly points: readonly {
    readonly at: number;
    readonly level: number;
    readonly bend: number;
  }[];
  readonly sync: boolean;
  readonly division: PumpDivision;
  readonly lengthMs: number;
  readonly depth: number;
  readonly sensitivity: number;
  readonly holdMs: number;
  readonly smoothMs: number;
  readonly enabled: boolean;
}

export interface PumpParamDescriptor {
  readonly name: string;
  readonly minValue: number;
  readonly maxValue: number;
  readonly defaultValue: number;
}

const POINT_SLOTS = Array.from({ length: PUMP_MAX_POINTS }, (_, i) => i);
const pointOf = (spec: PumpParamSource, i: number) =>
  spec.points[i < spec.points.length ? i : spec.points.length - 1]!;

/** Every param `set` writes, by name, for `spec` at `bpm`. */
export function pumpParameters(spec: PumpParamSource, bpm: number): Record<string, number> {
  const [lo, hi] = PUMP_DSP.lengthParamMs;
  const values: Record<string, number> = {
    lengthMs: Math.min(hi, Math.max(lo, pumpLengthMs(spec, bpm))),
    depth: spec.depth,
    sensitivity: spec.sensitivity,
    holdMs: spec.holdMs,
    smoothMs: spec.smoothMs,
    enabled: Number(spec.enabled),
    count: spec.points.length,
  };
  for (const i of POINT_SLOTS) {
    const point = pointOf(spec, i);
    values[`at${i}`] = point.at;
    values[`level${i}`] = point.level;
    values[`bend${i}`] = point.bend;
  }
  return values;
}

/** The params whose values follow the tempo: `setTempo` writes only these. */
export const pumpTiming = (spec: PumpParamSource, bpm: number): Record<string, number> => ({
  lengthMs: pumpParameters(spec, bpm).lengthMs!,
});

// From the constants, not `DEFAULT_PUMP`: the worklet reads this file and never the spec's normaliser.
const DEFAULTS = pumpParameters(
  {
    points: DEFAULT_PUMP_POINTS,
    ...PUMP_SYNC_DEFAULTS,
    ...PUMP_DEFAULTS,
    enabled: true,
  },
  PUMP_DSP.defaultBpm,
);

function descriptor(name: string, range: readonly [number, number]): PumpParamDescriptor {
  return { name, minValue: range[0], maxValue: range[1], defaultValue: DEFAULTS[name]! };
}

/** The processor's params, in slot order. */
export const PUMP_PARAMS: readonly PumpParamDescriptor[] = [
  descriptor('lengthMs', PUMP_DSP.lengthParamMs),
  descriptor('depth', PUMP_BOUNDS.depth),
  descriptor('sensitivity', PUMP_BOUNDS.sensitivity),
  descriptor('holdMs', PUMP_BOUNDS.holdMs),
  descriptor('smoothMs', PUMP_BOUNDS.smoothMs),
  descriptor('enabled', [0, 1]),
  { name: 'external', minValue: 0, maxValue: 1, defaultValue: 0 },
  descriptor('count', [PUMP_MIN_POINTS, PUMP_MAX_POINTS]),
  ...POINT_SLOTS.flatMap((i) => [
    descriptor(`at${i}`, PUMP_POINT_BOUNDS.at),
    descriptor(`level${i}`, PUMP_POINT_BOUNDS.level),
    descriptor(`bend${i}`, PUMP_POINT_BOUNDS.bend),
  ]),
];

/** A lane's field and the param it moves: the continuous fields name their own. */
export const pumpParamOf = (field: string): string | undefined =>
  Object.hasOwn(PUMP_BOUNDS, field) || field === 'enabled' ? field : undefined;
