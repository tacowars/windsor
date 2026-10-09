/**
 * The Roll's Quantise (windsor#661, record `2026-10-09-roll-recording`
 * decision 10): the rounding at each Snap, the selection, the loop's end,
 * and the collisions the commit's settle resolves.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { type RollEdit, settle } from './rollEdits';
import { quantiseNotes } from './rollQuantise';

const BAR = 96;
const FRAME = { loop: BAR, snap: 6 };

const roll = (notes: RollNote[]): RollSequencerConfig => ({ loopTicks: BAR, notes });
const n = (tick: number, ticks: number, pitch: number): RollNote => ({ tick, ticks, pitch });
const ticksOf = (config: RollSequencerConfig): number[] => config.notes.map((note) => note.tick);

/** The quantise of `config`, which these fixtures always move. */
function quantised(
  config: RollSequencerConfig,
  selected: readonly number[],
  frame: { loop: number; snap: number } = FRAME,
): RollEdit {
  const edit = quantiseNotes(config, selected, frame);
  if (!edit) throw new Error('nothing moved');
  return edit;
}

describe('quantiseNotes', () => {
  it('snaps every onset to the nearest step when none is selected, a tie rounding up', () => {
    const config = roll([n(2, 3, 60), n(3, 3, 62), n(4, 3, 64), n(8, 3, 65)]);
    const edit = quantised(config, []);
    expect(ticksOf(edit.config)).toEqual([0, 6, 6, 6]);
    expect(edit.config.notes.map((note) => note.ticks)).toEqual([3, 3, 3, 3]);
    expect(edit.selected).toEqual([]);
  });

  it('moves only the selected notes, and the selection follows them through the settle', () => {
    const config = roll([n(2, 3, 60), n(3, 3, 62), n(4, 3, 64), n(8, 3, 65)]);
    const edit = settle(quantised(config, [1, 3]));
    expect(edit.config.notes).toEqual([n(2, 3, 60), n(4, 3, 64), n(6, 3, 62), n(6, 3, 65)]);
    expect(edit.selected).toEqual([2, 3]);
  });

  it('moves a note rounding onto the loop’s end to its start, and leaves a note past the loop', () => {
    const config = roll([n(BAR - 1, 1, 60), n(BAR + 1, 3, 62)]);
    expect(ticksOf(quantised(config, []).config)).toEqual([0, BAR + 1]);
  });

  it('rounds to the triplet steps and to 1/32', () => {
    const config = roll([n(3, 1, 60), n(4, 1, 62), n(5, 1, 64), n(13, 1, 65)]);
    expect(ticksOf(quantised(config, [], { loop: BAR, snap: 8 }).config)).toEqual([0, 8, 8, 16]);
    expect(ticksOf(quantised(config, [], { loop: BAR, snap: 4 }).config)).toEqual([4, 4, 4, 12]);
    expect(ticksOf(quantised(config, [], { loop: BAR, snap: 3 }).config)).toEqual([3, 3, 6, 12]);
  });

  it('keeps the first of two C4s landing on one tick, trims an E4 that runs into the next, and leaves the original whole', () => {
    const notes = [n(0, 8, 64), n(5, 2, 60), n(7, 3, 60), n(8, 6, 64)];
    const config = roll(notes.map((note) => ({ ...note })));
    const edit = settle(quantised(config, []));
    expect(edit.config.notes).toEqual([n(0, 6, 64), n(6, 2, 60), n(6, 6, 64)]);
    // Undo restores the stored config, which the quantise never touched.
    expect(config.notes).toEqual(notes);
  });

  it('moves nothing when every onset is on the grid, so a press writes no undo step', () => {
    expect(quantiseNotes(roll([n(0, 3, 60), n(6, 3, 62)]), [], FRAME)).toBeNull();
    expect(quantiseNotes(roll([]), [], FRAME)).toBeNull();
  });
});
