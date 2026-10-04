/**
 * The Roll's edits (windsor#603 decision 7): add, move, resize, delete,
 * box-select, velocity and the loop, at the loop's edges and on an empty
 * roll, and the settle a write goes through.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import { ROLL_NOTES_MAX } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  addNote,
  boxSelect,
  deleteNotes,
  loopStep,
  loopStops,
  moveNotes,
  nearestLoop,
  resizeNotes,
  setLoop,
  setVelocity,
  settle,
  stemVelocity,
  stepLoop,
} from './rollEdits';

const BAR = 96;
const SIXTEENTH = 6;
/** A 4-bar loop in a 4-bar region at 1/16. */
const FRAME = { loop: 4 * BAR, region: 4 * BAR, snap: SIXTEENTH };

const roll = (notes: RollNote[], loopTicks = FRAME.loop): RollSequencerConfig => ({
  loopTicks,
  notes,
});
const n = (tick: number, ticks: number, pitch: number, velocity?: number): RollNote =>
  velocity === undefined ? { tick, ticks, pitch } : { tick, ticks, pitch, velocity };

/** Fold's rows for an A minor triad and the C above: top down. */
const FOLD_ROWS = [72, 64, 60, 57];
const CHORD = [n(24, 12, 57), n(24, 12, 60), n(24, 12, 64)];

describe('addNote', () => {
  it('floors the onset to the snap, takes the last length, and selects the new note alone', () => {
    const edit = addNote(roll([n(0, 6, 60)]), { tick: 29.5, pitch: 64, lastTicks: 12 }, FRAME);
    expect(edit?.config.notes.at(-1)).toEqual({ tick: 24, ticks: 12, pitch: 64, velocity: 0.8 });
    expect(edit?.selected).toEqual([1]);
  });

  it('at Off lands on any tick', () => {
    const edit = addNote(roll([]), { tick: 29.5, pitch: 64, lastTicks: 6 }, { ...FRAME, snap: 1 });
    expect(edit?.config.notes[0]?.tick).toBe(29);
  });

  it('in the loop’s last sixteenth is cut to the loop’s end', () => {
    const at = { tick: FRAME.loop - 3, pitch: 60, lastTicks: 24 };
    expect(addNote(roll([]), at, FRAME)?.config.notes[0]).toMatchObject({ tick: 378, ticks: 6 });
    const off = addNote(roll([]), at, { ...FRAME, snap: 1 });
    expect(off?.config.notes[0]).toMatchObject({ tick: 381, ticks: 3 });
  });

  it('adds nothing at or past the loop', () => {
    const at = { tick: FRAME.loop, pitch: 60, lastTicks: 6 };
    expect(addNote(roll([]), at, FRAME)).toBeNull();
  });

  it('adds nothing to a roll already holding ROLL_NOTES_MAX notes, so none is lost', () => {
    const full = Array.from({ length: ROLL_NOTES_MAX }, (_, i) =>
      n(i % FRAME.loop, 1, 24 + Math.floor(i / FRAME.loop)),
    );
    expect(addNote(roll(full), { tick: 0, pitch: 100, lastTicks: 6 }, FRAME)).toBeNull();
    const less = roll(full.slice(1));
    expect(addNote(less, { tick: 0, pitch: 100, lastTicks: 6 }, FRAME)?.config.notes).toHaveLength(
      ROLL_NOTES_MAX,
    );
  });
});

