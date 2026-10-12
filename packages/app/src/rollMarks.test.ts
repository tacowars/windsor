/**
 * A Roll note's accent and ratchet as the lane draws and edits them
 * (windsor#754; record `2026-10-12-roll-note-accent-and-ratchet` decisions
 * 5 to 8): the chord and short-note rules, the click's next state and its
 * write for one note or a selection, the cells' place, and the hits' cuts.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import { RATCHET_MAX, ROLL_RATCHET_MIN_TICKS, rollSharedOnsets } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  canAccent,
  canRatchet,
  cellBox,
  cellState,
  isRun,
  markClick,
  nextRatchet,
  noteMarks,
} from './rollMarks';
import type { RollInstance } from './rollRepeats';

const roll = (notes: RollNote[]): RollSequencerConfig => ({ loopTicks: 96, notes });
const n = (
  tick: number,
  ticks: number,
  pitch: number,
  extra: Partial<RollNote> = {},
): RollNote => ({
  tick,
  ticks,
  pitch,
  ...extra,
});
const at = (
  index: number,
  start: number,
  ticks: number,
  pass = 0,
  parked = false,
): RollInstance => ({
  index,
  start,
  ticks,
  pass,
  parked,
});

/** A line, a chord at tick 24, and a 2-tick note at 48. */
const NOTES = [n(0, 6, 60), n(24, 6, 57), n(24, 6, 60), n(48, 2, 62), n(60, 3, 64)];
const SHARED = rollSharedOnsets(NOTES);

describe('which notes take a mark', () => {
  it('takes no accent or ratchet on a chord’s notes', () => {
    expect(canAccent(NOTES[0] as RollNote, SHARED)).toBe(true);
    expect(canAccent(NOTES[1] as RollNote, SHARED)).toBe(false);
    expect(canRatchet(NOTES[2] as RollNote, SHARED)).toBe(false);
  });

  it('takes no ratchet under a 1/32: a 2-tick note no, a 3-tick note yes', () => {
    expect(ROLL_RATCHET_MIN_TICKS).toBe(3);
    expect(canRatchet(NOTES[3] as RollNote, SHARED)).toBe(false);
    expect(canAccent(NOTES[3] as RollNote, SHARED)).toBe(true);
    expect(canRatchet(NOTES[4] as RollNote, SHARED)).toBe(true);
  });
});

describe('nextRatchet', () => {
  it('steps ×1 → ×2 → ×3 → ×4 → ×1, and back with Shift', () => {
    expect(RATCHET_MAX).toBe(4);
    expect([1, 2, 3, 4].map((r) => nextRatchet(r, false))).toEqual([2, 3, 4, 1]);
    expect([1, 2, 3, 4].map((r) => nextRatchet(r, true))).toEqual([4, 1, 2, 3]);
  });
});

