/**
 * The audition keyboard's note bookkeeping (#617), driven through
 * `onKeyDown` / `onKeyUp` over fake `AudioPart`s — the `PerformerSink` fake
 * pattern in `midiPerformer.test.ts`, one layer down. Two defects live here
 * and neither needs a browser to show: a note filed under `e.key` is lost
 * when Shift changes between press and release, and a note latched by Hold
 * lives on a part nothing but that part's own `panic` can silence.
 *
 * The console's `document` is stubbed down to what the class actually reads:
 * the octave labels and Hold buttons it writes, none here, and the
 * `.key.down` sweep Panic does. The keys
 * are `keyboardRig`'s fakes with the boxes the touch row lays out
 * (windsor#863), handed to `adoptKeys` the way a render does, so a pointer is
 * a point on them. Note numbers are written as expressions of the keyboard's
 * own octave rather than literals, so moving the default octave does not fail
 * this file.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { AudioPart } from '@windsor/engine';
import { AUDITION_TAB, FIXED_VELOCITY } from './keyboardConstants';
import { Keyboard, isShortcutPress, qwertyPlaysOn } from './keyboard';
import { MidiPerformer } from './midiPerformer';
import {
  WHITE,
  fakeKeys,
  fakePart,
  litKeys,
  offRow,
  pointer,
  row,
} from './__fixtures__/keyboardRig';
import type { FakeKey } from './__fixtures__/keyboardRig';

/** Only what `keyboard.ts` touches: Panic's sweep of `.key.down`; no label or Hold button. */
const fakeDocument = {
  querySelectorAll: (selector: string): HTMLElement[] =>
    selector === '.key.down' ? fakeKeys.filter((k) => k.classes.has('down')).map((k) => k.el) : [],
};

const realDocument = Reflect.get(globalThis, 'document') as unknown;
const realHtmlElement = Reflect.get(globalThis, 'HTMLElement') as unknown;
Reflect.set(globalThis, 'document', fakeDocument);
// `instanceof HTMLElement` is how the handler tells a field from the page; in
// the node environment the name has to exist for the check to run at all.
class FakeElement {
  tagName: string;
  private readonly dialog: boolean;
  constructor(tagName: string, dialog = false) {
    this.tagName = tagName;
    this.dialog = dialog;
  }
  closest(selector: string): unknown {
    return selector === 'dialog[open]' && this.dialog ? {} : null;
  }
}
Reflect.set(globalThis, 'HTMLElement', FakeElement);
afterAll(() => {
  Reflect.set(globalThis, 'document', realDocument);
  Reflect.set(globalThis, 'HTMLElement', realHtmlElement);
});

const press = (key: string, code: string, target: unknown = null): KeyboardEvent =>
  ({
    key,
    code,
    repeat: false,
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  }) as unknown as KeyboardEvent;

