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
 * assertion when the bundle loads.
 *
 * Invariant: nothing here is on the per-sample path. Pinned by
 * `inserts/tapeMagneticIntegration.test.ts` (the mapping at every model, the
 * floor and the width endpoint).
 */
import { TAPE_MODELS } from '../../inserts/tapeConstants';
import { TAPE_MAGNETIC, type TapeMagneticControls } from '../../inserts/tapeMagneticConstants';
import { originSusceptibility, type MagneticTable } from './tapeMagnetic';

type MagneticRow = readonly [number, number, number];

/** `row` into `into` (drive, width, saturation), which it returns. */
function magneticControls(row: MagneticRow, into: TapeMagneticControls): TapeMagneticControls {
  into.drive = row[0];
  into.width = row[1];
  into.saturation = row[2];
  return into;
}

/** Throws unless every row's controls are in [0, 1] and its origin susceptibility is above the floor. */
function assertMagneticRows(
  rows: ReadonlyArray<{ readonly magnetic: MagneticRow }> = TAPE_MODELS,
  table: MagneticTable = TAPE_MAGNETIC,
): void {
  const controls: TapeMagneticControls = { drive: NaN, width: NaN, saturation: NaN };
  rows.forEach(({ magnetic }, index) => {
    if (!magnetic.every((value) => value >= 0 && value <= 1))
      throw new RangeError(`tape model ${index}: magnetic controls must be in [0, 1]`);
    const susceptibility = originSusceptibility(magneticControls(magnetic, controls), table);
    if (!(susceptibility > table.susceptibilityFloor))
      throw new RangeError(
        `tape model ${index}: origin susceptibility ${susceptibility} is not above ${table.susceptibilityFloor}`,
      );
  });
}

export { assertMagneticRows, magneticControls };
export type { MagneticRow };
