/**
 * The Euclid card's ratchet row (windsor#356, decision 3 of the issue; the
 * row is the engine's, windsor#355): one roll of 1 to `EUCLID_RATCHET_MAX`
 * hits per trigger step. A click cycles a step ×1 → ×2 → ×3 → ×4 → ×1, and
 * a Steps change pads the row with 1 or trims it, as the normaliser fits it.
 * Every function returns the whole row, for `ctx.change`, where an array
 * replaces wholesale.
 */
import { EUCLID_RATCHET_MAX } from '@windsor/engine';

/** Step `index`'s roll: absent, or past the row's end, a plain hit. */
export const ratchetAt = (ratchets: readonly number[] | undefined, index: number): number =>
  ratchets?.[index] ?? 1;

/** The row fitted to `steps`: padded with 1, trimmed past the end. */
export function ratchetsForSteps(ratchets: readonly number[] | undefined, steps: number): number[] {
  return Array.from({ length: Math.max(0, Math.trunc(steps)) }, (_, i) => ratchetAt(ratchets, i));
}

/** The row with step `index` cycled one roll on, ×`max` wrapping to ×1, fitted to `steps`. */
export function cycleRatchet(
  ratchets: readonly number[] | undefined,
  steps: number,
  index: number,
  max = EUCLID_RATCHET_MAX,
): number[] {
  const row = ratchetsForSteps(ratchets, steps);
  const now = row[index];
  if (now !== undefined) row[index] = (now % max) + 1;
  return row;
}