describe('the audition keyboard', () => {
  let log: string[];
  let velocities: number[];
  let part1: AudioPart;
  let part2: AudioPart;
  let selected: AudioPart | null;
  let keyboard: Keyboard;
  let keys: FakeKey[];

  beforeEach(() => {
    fakeKeys.length = 0;
    log = [];
    velocities = [];
    part1 = fakePart('p1', log, velocities);
    part2 = fakePart('p2', log);
    selected = part1;
    keyboard = new Keyboard(() => selected);
    keys = row(24);
    keyboard.adoptKeys(keys.map((k) => k.el));
  });

  it('lifts a note whose keyup arrives shifted, and lets the key play again', () => {
    const note = keyboard.octave * 12; // `a` is the row's first key.
    keyboard.onKeyDown(press('a', 'KeyA'));
    // Shift went down to fine-drag a knob while `a` was held, so the release
    // is delivered as `A`. The physical key is the same one.
    keyboard.onKeyUp(press('A', 'KeyA'));
    expect(log).toEqual([`p1 on ${note}`, 'p1 off #1']);
    expect(keyboard.heldCount).toBe(0);

    keyboard.onKeyDown(press('a', 'KeyA'));
    expect(log.at(-1)).toBe(`p1 on ${note}`);
    expect(keyboard.heldCount).toBe(1);
  });

  it('plays nothing and keeps its octave for a key held with Ctrl, Meta or Alt', () => {
    const octave = keyboard.octave;
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      const chord = (key: string, code: string): KeyboardEvent =>
        ({ ...press(key, code), [mod]: true }) as unknown as KeyboardEvent;
      expect(isShortcutPress(chord('k', 'KeyK'))).toBe(true);
      keyboard.onKeyDown(chord('k', 'KeyK'));
      keyboard.onKeyDown(chord('z', 'KeyZ'));
    }
    expect(isShortcutPress(press('k', 'KeyK'))).toBe(false);
    expect(log).toEqual([]);
    expect(keyboard.octave).toBe(octave);
  });

  it('ignores a repeat and a second press of a key already down', () => {
    keyboard.onKeyDown(press('a', 'KeyA'));
    keyboard.onKeyDown({ ...press('a', 'KeyA'), repeat: true } as unknown as KeyboardEvent);
    keyboard.onKeyDown(press('a', 'KeyA'));
    expect(log).toEqual([`p1 on ${keyboard.octave * 12}`]);
  });

  it('plays its QWERTY keys only on the Parts tab, and still lifts a note held across a switch', () => {
    let tab: string | null = 'song';
    keyboard = new Keyboard(
      () => selected,
      () => qwertyPlaysOn(tab),
    );
    keyboard.onKeyDown(press('e', 'KeyE'));
    keyboard.onKeyDown(press('d', 'KeyD'));
    keyboard.onKeyDown(press('x', 'KeyX'));
    expect(log).toEqual([]);
    expect(keyboard.heldCount).toBe(0);
    const octave = keyboard.octave;
    tab = 'parts';
    keyboard.onKeyDown(press('e', 'KeyE'));
    expect(log).toEqual([`p1 on ${octave * 12 + 3}`]);
    tab = 'song';
    keyboard.onKeyUp(press('e', 'KeyE'));
    expect(log.at(-1)).toBe('p1 off #1');
  });

  it('leaves typing in a field and in an open dialog alone', () => {
    keyboard.onKeyDown(press('a', 'KeyA', new FakeElement('INPUT')));
    keyboard.onKeyDown(press('a', 'KeyA', new FakeElement('BUTTON', true)));
    expect(log).toEqual([]);
    // A button on the page itself is not a field: that press is a note.
    keyboard.onKeyDown(press('a', 'KeyA', new FakeElement('BUTTON')));
    expect(log).toEqual([`p1 on ${keyboard.octave * 12}`]);
  });

  it('still shifts the octave with z and x', () => {
    const start = keyboard.octave;
    keyboard.onKeyDown(press('x', 'KeyX'));
    expect(keyboard.octave).toBe(start + 1);
    keyboard.onKeyDown(press('z', 'KeyZ'));
    expect(keyboard.octave).toBe(start);
    expect(log).toEqual([]);
  });

  it('panics every part it has latched under Hold, not only the selected one', () => {
    keyboard.hold = true;
    const root = keyboard.octave * 12;
    keyboard.onKeyDown(press('a', 'KeyA'));
    keyboard.onKeyDown(press('s', 'KeyS'));
    // Under Hold the keys come back up and the notes stay on the engine.
    keyboard.onKeyUp(press('a', 'KeyA'));
    keyboard.onKeyUp(press('s', 'KeyS'));
    expect(log).toEqual([`p1 on ${root}`, `p1 on ${root + 2}`]);
    expect(keyboard.heldCount).toBe(0);

    selected = part2;
    keyboard.followPart();
    keyboard.onKeyDown(press('a', 'KeyA'));
    log.length = 0;

    keyboard.panic();
    expect(log.filter((line) => line.endsWith('panic')).sort()).toEqual(['p1 panic', 'p2 panic']);
    expect(keyboard.heldCount).toBe(0);
  });

  it('stops panicking a part it has not played since the last Panic', () => {
    keyboard.onKeyDown(press('a', 'KeyA'));
    keyboard.onKeyUp(press('a', 'KeyA'));
    keyboard.panic();
    selected = part2;
    keyboard.followPart();
    log.length = 0;
    keyboard.panic();
    expect(log).toEqual(['p2 panic']);
  });

  it('tells its tap where a note really starts and stops: the pedal’s release, Hold’s at Panic', () => {
    const taps: string[] = [];
    keyboard.tap = {
      press: (part, source, pitch, _velocity, at) =>
        void taps.push(`${part === part1 ? 'p1' : 'p2'} on ${source} ${pitch} @${at}`),
      release: (_part, source, pitch, at) => void taps.push(`off ${source} ${pitch} @${at}`),
      panic: () => void taps.push('panic'),
    };
    const midi = new MidiPerformer(keyboard.midiSink('a'));
    midi.handle({ type: 'sustain', down: true }, 1);
    midi.handle({ type: 'noteOn', note: 60, velocity: 0.5 }, 2);
    midi.handle({ type: 'noteOff', note: 60 }, 3);
    midi.handle({ type: 'bend', semitones: 1 }, 4);
    midi.handle({ type: 'sustain', down: false }, 5);
    expect(taps).toEqual(['p1 on midi:a:60 60 @2', 'off midi:a:60 60 @5']);

    taps.length = 0;
    keyboard.hold = true;
    keyboard.onKeyDown({ ...press('a', 'KeyA'), timeStamp: 6 } as KeyboardEvent);
    keyboard.onKeyUp({ ...press('a', 'KeyA'), timeStamp: 7 } as KeyboardEvent);
    keyboard.panic();
    expect(taps).toEqual([`p1 on KeyA ${keyboard.octave * 12} @6`, 'panic']);
  });

  it('holds each pointer’s note by its pointer, so every finger of a chord lifts its own', () => {
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(2, keys, 4));
    expect(log).toEqual([`p1 on ${root}`, `p1 on ${root + 4}`]);
    // The first finger lifts last: each lift stops its own note, the other sounds on.
    keyboard.onPointerUp(pointer(2, keys, 4));
    expect(log.at(-1)).toBe('p1 off #2');
    expect(litKeys()).toBe(1);
    keyboard.onPointerUp(pointer(1, keys, 0));
    expect(log.at(-1)).toBe('p1 off #1');
    expect(litKeys()).toBe(0);
    expect(keyboard.heldCount).toBe(0);
  });

  it('gives a key another pointer holds no second pointer, and lifts on a cancel', () => {
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(2, keys, 0));
    expect(log).toEqual([`p1 on ${keyboard.octave * 12}`]);
    keyboard.onPointerUp(pointer(2, keys, 0));
    expect(log).toHaveLength(1);
    expect(litKeys()).toBe(1);
    // A cancel is a lift of that pointer's note and no other.
    keyboard.onPointerDown(pointer(3, keys, 4));
    keyboard.onPointerUp(pointer(3, keys, 4));
    expect(log.at(-1)).toBe('p1 off #2');
    keyboard.onPointerUp(pointer(1, keys, 0));
    expect(log.at(-1)).toBe('p1 off #1');
    expect(litKeys()).toBe(0);
  });

  it('keeps a chord under Hold after every finger lifts, until Panic stops it and clears every key', () => {
    keyboard.hold = true;
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(2, keys, 4));
    keyboard.onPointerDown(pointer(3, keys, 7));
    keyboard.onPointerUp(pointer(1, keys, 0));
    keyboard.onPointerUp(pointer(3, keys, 7));
    expect(log.some((line) => line.includes('off'))).toBe(false);
    expect(litKeys()).toBe(1);
    keyboard.panic();
    expect(log.at(-1)).toBe('p1 panic');
    expect(litKeys()).toBe(0);
    expect(keyboard.heldCount).toBe(0);
    log.length = 0;
    keyboard.onPointerUp(pointer(2, keys, 4));
    expect(log).toEqual([]);
  });

  it('tells its tap each pointer’s press and release under its own source and note', () => {
    const taps: string[] = [];
    keyboard.tap = {
      press: (_part, source, pitch, _velocity, at) =>
        void taps.push(`on ${source} ${pitch} @${at}`),
      release: (_part, source, pitch, at) => void taps.push(`off ${source} ${pitch} @${at}`),
      panic: () => void taps.push('panic'),
    };
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(7, keys, 0, { timeStamp: 1 }));
    keyboard.onPointerDown(pointer(9, keys, 4, { timeStamp: 2 }));
    keyboard.onPointerUp(pointer(7, keys, 0, { timeStamp: 3 }));
    keyboard.onPointerUp(pointer(9, keys, 4, { timeStamp: 4 }));
    expect(taps).toEqual([
      `on pointer:7:${root} ${root} @1`,
      `on pointer:9:${root + 4} ${root + 4} @2`,
      `off pointer:7:${root} ${root} @3`,
      `off pointer:9:${root + 4} ${root + 4} @4`,
    ]);
  });

  it('slides a touch from C to D: D strikes, then C lifts, at C’s velocity, two notes to the tap', () => {
    const taps: string[] = [];
    keyboard.tap = {
      press: (_part, source, pitch) => void taps.push(`on ${source} ${pitch}`),
      release: (_part, source, pitch) => void taps.push(`off ${source} ${pitch}`),
      panic: () => void taps.push('panic'),
    };
    const [c, d] = [keyboard.octave * 12, keyboard.octave * 12 + 2];
    keyboard.onPointerDown(pointer(1, keys, 0, { down: 0.25 }));
    // Further down D, where a fresh strike would be harder: a slide keeps the strike's velocity.
    keyboard.onPointerMove(pointer(1, keys, 2, { down: 0.9 }));
    expect(log).toEqual([`p1 on ${c}`, `p1 on ${d}`, 'p1 off #1']);
    expect(velocities).toEqual([0.7, 0.7]);
    expect(taps).toEqual([
      `on pointer:1:${c} ${c}`,
      `on pointer:1:${d} ${d}`,
      `off pointer:1:${c} ${c}`,
    ]);
    // A move within the key plays nothing.
    keyboard.onPointerMove(pointer(1, keys, 2, { down: 0.1 }));
    expect(log).toHaveLength(3);
    expect(litKeys()).toBe(1);
  });

  it('lifts a pointer that slides off the row, and strikes afresh when it slides back on', () => {
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(1, keys, 0, { down: 0 }));
    keyboard.onPointerMove(offRow(1));
    expect(log).toEqual([`p1 on ${root}`, 'p1 off #1']);
    expect(litKeys()).toBe(0);
    keyboard.onPointerMove(offRow(1));
    expect(log).toHaveLength(2);
    keyboard.onPointerMove(pointer(1, keys, 4, { down: 0.5 }));
    expect(log.at(-1)).toBe(`p1 on ${root + 4}`);
    expect(velocities).toEqual([0.6, 0.8]);
  });

  it('lets two sliding pointers follow their own keys, and plays one note where they meet', () => {
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(2, keys, 7));
    keyboard.onPointerMove(pointer(1, keys, 2));
    keyboard.onPointerMove(pointer(2, keys, 5));
    expect(log).toEqual([
      `p1 on ${root}`,
      `p1 on ${root + 7}`,
      `p1 on ${root + 2}`,
      'p1 off #1',
      `p1 on ${root + 5}`,
      'p1 off #2',
    ]);
    // The second finger arrives on the first's key: it strikes nothing there and lifts its own.
    keyboard.onPointerMove(pointer(2, keys, 2));
    expect(log.slice(6)).toEqual(['p1 off #4']);
    expect(litKeys()).toBe(1);
    // It strikes again only when it moves onto another key.
    keyboard.onPointerMove(pointer(2, keys, 4));
    expect(log.at(-1)).toBe(`p1 on ${root + 4}`);
    keyboard.onPointerUp(pointer(1, keys, 2));
    keyboard.onPointerUp(pointer(2, keys, 4));
    expect(log.slice(-2)).toEqual(['p1 off #3', 'p1 off #5']);
    expect(keyboard.heldCount).toBe(0);
  });

  it('keeps a held note across a re-render, judges the next move by the new boxes, and lifts a key past the range', () => {
    const root = keyboard.octave * 12;
    const atE = pointer(1, keys, 4);
    keyboard.onPointerDown(atE);
    keyboard.onPointerDown(pointer(2, keys, 16));
    // One octave now, laid out two white keys further right: offset 16 is gone.
    const oneOctave = row(12, 2 * WHITE);
    keyboard.adoptKeys(oneOctave.map((k) => k.el));
    expect(log).toEqual([`p1 on ${root + 4}`, `p1 on ${root + 16}`, 'p1 off #2']);
    expect(oneOctave[4]?.classes.has('down')).toBe(true);
    expect(litKeys()).toBe(1); // The old row's E goes dark; the new row lights its own.
    // The finger has not moved, but where it rests is C in the new boxes.
    keyboard.onPointerMove({ ...atE, clientY: atE.clientY + 1 });
    expect(log.slice(3)).toEqual([`p1 on ${root}`, 'p1 off #1']);
    // The finger whose key went is captured still: back on a key, it strikes afresh.
    keyboard.onPointerMove(pointer(2, oneOctave, 9));
    expect(log.at(-1)).toBe(`p1 on ${root + 9}`);
  });

  it('strikes a mouse at the fixed velocity anywhere on a key, and a pen by where it lands', () => {
    keyboard.onPointerDown(pointer(1, keys, 0, { type: 'mouse', down: 0 }));
    keyboard.onPointerUp(pointer(1, keys, 0));
    keyboard.onPointerDown(pointer(1, keys, 1, { type: 'mouse', down: 0.99 }));
    keyboard.onPointerUp(pointer(1, keys, 1));
    keyboard.onPointerDown(pointer(2, keys, 1, { type: 'pen', down: 0 }));
    keyboard.onPointerDown(pointer(3, keys, 4, { type: 'pen', down: 0.5 }));
    expect(velocities).toEqual([FIXED_VELOCITY, FIXED_VELOCITY, 0.6, 0.8]);
  });

  it('calls back after a Panic so a MIDI performer forgets its notes', () => {
    let told = 0;
    keyboard.onPanic = (): void => void told++;
    keyboard.panic();
    expect(told).toBe(1);
  });
});

describe('which tab the QWERTY keys play on', () => {
  it('is the Parts tab alone', () => {
    expect(AUDITION_TAB).toBe('parts');
    expect(qwertyPlaysOn('parts')).toBe(true);
    for (const tab of ['song', 'mixer', 'arrangement', null])
      expect(qwertyPlaysOn(tab)).toBe(false);
  });
});
