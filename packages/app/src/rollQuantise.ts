/**
 * The Roll's Quantise (record `2026-10-09-roll-recording` decision 10,
 * windsor#661), without the DOM: the onsets of the chosen notes snapped to
 * the nearest step of the device's Snap.
 *
 * The steps count from the region's local tick 0, and a tie rounds up
 * (later). A note inside the loop that rounds onto the loop's end, or past
 * it in a loop that is not a whole number of steps, moves to the loop's
 * start. A note at or past the loop (parked and silent, record
 * `2026-10-04-roll-sequencer` decision 3) is quantised too, with no wrap;
 * one that would round to `ROLL_LOOP_TICKS_MAX` or beyond rounds down.
 * Lengths, pitches and velocities are kept. The list is then settled
 * (`rollEdits.ts` `settle`) with no preference for the selection: of two
 * same-pitch notes landing on one tick the first by original onset is kept,
 * and a note that now runs into the next onset at its pitch is trimmed.
 */
import { ROLL_LOOP_TICKS_MAX, type RollNote, type RollSequencerConfig } from '@windsor/engine';
import { type RollEdit, type RollFrame, settle } from './rollEdits';

/** `tick` (never negative) to the nearest whole `snap`, a tie rounding up, as `Math.round` does. */
export const nearestSnap = (tick: number, snap: number): number => Math.round(tick / snap) * snap;

/** Where Quantise puts `tick`: wrapped inside the loop, kept under the roll's cap past it. */
function quantisedTick(tick: number, frame: Pick<RollFrame, 'loop' | 'snap'>): number {
  const { loop, snap } = frame;
  const near = nearestSnap(tick, snap);
  if (tick < loop) return near >= loop ? 0 : near;
  return near >= ROLL_LOOP_TICKS_MAX ? Math.floor(tick / snap) * snap : near;
}

/**
 * The notes at `selected`, or every note when none is selected, with their
 * onsets quantised to `frame.snap`, settled with the first note winning a
 * collision and the selection mapped onto the notes that survive. Null when
 * no onset moves, so a press on notes already on the grid writes no undo
 * step.
 */
export function quantiseNotes(
  config: RollSequencerConfig,
  selected: readonly number[],
  frame: Pick<RollFrame, 'loop' | 'snap'>,
): RollEdit | null {
  const chosen = new Set(selected);
  const every = chosen.size === 0;
  // The stored list is sorted by onset, so its order is the original onsets' order.
  const notes = config.notes.map((note, i): RollNote => {
    if (!every && !chosen.has(i)) return note;
    const tick = quantisedTick(note.tick, frame);
    return tick === note.tick ? note : { ...note, tick };
  });
  if (notes.every((note, i) => note === config.notes[i])) return null;
  return settle({ config: { ...config, notes }, selected }, { preferSelected: false });
}
