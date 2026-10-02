/**
 * The Euclid card's ratchet row (windsor#356, decision 3 of the issue; the
 * row is the engine's, windsor#355): one roll of 1 to `EUCLID_RATCHET_MAX`
 * hits per trigger step. A click cycles a step ×1 → ×2 → ×3 → ×4 → ×1, and
 * a Steps change pads the row with 1 or trims it, as the normaliser fits it.
 *
 * The row is the shared ratchet model's since windsor#368
 * (`ratchetModel.ts`, which the Grid's per-step ratchet also uses); this
 * file keeps the Euclid card's imports where they were.
 */
export { cycleRatchet, ratchetAt, ratchetsForSteps } from './ratchetModel';