describe('markClick', () => {
  it('toggles one note’s accent, writing a plain note with no key', () => {
    const on = markClick(roll(NOTES), [], { lane: 'acc', index: 0, back: false });
    expect(on?.config.notes[0]).toEqual({ tick: 0, ticks: 6, pitch: 60, accent: true });
    const off = markClick(on?.config as RollSequencerConfig, [], {
      lane: 'acc',
      index: 0,
      back: false,
    });
    expect(off?.config.notes[0]).toEqual({ tick: 0, ticks: 6, pitch: 60 });
  });

  it('steps one note’s ratchet, back to no key at ×1', () => {
    const config = roll([n(0, 6, 60, { ratchet: 4 })]);
    const up = markClick(config, [], { lane: 'rat', index: 0, back: false });
    expect(up?.config.notes[0]).toEqual({ tick: 0, ticks: 6, pitch: 60 });
    const back = markClick(config, [], { lane: 'rat', index: 0, back: true });
    expect(back?.config.notes[0]).toEqual({ tick: 0, ticks: 6, pitch: 60, ratchet: 3 });
  });

  it('keeps the velocity and the other mark', () => {
    const config = roll([n(0, 6, 60, { velocity: 0.5, ratchet: 2 })]);
    const edit = markClick(config, [], { lane: 'acc', index: 0, back: false });
    expect(edit?.config.notes[0]).toEqual({
      tick: 0,
      ticks: 6,
      pitch: 60,
      velocity: 0.5,
      ratchet: 2,
      accent: true,
    });
  });

  it('gives a selected group the clicked note’s new state, skipping chords and short notes', () => {
    const config = roll(NOTES.map((note, i) => (i === 4 ? { ...note, ratchet: 3 } : note)));
    const all = [0, 1, 2, 3, 4];
    const rat = markClick(config, all, { lane: 'rat', index: 0, back: false });
    expect(rat?.config.notes.map((note) => note.ratchet)).toEqual([
      2,
      undefined,
      undefined,
      undefined,
      2,
    ]);
    expect(rat?.selected).toEqual(all);
    const acc = markClick(config, all, { lane: 'acc', index: 3, back: false });
    expect(acc?.config.notes.map((note) => note.accent)).toEqual([
      true,
      undefined,
      undefined,
      true,
      true,
    ]);
  });

  it('sets only the clicked note when it is not selected', () => {
    const edit = markClick(roll(NOTES), [3, 4], { lane: 'acc', index: 0, back: false });
    expect(edit?.config.notes.map((note) => note.accent === true)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(edit?.selected).toEqual([3, 4]);
  });

  it('writes nothing for a chord’s note or a short note’s ratchet', () => {
    expect(markClick(roll(NOTES), [], { lane: 'acc', index: 1, back: false })).toBeNull();
    expect(markClick(roll(NOTES), [3, 4], { lane: 'rat', index: 3, back: false })).toBeNull();
    expect(markClick(roll(NOTES), [], { lane: 'rat', index: 9, back: false })).toBeNull();
  });
});

describe('the cells', () => {
  it('draws no cell on a chord’s note, a parked note or a run of repeats', () => {
    const line = NOTES[0] as RollNote;
    expect(cellState('acc', line, at(0, 0, 6), SHARED)).toBe('live');
    expect(cellState('acc', line, at(0, 96, 6, 1), SHARED)).toBe('live');
    expect(cellState('acc', NOTES[1] as RollNote, at(1, 24, 6), SHARED)).toBe('none');
    expect(cellState('rat', NOTES[2] as RollNote, at(2, 24, 6), SHARED)).toBe('none');
    expect(cellState('acc', line, at(0, 0, 6, 0, true), SHARED)).toBe('none');
    expect(isRun(line, at(0, 96, 102, 1))).toBe(true);
    expect(cellState('rat', line, at(0, 96, 102, 1), SHARED)).toBe('none');
  });

  it('draws a 2-tick note’s Rat cell disabled and its Acc cell live; a 3-tick note’s live', () => {
    expect(cellState('rat', NOTES[3] as RollNote, at(3, 48, 2), SHARED)).toBe('disabled');
    expect(cellState('acc', NOTES[3] as RollNote, at(3, 48, 2), SHARED)).toBe('live');
    expect(cellState('rat', NOTES[4] as RollNote, at(4, 60, 3), SHARED)).toBe('live');
  });

  it('places an Acc square under the onset and a Rat cell as wide as the note', () => {
    expect(cellBox('acc', { leftPx: 40, widthPx: 30 })).toEqual({ left: 41, width: 14 });
    expect(cellBox('acc', { leftPx: 40, widthPx: 6 })).toEqual({ left: 41, width: 8 });
    expect(cellBox('rat', { leftPx: 40, widthPx: 30 })).toEqual({ left: 41, width: 28 });
    expect(cellBox('rat', { leftPx: 40, widthPx: 6 })).toEqual({ left: 41, width: 10 });
  });
});

describe('noteMarks', () => {
  const looping = { loopTicks: 96, shared: new Set<number>() };

  it('cuts a ratchet evenly across the note, its ghost repeats too', () => {
    const note = n(0, 12, 60, { accent: true, ratchet: 3 });
    expect(noteMarks(note, at(0, 0, 12), looping)).toEqual({ accent: true, cuts: [4, 8] });
    expect(noteMarks(note, at(0, 96, 12, 1), looping)).toEqual({ accent: true, cuts: [4, 8] });
  });

  it('spaces the hits over the length the loop leaves, as the engine plays them', () => {
    const note = n(90, 12, 60, { ratchet: 2 });
    expect(noteMarks(note, at(0, 90, 6), looping).cuts).toEqual([3]);
    // Cut to two ticks by the loop: one hit, no cut.
    expect(noteMarks(n(94, 12, 60, { ratchet: 4 }), at(0, 94, 2), looping).cuts).toEqual([]);
  });

  it('drops a cut past where the region ends the drawn note', () => {
    expect(noteMarks(n(0, 12, 60, { ratchet: 4 }), at(0, 0, 7), looping).cuts).toEqual([3, 6]);
  });

  it('marks nothing on a chord’s note or a run', () => {
    const note = n(24, 6, 57, { accent: true, ratchet: 2 });
    expect(noteMarks(note, at(1, 24, 6), { loopTicks: 96, shared: SHARED })).toEqual({
      accent: false,
      cuts: [],
    });
    expect(noteMarks(n(0, 6, 60, { accent: true }), at(0, 96, 102, 1), looping)).toEqual({
      accent: false,
      cuts: [],
    });
  });
});
