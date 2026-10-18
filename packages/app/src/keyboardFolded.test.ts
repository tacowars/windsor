/**
 * The audition keyboard folded (windsor#919, record `2026-10-18-keyboard-fold`
 * decisions 4 and 5, Decided 4): each key plays its own note, a held note
 * lights every key carrying it, and the record's boundary cases for held
 * fingers — a renamed key under a finger, a triad to a seventh under a
 * finger, and Fold switched while holding — plus the range's top, where a
 * hatched key plays nothing. The keys are `keyboardRig`'s equal fakes, handed
 * to `adoptKeys` with their notes the way a folded build does; `document` is
 * stubbed down to Panic's sweep, as in `keyboard.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Harmony } from '@windsor/engine';
import { Keyboard } from './keyboard';
import { foldSetAt, foldedKeys } from './keyboardFold';
import type { KeysLaid } from './keyboardKeys';
import {
  HEIGHT,
  TOP,
  fakeKeys,
  fakePart,
  foldedRow,
  pointer,
  row,
} from './__fixtures__/keyboardRig';
import type { FakeKey } from './__fixtures__/keyboardRig';

const realDocument = Reflect.get(globalThis, 'document') as unknown;
Reflect.set(globalThis, 'document', {
  querySelectorAll: (selector: string): HTMLElement[] =>
    selector === '.key.down' ? fakeKeys.filter((k) => k.classes.has('down')).map((k) => k.el) : [],
});
afterAll(() => {
  Reflect.set(globalThis, 'document', realDocument);
});

const A_MIN = [45, 48, 52, 57, 60, 64, 69];
const F_MAJ = [41, 45, 48, 53, 57, 60, 65];
const C_MAJ = [36, 40, 43, 48, 52, 55, 60];
const G_7 = [43, 47, 50, 53, 55, 59, 62, 65, 67];

const laid = (notes: readonly number[], renamed: boolean, octaves = 2): KeysLaid => ({
  octaves,
  notes,
  label: '',
  renamed,
});
const lit = (keys: readonly FakeKey[]): number[] =>
  keys.flatMap((key, offset) => (key.classes.has('down') ? [offset] : []));

describe('the audition keyboard folded', () => {
  let log: string[];
  let keyboard: Keyboard;

  beforeEach(() => {
    fakeKeys.length = 0;
    log = [];
    const part = fakePart('p1', log);
    keyboard = new Keyboard(() => part);
    keyboard.octave = 3;
  });

  /** Fold the keyboard to `notes` on fresh keys, as a folded build hands them over. */
  function fold(notes: readonly number[], renamed = false, width?: number): FakeKey[] {
    const keys = foldedRow(notes.length, width);
    keyboard.adoptKeys(
      keys.map((k) => k.el),
      laid(notes, renamed),
    );
    return keys;
  }

  it('plays each key’s own note, all whites, and lights it', () => {
    const keys = fold(A_MIN);
    keyboard.onPointerDown(pointer(1, keys, 3, { down: 0.2 }));
    expect(log).toEqual(['p1 on 57']);
    expect(lit(keys)).toEqual([3]);
  });

  it('keeps a held finger’s note and key through a rename: A4 under A min, then F maj', () => {
    const before = fold(A_MIN);
    keyboard.onPointerDown(pointer(1, before, 3));
    const after = fold(F_MAJ, true);
    // The A4 sounds on, the fifth key (A4 now) lights, and the fourth (F4) stays dark under the finger.
    expect(log).toEqual(['p1 on 57']);
    expect(lit(after)).toEqual([4]);
    // A wobble inside the fourth key changes nothing.
    keyboard.onPointerMove({ ...pointer(1, after, 3), clientY: TOP + 0.3 * HEIGHT });
    expect(log).toEqual(['p1 on 57']);
    // A slide onto the third key strikes C4 and lifts A4.
    keyboard.onPointerMove(pointer(1, after, 2));
    expect(log).toEqual(['p1 on 57', 'p1 on 48', 'p1 off #1']);
    expect(lit(after)).toEqual([2]);
  });

  it('keeps a held finger’s note from a triad to a seventh, and judges its next move by the new boxes', () => {
    const triad = fold(C_MAJ, false, 90);
    const finger = pointer(1, triad, 2); // G3, the middle of 180 … 270 px.
    keyboard.onPointerDown(finger);
    const seventh = fold(G_7, true, 70);
    expect(log).toEqual(['p1 on 43']);
    expect(lit(seventh)).toEqual([0]);
    expect(keyboard.heldCount).toBe(1);
    // Unmoved, the finger rests on the fourth key (210 … 280 px), F3: its next move strikes it.
    keyboard.onPointerMove({ ...finger, clientY: finger.clientY + 1 });
    expect(log).toEqual(['p1 on 43', 'p1 on 53', 'p1 off #1']);
  });

  it('keeps every held note through a Fold switch, the keys changing at once', () => {
    const chromatic = row(24);
    keyboard.adoptKeys(chromatic.map((k) => k.el));
    keyboard.onPointerDown(pointer(1, chromatic, 9)); // A3, 45.
    keyboard.onPointerDown(pointer(2, chromatic, 20)); // G♯4, 56: no A minor key.
    const scale = fold([45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69], true);
    expect(log).toEqual(['p1 on 45', 'p1 on 56']);
    expect(lit(scale)).toEqual([0]);
    // And back to Off, as undo would.
    const again = row(24);
    keyboard.adoptKeys(
      again.map((k) => k.el),
      { ...laid([], true), notes: null },
    );
    expect(keyboard.heldCount).toBe(2);
    expect(lit(again)).toEqual([9, 20]);
  });

  it('lights a note on both keys two rows share, holds it across them, and gives a second finger nothing', () => {
    // Two rows of A min's triad, one octave each: the lower row's A4 and the upper row's are one note.
    const keys = fold([45, 48, 52, 57, 57, 60, 64, 69]);
    keyboard.onPointerDown(pointer(1, keys, 3));
    expect(lit(keys)).toEqual([3, 4]);
    keyboard.onPointerMove(pointer(1, keys, 4));
    keyboard.onPointerDown(pointer(2, keys, 3));
    expect(log).toEqual(['p1 on 57']);
    keyboard.onPointerUp(pointer(1, keys, 4));
    expect(log).toEqual(['p1 on 57', 'p1 off #1']);
    expect(lit(keys)).toEqual([]);
  });

  it('plays nothing on a hatched key: two octaves of B minor at octave 8 run 107 to 131', () => {
    const bMinor: Harmony = { root: 11, scale: 'naturalMinor', events: [] };
    const set = foldSetAt('scale', bMinor, 384, 0);
    const shown = foldedKeys(set, { octave: 8, octaves: 2, rows: 1 }).rows.flat();
    const notes = shown.map((key) => key.note);
    expect([notes[0], notes.at(-1)]).toEqual([107, 131]);
    expect(shown.filter((key) => key.outOfRange).map((key) => key.note)).toEqual([129, 131]);
    keyboard.octave = 8;
    const keys = fold(notes);
    keyboard.onPointerDown(pointer(1, keys, 13));
    keyboard.onPointerMove(pointer(1, keys, 14));
    keyboard.onPointerDown(pointer(2, keys, 12));
    expect(log).toEqual(['p1 on 127']);
    expect(lit(keys)).toEqual([12]);
  });

  it('lights a MIDI note on the keys carrying it, and none for a note no key shows', () => {
    const keys = fold(A_MIN);
    const sink = keyboard.midiSink('in');
    sink.press(64, 0.8, 0);
    sink.press(65, 0.8, 0);
    expect(lit(keys)).toEqual([5]);
    sink.release(64, false, 0);
    expect(lit(keys)).toEqual([]);
  });
});
