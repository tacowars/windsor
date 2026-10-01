/**
 * The main thread's half of the Tape developer override (windsor#276): send
 * one live Tape insert an allowed magnetic row, or the model's row back. The
 * console's hidden picker calls it with the stage it finds by
 * `liveInsert`; nothing here touches a spec, a song or a patch, so the
 * override ends with the stage (a rebuild or a reload gives the shipped
 * sound).
 *
 * Only a row of `TAPE_MAGNETIC_CANDIDATES` is sent; the processor checks it
 * against the susceptibility floor again before use and refuses, never
 * clamps, a row that fails (`worklet/tape/tapeMagneticRows.ts`). Pinned by
 * `tapeMagneticOverride.test.ts`.
 */
import type { InsertStage } from './insertKind';
import { TAPE_MAGNETIC_CANDIDATES, type TapeMagneticRow } from './tapeMagneticCandidateTables';
import {
  TAPE_MAGNETIC_OVERRIDE,
  type TapeMagneticOverrideMessage,
} from './tapeMagneticOverrideMessage';

/** Whether `row` is one of the allowed points, value for value. */
export function isTapeMagneticCandidate(
  row: TapeMagneticRow,
  candidates: readonly TapeMagneticRow[] = TAPE_MAGNETIC_CANDIDATES,
): boolean {
  return candidates.some((c) => c[0] === row[0] && c[1] === row[1] && c[2] === row[2]);
}

/**
 * Post `row` (or `null`, the model's own row) to `stage`'s processor.
 * Returns false, and posts nothing, when `stage` is not a live Tape insert
 * or `row` is not an allowed point.
 */
export function setTapeMagneticOverride(
  stage: Pick<InsertStage<{ readonly kind: string }>, 'kind' | 'processor'> | undefined,
  row: TapeMagneticRow | null,
): boolean {
  if (stage?.kind !== 'tape' || !stage.processor) return false;
  if (row && !isTapeMagneticCandidate(row)) return false;
  const message: TapeMagneticOverrideMessage = {
    type: TAPE_MAGNETIC_OVERRIDE,
    row: row ? [row[0], row[1], row[2]] : null,
  };
  stage.processor.port.postMessage(message);
  return true;
}
