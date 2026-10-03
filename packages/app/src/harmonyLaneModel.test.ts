/**
 * The harmony lane's edits over the ticket's fixtures (#709 decision 4): a
 * resize shifts what follows and the last event absorbs it at the song end,
 * a resize past what it can absorb is clamped, a delete merges into the
 * previous event (the first into the next), and a song-length change
 * extends or clamps the tail. Every
 * expectation is an expression of the engine's tick constants.
 */
import { describe, expect, it } from 'vitest';

import type { Harmony, HarmonyEvent } from '@windsor/engine';
import {
  ARRANGEMENT_VERSION,
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
  PPQ,
  TICKS_PER_BAR,
  chordAt,
  meterBeats,
} from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import {
  barsBeats,
  chipDegree,
  degreeChips,
  dialBeat,
  durationLabel,
  eventBar,
  eventLabel,
  fitEvents,
  maxEventDuration,
  removeEvent,
  setAccidental,
  setEventDuration,
  setQuality,
  setSize,
  snapToBeats,
  toTicks,
} from './harmonyLaneModel';

const BAR = TICKS_PER_BAR;
const SONG = 6 * BAR;
const ev = (start: number, duration: number, degree: number): HarmonyEvent => ({
  start,
  duration,
  degree,
  size: CHORD_SIZE_TRIAD,
});
/** Four events: three of a bar and the last holding to the six-bar end. */
const FOUR = [ev(0, BAR, 0), ev(BAR, BAR, 5), ev(2 * BAR, BAR, 2), ev(3 * BAR, 3 * BAR, 6)];
const spans = (events: readonly HarmonyEvent[]): [number, number][] =>
  events.map((e) => [e.start, e.duration]);

describe('resizing an event', () => {
  it('shifts every following event and shortens the last, the song end fixed', () => {
    const out = setEventDuration(FOUR, 1, 2 * BAR, SONG);
    expect(spans(out)).toEqual([
      [0, BAR],
      [BAR, 2 * BAR],
      [3 * BAR, BAR],
      [4 * BAR, 2 * BAR],
    ]);
    expect(out.map((e) => e.degree)).toEqual([0, 5, 2, 6]);
  });

  it('is clamped to what the last event can absorb, leaving it a beat', () => {
    const most = maxEventDuration(FOUR, 1, SONG);
    expect(most).toBe(SONG - BAR - BAR - PPQ);
    const out = setEventDuration(FOUR, 1, SONG, SONG);
    expect(spans(out)).toEqual([
      [0, BAR],
      [BAR, most],
      [BAR + most, BAR],
      [2 * BAR + most, PPQ],
    ]);
  });

  it('never shortens an event under a beat, and never dials the last one', () => {
    expect(spans(setEventDuration(FOUR, 1, 0, SONG))[1]).toEqual([BAR, PPQ]);
    expect(setEventDuration(FOUR, 3, BAR, SONG)).toEqual(FOUR);
  });
});

describe('Size on an event with a named quality (windsor#332 decision 1)', () => {
  const maj: HarmonyEvent = { ...(FOUR[0] as HarmonyEvent), quality: 'maj', accidental: -1 };
  const dom7: HarmonyEvent = {
    ...(FOUR[0] as HarmonyEvent),
    size: CHORD_SIZE_SEVENTH,
    quality: 'dom7',
  };

  it("asks for the scale's own seventh, dropping the quality and keeping the accidental", () => {
    const out = setSize([maj], 0, CHORD_SIZE_SEVENTH)[0];
    expect(out).toEqual({ start: 0, duration: BAR, degree: 0, size: 4, accidental: -1 });
    expect(out).not.toHaveProperty('quality');
  });

  it("asks for the scale's own triad from a dominant seventh", () => {
    const out = setSize([dom7], 0, CHORD_SIZE_TRIAD)[0];
    expect(out).toEqual({ start: 0, duration: BAR, degree: 0, size: 3 });
    expect(out).not.toHaveProperty('quality');
  });

  it('keeps the new size and the accidental through the document merge, reporting nothing', async () => {
    await loadBuiltIns();
    const model = new DocumentModel({
      version: ARRANGEMENT_VERSION,
      transport: { bpm: 120, bars: 4 },
      harmony: { root: 0, scale: 'major', events: [{ ...maj, duration: 4 * BAR }] },
      parts: [
        {
          slot: 0,
          name: 'kick',
          preset: 'kick',
          regions: [{ start: 0, duration: 4 * BAR }],
          sequencer: { kind: 'euclidean', seed: 0, note: 36, hold: 0.2 },
        },
      ],
    });
    expect(model.corrections).toEqual([]);
    const events = setSize(model.doc.harmony.events ?? [], 0, CHORD_SIZE_SEVENTH);
    model.merge({ harmony: { events } });
    expect(model.doc.harmony.events?.[0]).toEqual({
      start: 0,
      duration: 4 * BAR,
      degree: 0,
      size: CHORD_SIZE_SEVENTH,
      accidental: -1,
    });
    expect(model.corrections).toEqual([]);
  });
});

