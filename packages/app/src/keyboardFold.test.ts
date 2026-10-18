/**
 * The keyboard fold's model (windsor#918, record `2026-10-18-keyboard-fold`):
 * the set at a tick, the folded keys of the record's table, the rows, the
 * range's top, the home row and the MIDI judge's grace window, all on the
 * record's demo song: A minor, four bars of A min, F maj, C maj and G 7.
 */
import { describe, expect, it } from 'vitest';

import type { ChordSize, Harmony, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD, tickLoopOf } from '@windsor/engine';
import {
  foldSetAt,
  foldSlots,
  foldedKeys,
  homeRowNote,
  passes,
  type FoldClock,
  type FoldSet,
  type FoldSong,
} from './keyboardFold';
import { HOME_ROW } from './keyboardFoldTables';

const BAR = 96;
const SONG = 4 * BAR;
const A = 9;
const B = 11;

const event = (
  start: number,
  degree: number,
  size: ChordSize = CHORD_SIZE_TRIAD,
): HarmonyEvent => ({
  start,
  duration: BAR,
  degree,
  size,
});

/** The demo song's harmony: A min, F maj, C maj, G 7, one bar each. */
const DEMO: Harmony = {
  root: A,
  scale: 'naturalMinor',
  events: [event(0, 0), event(BAR, 5), event(2 * BAR, 2), event(3 * BAR, 6, CHORD_SIZE_SEVENTH)],
};
const NO_CHORDS: Harmony = { ...DEMO, events: [] };

const notes = (set: FoldSet, octave = 3, octaves = 2, rows = 1): number[][] =>
  foldedKeys(set, { octave, octaves, rows }).rows.map((row) => row.map((key) => key.note));

describe('the set at a tick', () => {
  it('is the scale for Scale, at any tick', () => {
    expect(foldSetAt('scale', DEMO, SONG, 0)).toEqual({
      rootPc: A,
      firstPc: A,
      steps: [0, 2, 3, 5, 7, 8, 10],
    });
    expect(foldSetAt('scale', DEMO, SONG, 200)).toEqual(foldSetAt('scale', DEMO, SONG, 0));
  });

  it('is the chord at the tick for Chord, its root first', () => {
    expect(foldSetAt('chord', DEMO, SONG, 0)).toEqual({ rootPc: A, firstPc: A, steps: [0, 3, 7] });
    expect(foldSetAt('chord', DEMO, SONG, 96)).toEqual({ rootPc: 5, firstPc: 5, steps: [0, 4, 7] });
    expect(foldSetAt('chord', DEMO, SONG, 300).steps).toEqual([0, 4, 7, 10]);
  });

  it('is the scale for Chord when the song has no harmony events', () => {
    expect(foldSetAt('chord', NO_CHORDS, SONG, 96)).toEqual(foldSetAt('scale', DEMO, SONG, 96));
  });

  it('starts on the first tone above a root the set leaves out', () => {
    const custom: Harmony = { root: 0, scale: [2, 5, 9], events: [] };
    expect(foldSetAt('scale', custom, SONG, 0)).toEqual({
      rootPc: 0,
      firstPc: 2,
      steps: [0, 3, 7],
    });
  });
});

describe('the folded keys: the record’s table at octave 3, two octaves', () => {
  it('A minor: 15 keys, 45 to 69, labelled A2', () => {
    const set = foldSetAt('scale', DEMO, SONG, 0);
    expect(notes(set)).toEqual([[45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69]]);
    const keys = foldedKeys(set, { octave: 3, octaves: 2, rows: 1 });
    expect(keys.label).toBe('A2');
    expect(keys.rows[0]?.map((key) => key.name).join(' ')).toBe('A B C D E F G A B C D E F G A');
    expect(keys.rows[0]?.filter((key) => key.root).map((key) => key.note)).toEqual([45, 57, 69]);
    expect(keys.rows[0]?.some((key) => key.outOfRange)).toBe(false);
  });

  it('A minor pentatonic: 11 keys', () => {
    const set = foldSetAt('scale', { ...DEMO, scale: 'pentatonicMinor' }, SONG, 0);
    expect(notes(set)).toEqual([[45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69]]);
  });

  it('A min: 7 keys', () => {
    expect(notes(foldSetAt('chord', DEMO, SONG, 0))).toEqual([[45, 48, 52, 57, 60, 64, 69]]);
  });

  it('F maj: 7 keys, 41 to 65, labelled F2', () => {
    const set = foldSetAt('chord', DEMO, SONG, BAR);
    expect(notes(set)).toEqual([[41, 45, 48, 53, 57, 60, 65]]);
    expect(foldedKeys(set, { octave: 3, octaves: 2, rows: 1 }).label).toBe('F2');
  });

  it('G 7: 9 keys, 43 to 67', () => {
    expect(notes(foldSetAt('chord', DEMO, SONG, 3 * BAR))).toEqual([
      [43, 47, 50, 53, 55, 59, 62, 65, 67],
    ]);
  });

  it('labels root C with [2, 5, 9] D2, and root B with it C#3', () => {
    const atC = foldSetAt('scale', { root: 0, scale: [2, 5, 9], events: [] }, SONG, 0);
    const keys = foldedKeys(atC, { octave: 3, octaves: 2, rows: 1 });
    expect(keys.label).toBe('D2');
    expect(keys.rows[0]?.map((key) => key.note)).toEqual([38, 41, 45, 50, 53, 57, 62]);
    expect(keys.rows[0]?.some((key) => key.root)).toBe(false);
    const atB = foldSetAt('scale', { root: B, scale: [2, 5, 9], events: [] }, SONG, 0);
    expect(foldedKeys(atB, { octave: 3, octaves: 2, rows: 1 }).label).toBe('C#3');
  });
});

