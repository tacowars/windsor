/**
 * An operator's Start segment: Free lets the operator's phase run from
 * wherever the voice draws it (`phaseFree: true`, the engine's default), and
 * Locked starts its wave at the bay's Phase knob on every note
 * (`phaseFree: false`), the way a drum circuit starts the same each hit.
 * Pure, so the test reads what a button writes without a browser.
 */
import type { Patch } from '@windsor/engine';

/** The segment's faces, in index order. */
export const OP_START_NAMES = ['Free', 'Locked'] as const;
const LOCKED = 1;

/** The segment index operator `i` shows: Locked when its phase is not free. */
export const opStartIndex = (patch: Patch, i: number): number =>
  patch.ops[i]?.phaseFree === false ? LOCKED : 0;

/** True when operator `i` starts at its Phase knob, so the knob is worth showing. */
export const opStartLocked = (patch: Patch, i: number): boolean =>
  opStartIndex(patch, i) === LOCKED;

/** What pressing one of the Start buttons writes. The editor's push commits it. */
export function writeOpStart(patch: Patch, i: number, index: number): void {
  const target = patch.ops[i];
  if (target) target.phaseFree = index !== LOCKED;
}
