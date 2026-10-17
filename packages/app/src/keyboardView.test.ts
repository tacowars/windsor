/**
 * The audition keyboard in the expanded view (windsor#864, record
 * `2026-10-17-the-keyboard-on-a-tablet` decisions 7 and 8, amended by
 * `2026-10-17-keyboard-geometry-follows-the-layout`): the octave bound that
 * follows the octaves shown, a chord held under Hold through a change to two
 * rows, and the view's close. The keys are `keyboardRig`'s fakes, handed to
 * `adoptKeys` the way a render does; `document` is stubbed down to Panic's
 * sweep of `.key.down`, as in `keyboard.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { Keyboard } from './keyboard';
import { HEIGHT, TOP, fakeKey, fakeKeys, fakePart, pointer, row } from './__fixtures__/keyboardRig';
import type { FakeKey } from './__fixtures__/keyboardRig';

const realDocument = Reflect.get(globalThis, 'document') as unknown;
Reflect.set(globalThis, 'document', {
  querySelectorAll: (selector: string): HTMLElement[] =>
    selector === '.key.down' ? fakeKeys.filter((k) => k.classes.has('down')).map((k) => k.el) : [],
});
afterAll(() => {
  Reflect.set(globalThis, 'document', realDocument);
});

/** The gap between the expanded view's two rows. */
const GAP = 12;

/**
 * `count` keys in two rows as the expanded view lays them out (windsor#864):
 * the lower half on the rig's row, the upper half a row and a gap above it,
 * offsets running on.
 */
function twoRows(count: number): FakeKey[] {
  const lower = row(count / 2);
  const upper = row(count / 2).map((key) => {
    const box = key.el.getBoundingClientRect();
    const lift = HEIGHT + GAP;
    return fakeKey({ ...box, top: box.top - lift, bottom: box.bottom - lift });
  });
  return [...lower, ...upper];
}

describe('the audition keyboard in the expanded view', () => {
  let log: string[];
  let keyboard: Keyboard;
  let keys: FakeKey[];

  beforeEach(() => {
    fakeKeys.length = 0;
    log = [];
    const part = fakePart('p1', log);
    keyboard = new Keyboard(() => part);
    keys = row(24);
    keyboard.adoptKeys(keys.map((k) => k.el));
  });

  it('bounds the octave by the octaves shown, and brings it down when more show', () => {
    keyboard.adoptKeys(row(48).map((k) => k.el));
    for (let i = 0; i < 6; i++) keyboard.shiftOctave(1);
    // At 4 octaves Oct + stops at C6, and the highest key is B9.
    expect(keyboard.octave).toBe(6);
    expect(keyboard.octave * 12 + 47).toBe(119);
    keyboard.adoptKeys(row(24).map((k) => k.el));
    for (let i = 0; i < 6; i++) keyboard.shiftOctave(1);
    expect(keyboard.octave).toBe(8);
    keyboard.adoptKeys(row(36).map((k) => k.el));
    expect(keyboard.octave).toBe(7);
  });

  it('keeps a chord under Hold through two rows, judges a move by the new boxes, and lifts in the gap', () => {
    keyboard.hold = true;
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(2, keys, 4));
    keyboard.onPointerDown(pointer(3, keys, 19));
    const rows = twoRows(48);
    keyboard.adoptKeys(rows.map((k) => k.el));
    expect(log).toEqual([`p1 on ${root}`, `p1 on ${root + 4}`, `p1 on ${root + 19}`]);
    expect([0, 4, 19].every((offset) => rows[offset]?.classes.has('down'))).toBe(true);
    // Up onto the upper row's first C, the third octave: it strikes, and Hold keeps the C it left.
    keyboard.onPointerMove(pointer(1, rows, 24));
    expect(log.at(-1)).toBe(`p1 on ${root + 24}`);
    // The gap between the rows is no key: the finger lifts there.
    keyboard.onPointerMove({ ...pointer(2, rows, 4), clientY: TOP - GAP / 2 });
    expect(keyboard.heldCount).toBe(2);
    // Back to one octave: the keys past it lift at the re-read, Hold keeping their notes.
    keyboard.adoptKeys(row(12).map((k) => k.el));
    expect(keyboard.heldCount).toBe(0);
    expect(log.some((line) => line.includes('off'))).toBe(false);
  });

  it('lifts every pointer when the view closes: Hold keeps their notes, and the octave stays', () => {
    keyboard.adoptKeys(twoRows(48).map((k) => k.el));
    keyboard.shiftOctave(1);
    const octave = keyboard.octave;
    keyboard.toggleHold();
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(2, keys, 7));
    keyboard.collapse();
    expect(keyboard.heldCount).toBe(0);
    expect(log.some((line) => line.includes('off'))).toBe(false);
    expect(keyboard.octave).toBe(octave);
    // A captured pointer of the gone view plays nothing more.
    keyboard.onPointerMove(pointer(1, keys, 2));
    expect(log).toHaveLength(2);
    // Hold off is a Panic, which stops them.
    keyboard.toggleHold();
    expect(log.at(-1)).toBe('p1 panic');
  });

  it('stops a held pointer’s note when the view closes without Hold', () => {
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.collapse();
    expect(log).toEqual([`p1 on ${keyboard.octave * 12}`, 'p1 off #1']);
  });
});
