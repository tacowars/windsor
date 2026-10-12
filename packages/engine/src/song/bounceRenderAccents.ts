/**
 * Bounce to Roll's accents (windsor#755, record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 11, which supersedes
 * the accent parts of `2026-10-11-bounce-to-roll` decisions 4 and 8): an
 * accented note-on is written as a note with `accent: true` at its level
 * without the bump, and its region's roll plays the bump and the mod the
 * accent carried, so the note plays back exactly as the generator played
 * it.
 *
 * A roll has one pair of accent amounts. Where a region's accents do not
 * all share one bump and one mod, the region falls back to the old
 * handling: each accent's bump stays baked into its velocity, its mod is
 * lost and counted, and the bounce raises the part's Vel to fit. A note
 * that shares its onset with another (a chord) is baked the same way,
 * whatever its region does, since the normaliser clears an accent there
 * (the record's decision 5). Pure.
 */
import { rollSharedOnsets } from '../sequencing/rollSequencer';
import type { WrittenNote } from './bounceRenderNotes';
import type { AccentAmounts, BounceNote } from './bounceRenderTypes';

/** A region's notes with their accents written or baked, and the amounts its roll plays. */
export interface AccentedNotes {
  readonly notes: BounceNote[];
  readonly accent: AccentAmounts | null;
}

/** The one pair of amounts every accent in `accents` carries; null for none, or for two pairs. */
function oneAmount(accents: readonly AccentAmounts[]): AccentAmounts | null {
  const [first] = accents;
  if (!first) return null;
  const same = accents.every((a) => a.velocity === first.velocity && a.mod === first.mod);
  return same ? { velocity: first.velocity, mod: first.mod } : null;
}

/** A region's written notes, each accent written as `accent` where the Roll plays it back, else baked. */
export function settleAccents(written: readonly WrittenNote[]): AccentedNotes {
  const shared = rollSharedOnsets(written.map(({ note }) => note));
  const writable = written.filter(({ note, accent }) => accent && !shared.has(note.tick));
  const accent = oneAmount(writable.map((w) => w.accent!));
  const notes = written.map(({ note, accent: played, plain }): BounceNote => {
    if (!played) return note;
    if (accent && !shared.has(note.tick)) return { ...note, velocity: plain, accent: true };
    return { ...note, marks: { ...note.marks, accentMod: played.mod !== 0 } };
  });
  return { notes, accent };
}
