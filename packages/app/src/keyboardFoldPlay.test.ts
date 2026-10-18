/**
 * The computer keys and MIDI on a folded part (windsor#921, record
 * `2026-10-18-keyboard-fold` decisions 6 to 8 and the boundary cases), on
 * the record's demo song: A minor, 120 BPM, four bars of A min, F maj,
 * C maj and G 7. The keyboard's fold host is the console's (`foldHostOver`)
 * over a fake source: the song, a transport that is running or not, and a
 * fake recorder stamp that maps a `timeStamp` to the tick sounding then at
 * 120 BPM. The tap is the recorder's seam: a dropped note never reaches it.
 * `document` and `HTMLElement` are stubbed as in `keyboard.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ArrangementDocument, ChordSize, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { Keyboard } from './keyboard';
import type { PartFold } from './keyboardFold';
import { type FoldSource, foldHostOver } from './keyboardFoldNow';
import { HOME_ROW } from './keyboardFoldTables';
import { MidiPerformer } from './midiPerformer';
import { newSong } from './songParts';
import { fakeKeys, fakePart, foldedRow } from './__fixtures__/keyboardRig';

const realDocument = Reflect.get(globalThis, 'document') as unknown;
const realHtmlElement = Reflect.get(globalThis, 'HTMLElement') as unknown;
Reflect.set(globalThis, 'document', { querySelectorAll: (): HTMLElement[] => [] });
Reflect.set(globalThis, 'HTMLElement', class {});
afterAll(() => {
  Reflect.set(globalThis, 'document', realDocument);
  Reflect.set(globalThis, 'HTMLElement', realHtmlElement);
});

const BAR = 96;
/** One tick at 120 BPM and 24 PPQ: 500 ms ÷ 24. */
const MS_PER_TICK = 500 / 24;
/** The `timeStamp` heard `early` ms before tick `tick`. */
const before = (tick: number, early: number): number => tick * MS_PER_TICK - early;

const A2 = 45;
const B_FLAT2 = 46;
const E3 = 52;
const F3 = 53;
const G3 = 55;
const B3 = 59;

const event = (bar: number, degree: number, size: ChordSize = CHORD_SIZE_TRIAD): HarmonyEvent => ({
  start: bar * BAR,
  duration: BAR,
  degree,
  size,
});

/** The demo song, its one part folded to `fold`, and its transport looping bars 1 and 2 when asked. */
function demo(fold: PartFold, loop = false): ArrangementDocument {
  const model = new DocumentModel(newSong());
  model.merge({
    transport: { bpm: 120, bars: 4, loop: { start: 0, end: 2 * BAR, on: loop } },
    harmony: {
      root: 9,
      scale: 'naturalMinor',
      events: [event(0, 0), event(1, 5), event(2, 2), event(3, 6, CHORD_SIZE_SEVENTH)],
    },
    parts: { 0: { fold } },
  });
  return model.doc;
}

/** Two octaves of B minor, folded to its B min chord. */
function bMinor(): ArrangementDocument {
  const model = new DocumentModel(newSong());
  model.merge({
    harmony: { root: 11, scale: 'naturalMinor', events: [event(0, 0)] },
    parts: { 0: { fold: 'chord' } },
  });
  return model.doc;
}

const key = (letter: string, timeStamp = 0): KeyboardEvent =>
  ({
    key: letter,
    code: `Key${letter}`,
    repeat: false,
    target: null,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    timeStamp,
  }) as unknown as KeyboardEvent;

