/**
 * The audition keyboard's note bookkeeping (#617), driven through
 * `onKeyDown` / `onKeyUp` over fake `AudioPart`s — the `PerformerSink` fake
 * pattern in `midiPerformer.test.ts`, one layer down. Two defects live here
 * and neither needs a browser to show: a note filed under `e.key` is lost
 * when Shift changes between press and release, and a note latched by Hold
 * lives on a part nothing but that part's own `panic` can silence.
 *
 * The console's `document` is stubbed down to what the class actually reads:
 * the `#keys` row it lights and the `.key.down` sweep Panic does. Note
 * numbers are written as expressions of the keyboard's own octave rather than
 * literals, so moving the default octave does not fail this file.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { AudioPart } from '@windsor/engine';
import { AUDITION_TAB } from './keyboardConstants';
import { Keyboard, isShortcutPress, qwertyPlaysOn } from './keyboard';
import type { PointerInput } from './keyboard';
import { MidiPerformer } from './midiPerformer';

/** An on-screen key: only its `down` light, which a press sets and a lift clears. */
interface FakeKey {
  readonly classes: Set<string>;
  readonly el: HTMLElement;
}
const fakeKeys: FakeKey[] = [];
function fakeKey(): FakeKey {
  const classes = new Set<string>();
  const el = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
  } as unknown as HTMLElement;
  const key = { classes, el };
  fakeKeys.push(key);
  return key;
}
const litKeys = (): number => fakeKeys.filter((k) => k.classes.has('down')).length;

/** Only what `keyboard.ts` touches: `#keys`, `#octLabel`, and Panic's sweep of `.key.down`. */
const keysBox = { children: [] as HTMLElement[] };
const fakeDocument = {
  getElementById: (id: string): unknown => (id === 'keys' ? keysBox : null),
  querySelectorAll: (): HTMLElement[] =>
    fakeKeys.filter((k) => k.classes.has('down')).map((k) => k.el),
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

/** A part that records what the keyboard asks of it, and hands out note ids. */
function fakePart(name: string, log: string[]): AudioPart {
  let nextId = 0;
  return {
    noteOn: (note: number): number => {
      log.push(`${name} on ${note}`);
      return ++nextId;
    },
    noteOff: (id: number): void => void log.push(`${name} off #${id}`),
    panic: (): void => void log.push(`${name} panic`),
    pitchBend: { value: 0 },
    modWheel: { value: 0 },
  } as unknown as AudioPart;
}

const pointer = (pointerId: number, timeStamp = 0): PointerInput => ({ pointerId, timeStamp });

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
  let part1: AudioPart;
  let part2: AudioPart;
  let selected: AudioPart | null;
  let keyboard: Keyboard;

  beforeEach(() => {
    fakeKeys.length = 0;
    log = [];
    part1 = fakePart('p1', log);
    part2 = fakePart('p2', log);
    selected = part1;
    keyboard = new Keyboard(() => selected);
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
    const [c, e] = [fakeKey(), fakeKey()];
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(1), 0, c.el);
    keyboard.onPointerDown(pointer(2), 4, e.el);
    expect(log).toEqual([`p1 on ${root}`, `p1 on ${root + 4}`]);
    // The first finger lifts last: each lift stops its own note, the other sounds on.
    keyboard.onPointerUp(pointer(2));
    expect(log.at(-1)).toBe('p1 off #2');
    expect(litKeys()).toBe(1);
    keyboard.onPointerUp(pointer(1));
    expect(log.at(-1)).toBe('p1 off #1');
    expect(litKeys()).toBe(0);
    expect(keyboard.heldCount).toBe(0);
  });

  it('gives a key another pointer holds no second pointer, and lifts on a cancel', () => {
    const [c, e] = [fakeKey(), fakeKey()];
    keyboard.onPointerDown(pointer(1), 0, c.el);
    keyboard.onPointerDown(pointer(2), 0, c.el);
    expect(log).toEqual([`p1 on ${keyboard.octave * 12}`]);
    keyboard.onPointerUp(pointer(2));
    expect(log).toHaveLength(1);
    expect(litKeys()).toBe(1);
    // A cancel is a lift of that pointer's note and no other.
    keyboard.onPointerDown(pointer(3), 4, e.el);
    keyboard.onPointerUp(pointer(3));
    expect(log.at(-1)).toBe('p1 off #2');
    keyboard.onPointerUp(pointer(1));
    expect(log.at(-1)).toBe('p1 off #1');
    expect(litKeys()).toBe(0);
  });

  it('keeps every pointer’s note under Hold until Panic, and a later lift does nothing', () => {
    const [c, e] = [fakeKey(), fakeKey()];
    keyboard.hold = true;
    keyboard.onPointerDown(pointer(1), 0, c.el);
    keyboard.onPointerDown(pointer(2), 4, e.el);
    keyboard.onPointerUp(pointer(1));
    expect(log.some((line) => line.includes('off'))).toBe(false);
    keyboard.panic();
    expect(log.at(-1)).toBe('p1 panic');
    expect(litKeys()).toBe(0);
    expect(keyboard.heldCount).toBe(0);
    log.length = 0;
    keyboard.onPointerUp(pointer(2));
    expect(log).toEqual([]);
  });

  it('tells its tap each pointer’s press and release under its own source', () => {
    const taps: string[] = [];
    keyboard.tap = {
      press: (_part, source, pitch, _velocity, at) =>
        void taps.push(`on ${source} ${pitch} @${at}`),
      release: (_part, source, pitch, at) => void taps.push(`off ${source} ${pitch} @${at}`),
      panic: () => void taps.push('panic'),
    };
    const root = keyboard.octave * 12;
    keyboard.onPointerDown(pointer(7, 1), 0, fakeKey().el);
    keyboard.onPointerDown(pointer(9, 2), 4, fakeKey().el);
    keyboard.onPointerUp(pointer(7, 3));
    keyboard.onPointerUp(pointer(9, 4));
    expect(taps).toEqual([
      `on pointer:7 ${root} @1`,
      `on pointer:9 ${root + 4} @2`,
      `off pointer:7 ${root} @3`,
      `off pointer:9 ${root + 4} @4`,
    ]);
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
