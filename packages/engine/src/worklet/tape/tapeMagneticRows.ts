/**
 * The tape models' magnetic rows (windsor#224, design decision 6 of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`). Each row of
 * `TAPE_MODELS` carries the core's three fixed internal controls,
 * `[drive, width, saturation]`; `magneticControls` reads one into a
 * preallocated controls object, and `assertMagneticRows` refuses a row whose
 * controls leave [0, 1] or whose origin susceptibility, which sets the core's
 * output normalisation, is not above `TAPE_MAGNETIC.susceptibilityFloor`. At
 * the width endpoint the reversible coefficient clamps to zero and so does
 * the susceptibility, so such a row is refused. `tapeDsp.ts` runs the
 * assertion when the bundle loads. The developer override (windsor#276)
 * checks its row with the same two tests, `magneticRowInRange` and
 * `magneticRowAboveFloor`, and refuses one that fails.
 *
 * Invariant: nothing here is on the per-sample path. Pinned by
 * `inserts/tapeMagneticIntegrationSwitch.test.ts` (the mapping at every
 * model, the floor and the width endpoint) and
 * `inserts/tapeMagneticOverride.test.ts` (the override refused).
 */
import { TAPE_MODELS } from '../../inserts/tapeConstants';
import { TAPE_MAGNETIC, type TapeMagneticControls } from '../../inserts/tapeMagneticConstants';
import { originSusceptibility, type MagneticTable } from './tapeMagnetic';

type MagneticRow = readonly [number, number, number];
const ROW_LENGTH = 3;

/** `row` into `into` (drive, width, saturation), which it returns. */
function magneticControls(row: MagneticRow, into: TapeMagneticControls): TapeMagneticControls {
  into.drive = row[0];
  into.width = row[1];
  into.saturation = row[2];
  return into;
}

/** Whether `row` is an array of three numbers, each in [0, 1] (NaN is not). */
function magneticRowInRange(row: unknown): row is MagneticRow {
  if (!Array.isArray(row) || row.length !== ROW_LENGTH) return false;
  for (let i = 0; i < ROW_LENGTH; i++) {
    const value: unknown = row[i];
    if (typeof value !== 'number' || !(value >= 0 && value <= 1)) return false;
  }
  return true;
}

/** Whether `row`'s origin susceptibility is above the floor; `scratch` takes its controls. */
function magneticRowAboveFloor(
  row: MagneticRow,
  scratch: TapeMagneticControls,
  table: MagneticTable = TAPE_MAGNETIC,
): boolean {
  return originSusceptibility(magneticControls(row, scratch), table) > table.susceptibilityFloor;
}

/** Throws unless every row's controls are in [0, 1] and its origin susceptibility is above the floor. */
function assertMagneticRows(
  rows: ReadonlyArray<{ readonly magnetic: MagneticRow }> = TAPE_MODELS,
  table: MagneticTable = TAPE_MAGNETIC,
): void {
  const controls: TapeMagneticControls = { drive: NaN, width: NaN, saturation: NaN };
  rows.forEach(({ magnetic }, index) => {
    if (!magneticRowInRange(magnetic))
      throw new RangeError(`tape model ${index}: magnetic controls must be in [0, 1]`);
    if (!magneticRowAboveFloor(magnetic, controls, table))
      throw new RangeError(
        `tape model ${index}: origin susceptibility ${originSusceptibility(controls, table)} is not above ${table.susceptibilityFloor}`,
      );
  });
}

export { assertMagneticRows, magneticControls, magneticRowAboveFloor, magneticRowInRange };
export type { MagneticRow };