describe('the computer keys and MIDI on a folded part', () => {
  let log: string[];
  let taps: string[];
  let keyboard: Keyboard;
  /** What the fake source reads: the song, the transport, the playhead. */
  let doc: ArrangementDocument;
  let running: boolean;
  let position: number;

  beforeEach(() => {
    fakeKeys.length = 0;
    log = [];
    taps = [];
    doc = demo('off');
    running = false;
    position = 0;
    const part = fakePart('p1', log);
    keyboard = new Keyboard(() => part);
    keyboard.octave = 3;
    const source: FoldSource = {
      doc: () => doc,
      slot: () => 0,
      running: () => running,
      position: () => position,
      stamp: (timeStamp) => (timeStamp === undefined ? null : Math.floor(timeStamp / MS_PER_TICK)),
      write: () => undefined,
    };
    keyboard.foldHost = foldHostOver(source);
    keyboard.tap = {
      press: (_part, source, pitch) => void taps.push(`on ${source} ${pitch}`),
      release: (_part, source, pitch) => void taps.push(`off ${source} ${pitch}`),
      panic: () => void taps.push('panic'),
    };
  });

  /** Each letter pressed and released, and the notes it struck. */
  function type(letters: readonly string[]): number[] {
    const struck: number[] = [];
    for (const letter of letters) {
      const count = log.length;
      keyboard.onKeyDown(key(letter));
      keyboard.onKeyUp(key(letter));
      const on = log.slice(count).find((line) => line.startsWith('p1 on '));
      if (on) struck.push(Number(on.slice('p1 on '.length)));
    }
    return struck;
  }

  it("plays A minor's folded keys on the home row at A2, and nothing on w e t y u o p", () => {
    doc = demo('scale');
    expect(type(HOME_ROW)).toEqual([45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62]);
    expect(type(['w', 'e', 't', 'y', 'u', 'o', 'p'])).toEqual([]);
  });

  it('plays past a 7-key Chord row unlit: k is C5 on A min from A2 to A4', () => {
    doc = demo('chord');
    const keys = foldedRow(7);
    keyboard.adoptKeys(
      keys.map((k) => k.el),
      { octaves: 2, notes: [45, 48, 52, 57, 60, 64, 69], label: 'A2', renamed: false },
    );
    keyboard.onKeyDown(key('k'));
    expect(log).toEqual(['p1 on 72']);
    expect(keys.some((k) => k.classes.has('down'))).toBe(false);
  });

  it("plays nothing past 127 at octave 8: two octaves of B min, k to '", () => {
    doc = bMinor();
    keyboard.octave = 8;
    expect(type(['k', 'l', ';', "'"])).toEqual([]);
    expect(type(['a', 'h', 'j'])).toEqual([107, 126]);
  });

  it('still shifts the octave with z and x while folded', () => {
    doc = demo('scale');
    keyboard.onKeyDown(key('x'));
    expect(type(['a'])).toEqual([57]);
    keyboard.onKeyDown(key('z'));
    expect(type(['a'])).toEqual([45]);
  });

  it('drops a B♭ and passes an A on A minor Scale', () => {
    doc = demo('scale');
    const sink = keyboard.midiSink('in');
    sink.press(B_FLAT2, 0.8, 0);
    sink.press(A2, 0.8, 0);
    expect(log).toEqual(['p1 on 45']);
    expect(taps).toEqual(['on midi:in:45 45']);
  });

  it('judges Chord at the stamped tick with the grace window, at 120 BPM', () => {
    doc = demo('chord');
    running = true;
    position = 300; // Where the playhead is drawn; the stamp decides.
    const sink = keyboard.midiSink('in');
    sink.press(F3, 0.8, before(BAR, 15)); // Tick 95: F maj at 96 holds F. Kept.
    sink.press(B3, 0.8, before(BAR, 15)); // Tick 95: neither A min nor F maj. Dropped.
    sink.press(F3, 0.8, before(BAR, 150)); // Tick 88: the window is 89 to 94. Dropped.
    expect(log).toEqual(['p1 on 53']);
  });

  it("judges across the loop's jump: at tick 191 an E is kept and a G dropped", () => {
    doc = demo('chord', true);
    running = true;
    const sink = keyboard.midiSink('in');
    sink.press(E3, 0.8, before(2 * BAR, 15));
    sink.press(G3, 0.8, before(2 * BAR, 15));
    expect(log).toEqual(['p1 on 52']);
  });

  it('judges at the standing tick while stopped', () => {
    doc = demo('chord');
    position = BAR;
    const sink = keyboard.midiSink('in');
    sink.press(E3, 0.8, before(BAR, 15)); // A min would hold E; F maj stands. Dropped.
    sink.press(F3, 0.8, before(BAR, 15));
    expect(log).toEqual(['p1 on 53']);
  });

  it('lifts nothing for a dropped note, by its release or a pedal-up, and tells the tap nothing', () => {
    doc = demo('scale');
    const midi = new MidiPerformer(keyboard.midiSink('in'));
    midi.handle({ type: 'noteOn', note: B_FLAT2, velocity: 0.8 }, 1);
    midi.handle({ type: 'noteOff', note: B_FLAT2 }, 2);
    midi.handle({ type: 'sustain', down: true }, 3);
    midi.handle({ type: 'noteOn', note: B_FLAT2, velocity: 0.8 }, 4);
    midi.handle({ type: 'noteOff', note: B_FLAT2 }, 5);
    midi.handle({ type: 'sustain', down: false }, 6);
    midi.releaseAll();
    expect(log).toEqual([]);
    expect(taps).toEqual([]);
    expect(keyboard.heldCount).toBe(0);
  });

  it('releases a passed note held through a chord change, and keeps a dropped one silent', () => {
    doc = demo('chord');
    const midi = new MidiPerformer(keyboard.midiSink('in'));
    midi.handle({ type: 'noteOn', note: E3, velocity: 0.8 }, 1); // A min holds E.
    midi.handle({ type: 'noteOn', note: B3, velocity: 0.8 }, 1); // A min does not hold B.
    position = 3 * BAR; // G 7 now: no E, but a B.
    midi.handle({ type: 'noteOff', note: E3 }, 2);
    midi.handle({ type: 'noteOff', note: B3 }, 2);
    expect(log).toEqual(['p1 on 52', 'p1 off #1']);
    expect(taps).toEqual(['on midi:in:52 52', 'off midi:in:52 52']);
  });

  it('plays every QWERTY and MIDI note on Off, as unfolded', () => {
    expect(type(['a', 'w', 'k', 'p'])).toEqual([36, 37, 48, 51]);
    running = true;
    const sink = keyboard.midiSink('in');
    sink.press(B_FLAT2, 0.8, before(BAR, 15));
    sink.press(B3, 0.8, before(BAR, 15));
    expect(log.filter((line) => line.includes(' on ')).slice(-2)).toEqual(['p1 on 46', 'p1 on 59']);
  });
});
