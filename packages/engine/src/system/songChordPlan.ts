/**
 * Bloom's Song chord against the song (windsor#729): the song's length the
 * chord follower plans over, and which live edits re-plan it. Split from
 * `audioSystem.ts`, which builds the follower and calls these.
 */
import type { BloomChordFollower } from '../inserts/bloomChordFollower';
import { songTicks } from '../sequencing/meter';
import type { Arrangement } from '../song/arrangement';
import type { DocumentPartial } from '../song/arrangementDocument';

/** The song's length in ticks, by its bars and meter. */
export const songLength = ({ transport }: Pick<Arrangement, 'transport'>): number =>
  songTicks(transport.bars, transport.meter);

/**
 * Re-plan Song chord after a live edit, by what it touched (windsor#729): a
 * harmony or transport edit rebuilds the timeline from one read of the
 * arrangement (a clone, so never on other edits); a part, group, master or
 * return edit may have switched a bloom to Song chord, which needs the
 * changes already issued, and clones nothing.
 */
export function replanChords(
  chords: BloomChordFollower,
  partial: DocumentPartial,
  arrangement: () => Arrangement,
): void {
  if (partial.harmony !== undefined || partial.transport !== undefined) {
    const song = arrangement();
    chords.setSong(song.harmony, songLength(song));
  } else if (
    partial.parts !== undefined ||
    partial.groups !== undefined ||
    partial.master !== undefined ||
    partial.returns !== undefined
  ) {
    chords.replan();
  }
}
