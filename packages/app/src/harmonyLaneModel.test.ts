/**
 * The harmony lane's edits over the ticket's fixtures (#709 decision 4): a
 * resize shifts what follows and the last event absorbs it at the song end,
 * a resize past what it can absorb is clamped, a delete merges into the
 * previous event (the first into the next), an append takes a bar of the
 * last degree, and a song-length change extends or clamps the tail. Every
 * expectation is an expression of the engine's tick constants.
 */
import { describe, expect, it } from 'vitest';

import type { Harmony, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD, PPQ, TICKS_PER_BAR, chordAt } from '@windsor/engine';
import {
  appendEvent,
  degreeChips,
  durationLabel,
  eventBar,
  eventLabel,
  fitEvents,
  maxEventDuration,
  removeEvent,
  resizeEventBy,
  setEventDuration,
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

describe('deleting and appending', () => {
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

  it('appends a bar of the last degree, taken from the last event', () => {
    const out = appendEvent(FOUR, SONG);
    expect(spans(out).slice(-2)).toEqual([
      [3 * BAR, 2 * BAR],
      [5 * BAR, BAR],
    ]);
    expect(out[out.length - 1]?.degree).toBe(6);
  });

  it('appends half a short last event, down to a beat, and nothing when none can be spared', () => {
    const short = [ev(0, SONG - PPQ, 0), ev(SONG - PPQ, PPQ, 3)];
    expect(appendEvent(short, SONG)).toEqual(short);
    const twoBeats = [ev(0, SONG - 2 * PPQ, 0), ev(SONG - 2 * PPQ, 2 * PPQ, 3)];
    expect(spans(appendEvent(twoBeats, SONG)).slice(-2)).toEqual([
      [SONG - 2 * PPQ, PPQ],
      [SONG - PPQ, PPQ],
    ]);
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

  it('offers one chip per scale degree with its numeral and pitch in the key', () => {
    const chips = degreeChips(key, CHORD_SIZE_TRIAD);
    expect(chips).toHaveLength(7);
    expect(chips[0]).toEqual({ degree: 0, numeral: 'i', pitch: 'C' });
    expect(chips[2]?.pitch).toBe('D#');
    expect(chips[2]?.numeral).toBe('III');
  });

  it('reads a bar number, and a duration in bars and beats', () => {
    expect(eventBar(FOUR[2] as HarmonyEvent)).toBe(3);
    expect(durationLabel(2 * BAR + PPQ)).toBe('2 bars · 1 beat');
    expect(durationLabel(BAR)).toBe('1 bar');
    expect(durationLabel(3 * PPQ)).toBe('3 beats');
  });
});

describe("an edge drag by the pointer's travel (windsor#21)", () => {
  it("changes the duration by the travel from the event's own length", () => {
    expect(resizeEventBy(FOUR, 1, BAR, SONG)).toEqual(setEventDuration(FOUR, 1, 2 * BAR, SONG));
    expect(resizeEventBy(FOUR, 1, 0, SONG)).toEqual(FOUR);
  });

  it('lengthens a one-beat event by a beat, not to where its widened edge was drawn', () => {
    const events = [ev(0, PPQ, 0), ev(PPQ, SONG - PPQ, 4)];
    expect(spans(resizeEventBy(events, 0, PPQ, SONG))).toEqual([
      [0, 2 * PPQ],
      [2 * PPQ, SONG - 2 * PPQ],
    ]);
    expect(resizeEventBy(events, 5, PPQ, SONG)).toEqual(events);
  });
});
