/**
 * The GR or Over gauge's state (windsor#194; record
 * `2026-09-30-master-column-and-meters`, decision 5): the bar's ballistics
 * and which gauge they belong to. A held reduction is not an over, so a
 * change of gauge (`gaugeFor`) starts again from rest rather than renaming
 * what was held: after a Limiter's −12 dB, a switch to a clip mode must not
 * read "Over 12.0" for the rest of the hold. Off counts as a gauge of its
 * own, so a quick switch through Off clears the hold too.
 *
 * The master column's GR bar (`meterBar.ts`) and the bridge's chip
 * (`meterBridge.ts`) both keep one.
 */
import { type MeterBallistics, REDUCTION_BALLISTICS } from './meterTables';
import { elapsedSeconds, restingMeter, stepMeter, type MeterState } from './meterModel';
import type { OutputGauge } from './outputStageModel';

export interface GaugeMeter {
  readonly gauge: OutputGauge;
  readonly meter: MeterState;
  /** The last frame's time, in milliseconds; `null` before the first. */
  readonly lastMs: number | null;
}

/** `gauge` at rest: nothing shown, nothing held. */
export function restingGauge(
  gauge: OutputGauge,
  table: MeterBallistics = REDUCTION_BALLISTICS,
): GaugeMeter {
  return { gauge, meter: restingMeter(table), lastMs: null };
}

/** The same state while the gauge holds; from rest when it changes. */
export function regauge(
  state: GaugeMeter,
  gauge: OutputGauge,
  table: MeterBallistics = REDUCTION_BALLISTICS,
): GaugeMeter {
  return state.gauge === gauge ? state : restingGauge(gauge, table);
}

/** One frame's reading `db` at `nowMs`. */
export function stepGauge(
  state: GaugeMeter,
  db: number,
  nowMs: number,
  table: MeterBallistics = REDUCTION_BALLISTICS,
): GaugeMeter {
  const meter = stepMeter(state.meter, db, elapsedSeconds(state.lastMs, nowMs), table);
  return { gauge: state.gauge, meter, lastMs: nowMs };
}