describe('Accidental and Quality (windsor#332 decision 1)', () => {
  const first = FOUR[0] as HarmonyEvent;

  it('writes a flat major on the first degree, reading B maj / ♭I in C minor', () => {
    const key: Harmony = { root: 0, scale: 'naturalMinor', events: FOUR };
    const flat = setAccidental(FOUR, 0, -1);
    const out = setQuality(flat, 0, 'maj');
    expect(out[0]).toEqual({ ...first, accidental: -1, quality: 'maj', size: CHORD_SIZE_TRIAD });
    expect(out.slice(1)).toEqual(FOUR.slice(1));
    expect(eventLabel(key, out[0] as HarmonyEvent)).toEqual({
      name: 'B maj',
      numeral: '♭I',
      sizeTag: 'triad',
    });
  });

  it('removes both keys for natural and the scale’s own chord, never writing 0 or null', () => {
    const chromatic = setQuality(setAccidental(FOUR, 0, 1), 0, 'aug');
    const plain = setQuality(setAccidental(chromatic, 0, 0), 0, null);
    expect(plain[0]).toEqual(first);
    expect(plain[0]).not.toHaveProperty('accidental');
    expect(plain[0]).not.toHaveProperty('quality');
  });

  it('sets the size a quality spells, and Size then goes back to the scale’s own', () => {
    const dom7 = setQuality(FOUR, 0, 'dom7');
    expect(dom7[0]).toMatchObject({ quality: 'dom7', size: CHORD_SIZE_SEVENTH });
    expect(setQuality(dom7, 0, 'min')[0]).toMatchObject({ quality: 'min', size: CHORD_SIZE_TRIAD });
    const triad = setSize(dom7, 0, CHORD_SIZE_TRIAD)[0];
    expect(triad).toEqual(first);
  });

  it('keeps an edit through the document merge, reporting nothing', async () => {
    await loadBuiltIns();
    const model = new DocumentModel({
      version: ARRANGEMENT_VERSION,
      transport: { bpm: 120, bars: 4 },
      harmony: { root: 0, scale: 'naturalMinor', events: [{ ...first, duration: 4 * BAR }] },
      parts: [
        {
          slot: 0,
          name: 'kick',
          preset: 'kick',
          regions: [{ start: 0, duration: 4 * BAR }],
          sequencer: { kind: 'euclidean', seed: 0, note: 36, hold: 0.2 },
        },
      ],
    });
    const events = setQuality(setAccidental(model.doc.harmony.events, 0, -1), 0, 'maj');
    model.merge({ harmony: { events } });
    expect(model.doc.harmony.events[0]).toEqual({
      start: 0,
      duration: 4 * BAR,
      degree: 0,
      size: CHORD_SIZE_TRIAD,
      quality: 'maj',
      accidental: -1,
    });
    model.merge({ harmony: { events: setQuality(setAccidental(events, 0, 0), 0, null) } });
    expect(model.doc.harmony.events[0]).toEqual({
      start: 0,
      duration: 4 * BAR,
      degree: 0,
      size: CHORD_SIZE_TRIAD,
    });
    expect(model.corrections).toEqual([]);
  });
});

describe('deleting', () => {
  it('deletes event 3 into event 2, which absorbs its bar', () => {
    expect(spans(removeEvent(FOUR, 2, SONG))).toEqual([
      [0, BAR],
      [BAR, 2 * BAR],
      [3 * BAR, 3 * BAR],
    ]);
  });

  it('deletes event 1 into event 2, which then starts at 0', () => {
    const out = removeEvent(FOUR, 0, SONG);
    expect(spans(out)[0]).toEqual([0, 2 * BAR]);
    expect(out[0]?.degree).toBe(5);
  });
});