describe('two rows', () => {
  it.each([
    [2, 'scale', 0],
    [4, 'scale', 0],
    [2, 'chord', 3 * BAR],
  ] as const)('%i octaves of %s: each row ends on its first key’s note', (octaves, fold, tick) => {
    const set = foldSetAt(fold, DEMO, SONG, tick);
    const rows = notes(set, 3, octaves, 2);
    const perRow = octaves / 2;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveLength(foldSlots(set.steps.length, { octaves, rows: 2 }));
      expect(row.at(-1)).toBe((row[0] ?? 0) + 12 * perRow);
    }
    expect(rows[1]?.[0]).toBe(rows[0]?.at(-1));
  });
});

describe('the slots a pick holds', () => {
  it('is (octaves a row × tones) + 1', () => {
    expect(foldSlots(7, { octaves: 2, rows: 1 })).toBe(15);
    expect(foldSlots(7, { octaves: 4, rows: 2 })).toBe(15);
    expect(foldSlots(5, { octaves: 4, rows: 1 })).toBe(21);
    expect(foldSlots(3, { octaves: 1, rows: 1 })).toBe(4);
  });
});

describe('the range’s top, at octave 8', () => {
  const bMinor: Harmony = { root: B, scale: 'naturalMinor', events: [event(0, 0)] };

  it('two octaves of B minor run 107 to 131, with 129 and 131 out of range', () => {
    const keys = foldedKeys(foldSetAt('scale', bMinor, SONG, 0), {
      octave: 8,
      octaves: 2,
      rows: 1,
    });
    const row = keys.rows[0] ?? [];
    expect(row[0]?.note).toBe(107);
    expect(row.at(-1)?.note).toBe(131);
    expect(row.filter((key) => key.outOfRange).map((key) => key.note)).toEqual([129, 131]);
  });

  it("under B min, the home row’s k to ' are D134 to D146 and play nothing", () => {
    const set = foldSetAt('chord', bMinor, SONG, 0);
    expect(notes(set, 8)).toEqual([[107, 110, 114, 119, 122, 126, 131]]);
    const played = HOME_ROW.map((letter) => homeRowNote(letter, set, 8));
    expect(played).toEqual([107, 110, 114, 119, 122, 126, null, null, null, null, null]);
  });
});

describe('the home row', () => {
  it("plays A minor at A2 from a to '", () => {
    const set = foldSetAt('scale', DEMO, SONG, 0);
    expect(HOME_ROW.map((letter) => homeRowNote(letter, set, 3))).toEqual([
      45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62,
    ]);
  });

  it("runs on past the shown keys: A min on two octaves, k is C5 and ' C6", () => {
    const set = foldSetAt('chord', DEMO, SONG, 0);
    expect(['k', 'l', ';', "'"].map((letter) => homeRowNote(letter, set, 3))).toEqual([
      72, 76, 81, 84,
    ]);
  });

  it('maps the other note letters to nothing', () => {
    const set = foldSetAt('scale', DEMO, SONG, 0);
    for (const letter of ['w', 'e', 't', 'y', 'u', 'o', 'p', 'z', 'x']) {
      expect(homeRowNote(letter, set, 3)).toBeNull();
    }
  });
});

describe('the MIDI judge', () => {
  const F = 53;
  const B3 = 59;
  const E = 64;
  const G = 55;
  const chord: FoldSong = { fold: 'chord', harmony: DEMO, songTicks: SONG };
  const running: FoldClock = { running: true, standingTick: 0, loop: null };

  it('keeps an F stamped at tick 95 before F maj at 96', () => {
    expect(passes(F, 95, chord, running)).toBe(true);
  });

  it('drops a B stamped at tick 95: in neither A min nor F maj', () => {
    expect(passes(B3, 95, chord, running)).toBe(false);
  });

  it('drops an F stamped at tick 88: the window is 89 to 94, before the change', () => {
    expect(passes(F, 88, chord, running)).toBe(false);
  });

  it('walks the loop: at 191 in a loop of 0 to 192, an E is kept and a G dropped', () => {
    const transport = { bpm: 120, bars: 4, loop: { start: 0, end: 2 * BAR, on: true } };
    const looping: FoldClock = { running: true, standingTick: 0, loop: tickLoopOf(transport) };
    expect(passes(E, 191, chord, looping)).toBe(true);
    expect(passes(G, 191, chord, looping)).toBe(false);
    // With no loop the window reaches C maj at 192, which holds G.
    expect(passes(G, 191, chord, running)).toBe(true);
  });

  it('stopped: the set at the standing tick, with no window', () => {
    const stoppedAt = (standingTick: number): FoldClock => ({
      running: false,
      standingTick,
      loop: null,
    });
    expect(passes(F, 95, chord, stoppedAt(95))).toBe(false);
    expect(passes(F, 0, chord, stoppedAt(96))).toBe(true);
    expect(passes(E, 96, chord, stoppedAt(0))).toBe(true);
  });

  it('judges Scale, and Chord with no chords, against the scale', () => {
    const scale: FoldSong = { fold: 'scale', harmony: DEMO, songTicks: SONG };
    const bare: FoldSong = { fold: 'chord', harmony: NO_CHORDS, songTicks: SONG };
    for (const song of [scale, bare]) {
      expect(passes(B3, 95, song, running)).toBe(true);
      expect(passes(61, 95, song, running)).toBe(false);
    }
  });

  it('passes every note when the part is not folded', () => {
    expect(passes(61, 95, { ...chord, fold: 'off' }, running)).toBe(true);
  });
});
