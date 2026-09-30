/**
 * The master column's meter rules (windsor#193 decision 2): where a dB value
 * sits on the scale, one ballistics step, the readouts and the zone
 * gradient. Values in, values out; `meterBar.ts` only applies what this
 * returns, and `meterModel.test.ts` pins it.
 */
import {
  MS_PER_SECOND,
  METER_BALLISTICS,
  METER_READOUT_DECIMALS,
  METER_SCALE,
  METER_SILENT_TEXT,
  METER_ZONES,
  REDUCTION_OFF_TEXT,
  REDUCTION_QUIET_DB,
  REDUCTION_SCALE,
  type MeterBallistics,
  type MeterScale,
  type MeterZones,
} from './meterTables';

const MINUS = '−';
const PLUS = '+';
const PERCENT = 100;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A dBFS value's height on the peak scale, 0 at the floor to 1 at the top; silence is 0. */
export function meterPosition(db: number, scale: MeterScale = METER_SCALE): number {
  if (!(db > scale.floorDb)) return 0;
  const span = (db - scale.floorDb) / (scale.ceilingDb - scale.floorDb);
  return Math.pow(clamp01(span), scale.exponent);
}

/** A reduction's depth on the gain-reduction bar, 0 to 1 from the top. */
export function reductionPosition(db: number, maxDb: number = REDUCTION_SCALE.maxDb): number {
  return Number.isFinite(db) ? clamp01(db / maxDb) : 0;
}

/**
 * One bar's state: the level it shows (never below the floor), and the held
 * peak with how long it has been held. The held peak is the reading itself,
 * so it may be −∞ at silence.
 */
export interface MeterState {
  readonly shownDb: number;
  readonly heldDb: number;
  readonly heldSeconds: number;
}

/** A bar at rest: the floor shown, nothing held. */
export function restingMeter(table: MeterBallistics = METER_BALLISTICS): MeterState {
  return { shownDb: table.floorDb, heldDb: -Infinity, heldSeconds: 0 };
}

/**
 * One ballistics step: a new peak `peakDb`, `elapsedSeconds` after the last.
 * The shown level jumps up to a louder peak at once and otherwise falls at
 * the table's rate, stopping at the floor. The held peak stays until a louder
 * one comes or it has been held `holdSeconds`, then follows the peak.
 */
export function stepMeter(
  state: MeterState,
  peakDb: number,
  elapsedSeconds: number,
  table: MeterBallistics = METER_BALLISTICS,
): MeterState {
  const fallen = Math.max(table.floorDb, state.shownDb - table.fallDbPerSecond * elapsedSeconds);
  const shownDb = Math.max(fallen, peakDb);
  const age = state.heldSeconds + elapsedSeconds;
  if (peakDb >= state.heldDb || age >= table.holdSeconds) {
    return { shownDb, heldDb: peakDb, heldSeconds: 0 };
  }
  return { shownDb, heldDb: state.heldDb, heldSeconds: age };
}

/** Seconds between two frame timestamps in milliseconds; 0 for the first frame or a clock step back. */
export function elapsedSeconds(lastMs: number | null, nowMs: number): number {
  if (lastMs === null || nowMs < lastMs) return 0;
  return (nowMs - lastMs) / MS_PER_SECOND;
}

/** A held-peak readout: `−∞` below the floor, else dBFS to a tenth with its sign. */
export function peakReadout(db: number, floorDb: number = METER_SCALE.floorDb): string {
  if (!(db >= floorDb)) return METER_SILENT_TEXT;
  const digits = Math.abs(db).toFixed(METER_READOUT_DECIMALS);
  if (db > 0) return PLUS + digits;
  return db < 0 ? MINUS + digits : digits;
}

/** A gain-reduction readout: `—` when the gauge is off, else the reduction as a cut. */
export function reductionReadout(db: number, off: boolean): string {
  if (off) return REDUCTION_OFF_TEXT;
  const digits = Math.max(0, db).toFixed(METER_READOUT_DECIMALS);
  return db > REDUCTION_QUIET_DB ? MINUS + digits : digits;
}

/**
 * The fixed zone gradient under a bar, towards `direction` (`to top`, `to
 * right`): teal, amber from `amberFromDb`, red from `redFromDb`, with hard
 * edges at those levels' heights.
 */
export function zoneGradient(
  direction: string,
  zones: MeterZones = METER_ZONES,
  scale: MeterScale = METER_SCALE,
): string {
  const amber = (meterPosition(zones.amberFromDb, scale) * PERCENT).toFixed(1);
  const red = (meterPosition(zones.redFromDb, scale) * PERCENT).toFixed(1);
  return (
    `linear-gradient(${direction}, ${zones.teal} 0 ${amber}%, ` +
    `${zones.amber} ${amber}% ${red}%, ${zones.red} ${red}% 100%)`
  );
}