describe('a song-length change', () => {
  it('clamps the timeline to a shorter song and reports it', () => {
    const out = fitEvents(FOUR, 4 * BAR);
    expect(out.changed).toBe(true);
    expect(spans(out.events)).toEqual([
      [0, BAR],
      [BAR, BAR],
      [2 * BAR, BAR],
      [3 * BAR, BAR],
    ]);
    expect(fitEvents(FOUR, 2 * BAR).events).toHaveLength(2);
  });

  it('extends the last event to a longer song, and moves nothing for the same one', () => {
    const out = fitEvents(FOUR, 8 * BAR);
    expect(out.changed).toBe(true);
    expect(spans(out.events)[3]).toEqual([3 * BAR, 5 * BAR]);
    expect(fitEvents(FOUR, SONG)).toEqual({ events: FOUR, changed: false });
  });
});

describe('labels', () => {
  const key: Harmony = { root: 0, scale: 'naturalMinor', events: FOUR };

  it('names a block the way the engine names the chord it plays', () => {
    const under = chordAt(key, SONG, 0);
    expect(eventLabel(key, FOUR[0] as HarmonyEvent)).toEqual({
      name: 'C min',
      numeral: 'i',
      sizeTag: 'triad',
    });
    expect(under?.tonesRoot).toBe(0);
    expect(
      eventLabel(key, { ...(FOUR[3] as HarmonyEvent), size: CHORD_SIZE_SEVENTH }).sizeTag,
    ).toBe('7th');
  });

  it('names a chromatic event by its moved stack and flats or sharps its numeral (windsor#330)', () => {
    const major: Harmony = { root: 0, scale: 'major', events: FOUR };
    const flatVi = { ...(FOUR[1] as HarmonyEvent), accidental: -1 } as const;
    expect(eventLabel(major, { ...flatVi, quality: 'maj' })).toEqual({
      name: 'G# maj',
      numeral: '♭VI',
      sizeTag: 'triad',
    });
    expect(eventLabel(major, flatVi)).toMatchObject({ name: 'G# min', numeral: '♭vi' });
    expect(
      eventLabel(major, { ...(FOUR[0] as HarmonyEvent), quality: 'maj', accidental: -1 }),
    ).toMatchObject({ name: 'B maj', numeral: '♭I' });
  });

  it('offers one chip per scale degree with its numeral and pitch in the key', () => {
    const chips = degreeChips(key, CHORD_SIZE_TRIAD);
    expect(chips).toHaveLength(7);
    expect(chips[0]).toEqual({ degree: 0, numeral: 'i', pitch: 'C' });
    expect(chips[2]?.pitch).toBe('D#');
    expect(chips[2]?.numeral).toBe('III');
  });

  it("presses the chip of an event's folded degree, octave carry and all", () => {
    expect(chipDegree(key, ev(0, BAR, 3))).toBe(3);
    expect(chipDegree(key, ev(0, BAR, 7))).toBe(0);
    expect(chipDegree(key, ev(0, BAR, 16))).toBe(2);
  });

  it('reads a bar number, and a duration in bars and beats', () => {
    expect(eventBar(FOUR[2] as HarmonyEvent)).toBe(3);
    expect(durationLabel(2 * BAR + PPQ)).toBe('2 bars · 1 beat');
    expect(durationLabel(BAR)).toBe('1 bar');
    expect(durationLabel(3 * PPQ)).toBe('3 beats');
  });
});

describe("the song's beats (windsor#430 decision 3)", () => {
  const SEVEN = meterBeats('7/8');
  const SIX = meterBeats('6/8');

  it('snaps 7/8 on 24 · 48 · 84 and 6/8 on dotted quarters', () => {
    expect([30, 40, 60, 70, 90].map((t) => snapToBeats(t, SEVEN))).toEqual([24, 48, 48, 84, 84]);
    expect(snapToBeats(60, SEVEN, 'ceil')).toBe(84);
    expect(snapToBeats(110, SEVEN, 'floor')).toBe(108);
    expect(snapToBeats(50, SIX)).toBe(36);
    // The Duration dial with Shift steps off where it stands, onto the next beat each way.
    expect([dialBeat(72, 84, SEVEN), dialBeat(96, 84, SEVEN), dialBeat(72, 48, SEVEN)]).toEqual([
      48, 108, 84,
    ]);
  });

  it('reads and writes bars and counted beats', () => {
    expect(barsBeats(84 + 48, SEVEN)).toEqual({ bars: 1, beats: 2 });
    expect(toTicks(1, 2, SEVEN)).toBe(84 + 48);
    expect(durationLabel(84 + 24, SEVEN)).toBe('1 bar · 1 beat');
    expect(durationLabel(36, SIX)).toBe('1 beat');
    expect(eventBar(ev(168, 84, 0), SEVEN)).toBe(3);
  });
});
