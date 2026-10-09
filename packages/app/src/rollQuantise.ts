/**
 * The Roll's Quantise (record `2026-10-09-roll-recording` decision 10,
 * windsor#661), without the DOM: the onsets of the chosen notes snapped to
 * the nearest step of the device's Snap.
 *
 * The steps count from the region's local tick 0, and a tie rounds up
 * (later). A note that rounds onto the loop's end, or past it in a loop that
 * is not a whole number of steps, moves to the loop's start. A note at or
 * past the loop is kept where it is: it is parked and silent (record
 * `2026-10-04-roll-sequencer` decision 3). Lengths, pitches and velocities
 * are kept; the device's commit then settles the list as every edit is
 * settled (`rollEdits.ts` `settle`), which drops a second same-pitch note
 * on one tick and trims a note that now runs into the next onset at its
 * pitch.
 */
import type { RollSequencerConfig } from '@windsor/engine';
import type { RollEdit, RollFrame } from './rollEdits';

/** `tick` (never negative) to the nearest whole `snap`, a tie rounding up, as `Math.round` does. */
export const nearestSnap = (tick: number, snap: number): number => Math.round(tick / snap) * snap;

/**
 * The notes at `selected`, or every note when none is selected, with their
 * onsets quantised to `frame.snap` inside `frame.loop`. Every note keeps its
 * index, so the selection is returned as given and follows the moved notes
 * through the settle, as a move's does. Null when no onset moves, so a
 * press on notes already on the grid writes no undo step.
 */
export function quantiseNotes(
  config: RollSequencerConfig,
  selected: readonly number[],
  frame: Pick<RollFrame, 'loop' | 'snap'>,
): RollEdit | null {
  const chosen = new Set(selected);
  const every = chosen.size === 0;
  const notes = config.notes.map((note, i) => {
    if ((!every && !chosen.has(i)) || note.tick >= frame.loop) return note;
    const tick = nearestSnap(note.tick, frame.snap);
    const wrapped = tick >= frame.loop ? 0 : tick;
    return wrapped === note.tick ? note : { ...note, tick: wrapped };
  });
  if (notes.every((note, i) => note === config.notes[i])) return null;
  return { config: { ...config, notes }, selected };
}
