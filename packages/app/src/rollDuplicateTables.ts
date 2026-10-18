/**
 * Dup's words (windsor#904; record `2026-10-18-roll-zoom-bars-and-duplicate`
 * decision 11, the mockup's title): the button, its undo step, and the
 * title that says why it is off, one per refusal (`rollDuplicate.ts`).
 */
import { ROLL_ENVELOPE_POINTS_MAX, ROLL_NOTES_MAX } from '@windsor/engine';
import type { DuplicateRefusal } from './rollDuplicate';

export const ROLL_DUPLICATE = {
  label: 'Dup',
  undo: 'Duplicate loop',
  title:
    'Duplicate: double the loop and copy its notes, accents, ratchets and envelopes into the new half',
} as const;

/** The disabled button's title, by what refuses the duplicate. */
export const ROLL_DUPLICATE_REFUSED: Readonly<Record<DuplicateRefusal, string>> = {
  longest: "Can't duplicate: twice this loop is longer than a roll's longest loop",
  region: "Can't duplicate: twice this loop is longer than the region",
  parked:
    "Can't duplicate: the notes or envelope points parked past the loop would move past a roll's longest loop",
  notes: `Can't duplicate: the copies would take the roll past its ${ROLL_NOTES_MAX} notes`,
  points: `Can't duplicate: the copies would take an envelope past its ${ROLL_ENVELOPE_POINTS_MAX} points`,
};