describe('moveNotes', () => {
  const frame = { ...FRAME, rows: FOLD_ROWS };

  it('moves a chord up two folded rows as one block, keeping its shape', () => {
    const notes = [n(0, 6, 72), ...CHORD];
    const edit = moveNotes(roll(notes), [1, 2, 3], { dTicks: 0, dRows: -2 }, frame);
    // 57 → 64 would leave the rows for 64 and 60, so the block stops one row up.
    expect(edit.config.notes.map((note) => note.pitch)).toEqual([72, 60, 64, 72]);
  });

  it('steps through the rows on show, not semitones', () => {
    const edit = moveNotes(roll([n(0, 6, 57)]), [0], { dTicks: 0, dRows: -1 }, frame);
    expect(edit.config.notes[0]?.pitch).toBe(60);
  });

  it('moves time by whole snaps and stops at the loop’s start and end', () => {
    const one = moveNotes(roll(CHORD), [0, 1, 2], { dTicks: 8, dRows: 0 }, frame);
    expect(one.config.notes.map((note) => note.tick)).toEqual([30, 30, 30]);
    const back = moveNotes(roll(CHORD), [0, 1, 2], { dTicks: -500, dRows: 0 }, frame);
    expect(back.config.notes.map((note) => note.tick)).toEqual([0, 0, 0]);
    const on = moveNotes(roll(CHORD), [0, 1, 2], { dTicks: 500, dRows: 0 }, frame);
    expect(on.config.notes.map((note) => [note.tick, note.ticks])).toEqual([
      [378, 6],
      [378, 6],
      [378, 6],
    ]);
  });

  it('two notes dragged left together stop with their spacing intact', () => {
    const notes = [n(0, 6, 60), n(24, 6, 64)];
    const edit = moveNotes(roll(notes), [0, 1], { dTicks: -48, dRows: 0 }, frame);
    expect(edit.config.notes.map((note) => note.tick)).toEqual([0, 24]);
  });

  it('leaves a note past the loop parked on a pitch-only drag, and brings it inside on a move in time', () => {
    const parked = roll([n(300, 12, 60)], 2 * BAR);
    const loop2 = { ...frame, loop: 2 * BAR };
    const pitch = moveNotes(parked, [0], { dTicks: 0, dRows: -1 }, loop2);
    expect(pitch.config.notes[0]).toEqual(n(300, 12, 64));
    const time = moveNotes(parked, [0], { dTicks: -6, dRows: 0 }, loop2);
    expect(time.config.notes[0]).toEqual(n(186, 6, 60));
  });

  it('brings two parked notes on one pitch inside as a block, never onto one tick', () => {
    const parked = roll([n(200, 12, 60), n(250, 12, 60)], 2 * BAR);
    const loop2 = { ...frame, loop: 2 * BAR };
    for (const dTicks of [-6, 6, 300]) {
      const edit = settle(moveNotes(parked, [0, 1], { dTicks, dRows: 0 }, loop2));
      expect(edit.config.notes).toEqual([n(136, 12, 60), n(186, 6, 60)]);
      expect(edit.selected).toEqual([0, 1]);
    }
  });

  it('stops a block of parked notes longer than the loop with its first note at 0, the rest parked', () => {
    const parked = roll([n(100, 12, 60), n(250, 12, 60)], BAR);
    const edit = settle(
      moveNotes(parked, [0, 1], { dTicks: -6, dRows: 0 }, { ...frame, loop: BAR }),
    );
    expect(edit.config.notes).toEqual([n(0, 12, 60), n(150, 12, 60)]);
  });

  it('leaves the notes it did not select, and an empty selection moves nothing', () => {
    const notes = [n(0, 6, 60), n(24, 6, 64)];
    const edit = moveNotes(roll(notes), [], { dTicks: 24, dRows: 1 }, frame);
    expect(edit.config.notes).toEqual(notes);
  });
});

describe('resizeNotes', () => {
  it('resizes the selection by whole snaps, and the anchor’s length is the next', () => {
    const notes = [n(0, 12, 60), n(0, 6, 64)];
    const { edit, lastTicks } = resizeNotes(roll(notes), [0, 1], 13, { ...FRAME, anchor: 0 });
    expect(edit.config.notes.map((note) => note.ticks)).toEqual([24, 18]);
    expect(lastTicks).toBe(24);
  });

  it('stops at one snap, and at the loop’s end', () => {
    const shrink = resizeNotes(roll([n(0, 12, 60)]), [0], -100, { ...FRAME, anchor: 0 });
    expect(shrink.lastTicks).toBe(SIXTEENTH);
    const grow = resizeNotes(roll([n(360, 12, 60)]), [0], 100, { ...FRAME, anchor: 0 });
    expect(grow.lastTicks).toBe(24);
  });

  it('a note past the loop follows the drag, up to the region’s end', () => {
    const parked = roll([n(300, 12, 60)], 2 * BAR);
    const frame = { ...FRAME, loop: 2 * BAR, anchor: 0 };
    expect(resizeNotes(parked, [0], 24, frame).lastTicks).toBe(36);
    expect(resizeNotes(parked, [0], 500, frame).lastTicks).toBe(FRAME.region - 300);
  });
});

describe('deleteNotes', () => {
  it('deletes the notes and keeps the rest of the selection at their new places', () => {
    const notes = [n(0, 6, 60), n(6, 6, 62), n(12, 6, 64)];
    const edit = deleteNotes(roll(notes), [0], [0, 2]);
    expect(edit.config.notes).toEqual([n(6, 6, 62), n(12, 6, 64)]);
    expect(edit.selected).toEqual([1]);
  });

  it('on an empty roll is an empty roll', () => {
    expect(deleteNotes(roll([]), [0]).config.notes).toEqual([]);
  });
});

