/**
 * The ratchet a step rolls (record `2026-10-01-sequencer-rack-devices`
 * decision 6, windsor#368; first drawn on the Euclid card, windsor#356): 1 to
 * `RATCHET_MAX` hits per step, and a click cycles ×1 → ×2 → ×3 → ×4 → ×1.
 *
 * Two shapes hold one. The Euclid card keeps a row beside its figure
 * (`ratchets`, one roll per step: `ratchetAt`, `ratchetsForSteps`,
 * `cycleRatchet`). The Grid, and the Arp and Basslead after it, keep it on
 * the note step itself (`ratchet`, absent for one hit, windsor#366:
 * `stepRatchet`, `cycleStepRatchet`). A rest or a tie has none: it reads ×1,
 * a click does nothing, and the card draws its cell grey. Every function
 * returns a new value, for `ctx.change`, where an array replaces wholesale.
 */
import { RATCHET_MAX } from '@windsor/engine';

/** Step `index`'s roll in a row: absent, or past the row's end, a plain hit. */
export const ratchetAt = (ratchets: readonly number[] | undefined, index: number): number =>
  ratchets?.[index] ?? 1;

/** The row fitted to `steps`: padded with 1, trimmed past the end. */
export function ratchetsForSteps(ratchets: readonly number[] | undefined, steps: number): number[] {
  return Array.from({ length: Math.max(0, Math.trunc(steps)) }, (_, i) => ratchetAt(ratchets, i));
}

/** The roll after `roll`: one more, ×`max` wrapping to ×1. */
export const nextRatchet = (roll: number, max = RATCHET_MAX): number => (roll % max) + 1;

/** The row with step `index` cycled one roll on, ×`max` wrapping to ×1, fitted to `steps`. */
export function cycleRatchet(
  ratchets: readonly number[] | undefined,
  steps: number,
  index: number,
  max = RATCHET_MAX,
): number[] {
  const row = ratchetsForSteps(ratchets, steps);
  const now = row[index];
  if (now !== undefined) row[index] = nextRatchet(now, max);
  return row;
}

/** A step that may roll: a note with an optional `ratchet`, or a rest or a tie, which never does. */
export type RatchetStep =
  | { readonly kind: 'rest' }
  | { readonly kind: 'tie' }
  | { readonly kind: 'note'; readonly ratchet?: number };

/** Whether a step can hold a ratchet: only a note can. A rest's or a tie's cell is grey and inert. */
export const takesRatchet = (step: RatchetStep | undefined): boolean => step?.kind === 'note';

/** A step's roll: a note's `ratchet`, else one hit (a rest, a tie, a note without one). */
export const stepRatchet = (step: RatchetStep | undefined): number =>
  step?.kind === 'note' ? (step.ratchet ?? 1) : 1;

/**
 * The step with its roll cycled one on, ×`max` wrapping to ×1. A note at ×1
 * carries no `ratchet` field, as the engine's normaliser writes it; a rest
 * or a tie comes back unchanged.
 */
export function cycleStepRatchet<S extends RatchetStep>(step: S, max = RATCHET_MAX): S {
  if (step.kind !== 'note') return step;
  const roll = nextRatchet(stepRatchet(step), max);
  const next: Record<string, unknown> = { ...step };
  if (roll > 1) next.ratchet = roll;
  else delete next.ratchet;
  // The copy is `step` with only `ratchet` set or dropped, so it is still an `S`.
  return next as S;
}
