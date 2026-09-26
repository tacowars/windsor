/**
 * The harmony timeline (#705, epic #703 decisions 5, 6 and 10): which chord
 * holds at a transport tick, cyclically over the song's length.
 */
import { describe, expect, it } from 'vitest';

import { chordAt, eventBounds, type Harmony } from './harmonyTimeline';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;

/** C natural minor: i for bar 1, VI for bars 2–3 (and, held, bar 4). */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: 3 * BAR, degree: 5, size: 3 },
  ],
};

const degreeAt = (harmony: Harmony, tick: number): number | null =>
  chordAt(harmony, SONG, tick)?.event.degree ?? null;

describe('chordAt', () => {
  it('tick 0 is the first event; the boundary tick belongs to the new event', () => {
    expect(chordAt(HARMONY, SONG, 0)).toMatchObject({ index: 0, event: HARMONY.events[0] });
    expect(degreeAt(HARMONY, BAR - 1)).toBe(0);
    expect(chordAt(HARMONY, SONG, BAR)).toMatchObject({ index: 1, event: HARMONY.events[1] });
  });

  it('a tick past the last event’s end holds the last event', () => {
    const short: Harmony = {
      ...HARMONY,
      events: [HARMONY.events[0]!, { ...HARMONY.events[1]!, duration: BAR }],
    };
    expect(degreeAt(short, 3 * BAR + 5)).toBe(5);
  });

  it('a first event starting at bar 2 means tick 0 holds the last event', () => {
    const late: Harmony = {
      ...HARMONY,
      events: [
        { start: BAR, duration: BAR, degree: 3, size: 3 },
        { start: 2 * BAR, duration: 2 * BAR, degree: 4, size: 4 },
      ],
    };
    expect(chordAt(late, SONG, 0)).toMatchObject({ index: 1, event: late.events[1] });
    expect(degreeAt(late, BAR)).toBe(3);
    expect(degreeAt(late, 2 * BAR)).toBe(4);
  });

  it('tick songTicks + 3 is tick 3: the lookup is tick mod songTicks', () => {
    expect(chordAt(HARMONY, SONG, SONG + 3)).toEqual(chordAt(HARMONY, SONG, 3));
    expect(chordAt(HARMONY, SONG, 2 * SONG + BAR)).toEqual(chordAt(HARMONY, SONG, BAR));
  });

  it('carries the chord root as semitones from the key root, octave carry included', () => {
    // VI in C minor is A♭: eight semitones up. A degree past the scale folds up an octave.
    expect(chordAt(HARMONY, SONG, BAR)?.tonesRoot).toBe(8);
    const high: Harmony = {
      ...HARMONY,
      events: [{ start: 0, duration: SONG, degree: 7, size: 3 }],
    };
    expect(chordAt(high, SONG, 0)?.tonesRoot).toBe(12);
  });

  it('is null with no events or no song', () => {
    expect(chordAt({ ...HARMONY, events: [] }, SONG, 0)).toBeNull();
    expect(chordAt(HARMONY, 0, 0)).toBeNull();
  });
});

describe('eventBounds', () => {
  it('draws each event to the next start and the last to the song end', () => {
    expect(eventBounds(HARMONY, SONG)).toEqual([
      { index: 0, start: 0, end: BAR },
      { index: 1, start: BAR, end: SONG },
    ]);
  });

  it('adds the last event’s hold from tick 0 when the first starts later', () => {
    const late: Harmony = {
      ...HARMONY,
      events: [{ start: BAR, duration: 3 * BAR, degree: 3, size: 3 }],
    };
    expect(eventBounds(late, SONG)).toEqual([
      { index: 0, start: 0, end: BAR },
      { index: 0, start: BAR, end: SONG },
    ]);
    expect(eventBounds({ ...HARMONY, events: [] }, SONG)).toEqual([]);
  });
});