describe('boxSelect', () => {
  it('takes the notes on the box’s rows that overlap its ticks', () => {
    const notes = [n(0, 12, 60), n(24, 6, 60), n(6, 6, 64), n(48, 6, 62)];
    expect(boxSelect(notes, { from: 10, to: 30, pitches: new Set([60, 62]) })).toEqual([0, 1]);
    expect(boxSelect([], { from: 0, to: 96, pitches: new Set([60]) })).toEqual([]);
  });
});

describe('setVelocity', () => {
  it('sets the notes at 0.05..1 in steps of 0.01, and 1 leaves no key', () => {
    const notes = [n(0, 6, 60), n(0, 6, 64, 0.5)];
    expect(setVelocity(roll(notes), [1], 0.123).notes[1]).toEqual(n(0, 6, 64, 0.12));
    expect(setVelocity(roll(notes), [0, 1], 0).notes.map((note) => note.velocity)).toEqual([
      0.05, 0.05,
    ]);
    expect(setVelocity(roll(notes), [1], 1.4).notes[1]).toEqual(n(0, 6, 64));
    expect(stemVelocity(0.555)).toBe(0.56);
  });
});

describe('the loop', () => {
  it('stops at whole bars from one bar to the region, and at a short region’s own length', () => {
    expect(loopStops(4 * BAR, BAR)).toEqual([96, 192, 288, 384]);
    expect(loopStops(2.5 * BAR, BAR)).toEqual([96, 192, 240]);
    expect(loopStops(48, BAR)).toEqual([48]);
  });

  it('steps through the stops, held at either end', () => {
    const stops = loopStops(4 * BAR, BAR);
    expect(loopStep(4 * BAR, -1, stops)).toBe(3 * BAR);
    expect(loopStep(4 * BAR, 1, stops)).toBe(4 * BAR);
    expect(loopStep(BAR, -1, stops)).toBe(BAR);
    // A loop under the first stop: − leaves it, + goes to the first bar.
    expect(loopStep(BAR / 2, -1, stops)).toBe(BAR / 2);
    expect(loopStep(BAR / 2, 1, stops)).toBe(BAR);
    expect(nearestLoop(170, stops)).toBe(2 * BAR);
    expect(nearestLoop(-20, stops)).toBe(BAR);
  });

  it('stepLoop never shortens on + nor lengthens on −, judged against the stored loop', () => {
    // A four-bar loop drawn as two in a two-bar region.
    const stored = roll([n(0, 6, 60)], 4 * BAR);
    const at = { loop: 2 * BAR, stops: loopStops(2 * BAR, BAR) };
    expect(stepLoop(stored, 1, at)).toBeNull();
    expect(stepLoop(stored, -1, at)?.loopTicks).toBe(BAR);
    // A half-bar loop in a four-bar region.
    const short = roll([], BAR / 2);
    const four = { loop: BAR / 2, stops: loopStops(4 * BAR, BAR) };
    expect(stepLoop(short, -1, four)).toBeNull();
    expect(stepLoop(short, 1, four)?.loopTicks).toBe(BAR);
  });

  it('shrinking it keeps the notes past it, and growing it back plays them', () => {
    const notes = [n(0, 6, 60), n(2 * BAR + 12, 6, 64)];
    const short = setLoop(roll(notes), 2 * BAR);
    expect(short).toEqual({ loopTicks: 2 * BAR, notes });
    expect(setLoop(short, 4 * BAR)).toEqual(roll(notes));
  });
});

describe('settle', () => {
  it('sorts by onset and pitch and carries the selection with its notes', () => {
    const edit = settle({ config: roll([n(24, 6, 60), n(0, 6, 64), n(0, 6, 60)]), selected: [0] });
    expect(edit.config.notes).toEqual([n(0, 6, 60), n(0, 6, 64), n(24, 6, 60)]);
    expect(edit.selected).toEqual([2]);
  });

  it('keeps the selected of two notes at one onset and pitch, and trims a note running into the next', () => {
    const notes = [n(0, 24, 60, 0.5), n(12, 6, 60), n(12, 6, 60, 0.9)];
    const edit = settle({ config: roll(notes), selected: [2] });
    expect(edit.config.notes).toEqual([n(0, 12, 60, 0.5), n(12, 6, 60, 0.9)]);
    expect(edit.selected).toEqual([1]);
  });

  it('settles an empty roll to itself', () => {
    expect(settle({ config: roll([]), selected: [] })).toEqual({ config: roll([]), selected: [] });
  });
});
