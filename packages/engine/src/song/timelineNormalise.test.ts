/**
 * A region's own pattern through the document normaliser (windsor#73, epic
 * windsor#70): it round-trips, it is normalised with exactly the rules the
 * part's `sequencer` gets, one of the wrong kind is dropped and reported, a
 * seed inside one is dropped silently, and it travels with its region through
 * the sort, the clamp and the drop — in `makeArrangement` and in the player's
 * `fitTimelines` alike.
 */
import { describe, expect, it } from 'vitest';

import { HOLD_MAX, MIDI_NOTE_MAX } from '../audioConstants';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import {
  ALL,
  CHORD_PATTERN_A,
  CHORD_PATTERN_B,
  KICK,
  REGION_PATTERN_CHORD,
  play,
  song,
} from '../__fixtures__/documentCases';
import type { Arrangement } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { FieldNormaliser } from './arrangementFields';
import { normaliseSequencer } from './sequencerNormalise';
import { fitTimelines } from './timelineNormalise';

const BAR = TICKS_PER_BAR;

/** One part (slot 0) with the given regions and sequencer, normalised; its regions and the report. */
function regionsOf(
  regions: unknown,
  sequencer: Record<string, unknown>,
): { regions: unknown; corrections: string[] } {
  const result = makeArrangement(
    song([{ slot: 0, name: 'p', preset: 'drone-sqr', regions, sequencer }]),
  );
  return { regions: result.document.parts[0]?.regions, corrections: result.corrections };
}

/** What `part.sequencer` normalises `raw` to, less the seed — the rule a pattern must match. */
function asSequencer(raw: Record<string, unknown>): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    ...normaliseSequencer(raw, 'x', new FieldNormaliser()),
  };
  delete spec.seed;
  return spec;
}

describe('region patterns in the song document (windsor#73)', () => {
  it('round-trips a different chord pattern on each of two regions, unchanged', () => {
    const first = makeArrangement(song([KICK, REGION_PATTERN_CHORD]));
    expect(first.corrections).toEqual([]);
    expect(first.document.parts[1]?.regions).toEqual(REGION_PATTERN_CHORD.regions);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.corrections).toEqual([]);
    expect(second.document).toStrictEqual(first.document);
    expect(() => play(first.document)).not.toThrow();
  });

  it('leaves a region without a pattern without one: nothing is copied from the part', () => {
    const { regions, corrections } = regionsOf(
      [
        { start: 0, duration: BAR },
        { start: BAR, duration: BAR, pattern: CHORD_PATTERN_B },
      ],
      CHORD_PATTERN_A,
    );
    expect(corrections).toEqual([]);
    expect(regions).toStrictEqual([
      { start: 0, duration: BAR },
      { start: BAR, duration: BAR, pattern: CHORD_PATTERN_B },
    ]);
  });

  it('drops a pattern of another kind than the part, and junk, reported', () => {
    const grid = { kind: 'grid', divisor: 6 };
    const { regions, corrections } = regionsOf(
      [
        { start: 0, duration: BAR, pattern: grid },
        { start: BAR, duration: BAR, pattern: 'loud' },
        { start: 2 * BAR, duration: BAR, pattern: { divisor: 24 } },
      ],
      { kind: 'chord' },
    );
    expect(regions).toStrictEqual([
      { start: 0, duration: BAR },
      { start: BAR, duration: BAR },
      { start: 2 * BAR, duration: BAR },
    ]);
    expect(corrections).toEqual([
      `parts[0].regions[0].pattern.kind: "grid" is not the part's kind chord — pattern dropped, the region plays the part's`,
      `parts[0].regions[1].pattern: "loud" is not a pattern — dropped, the region plays the part's`,
      `parts[0].regions[2].pattern.kind: undefined is not the part's kind chord — pattern dropped, the region plays the part's`,
    ]);
  });

  it("drops a pattern's seed silently, for a seeded kind and an unseeded one", () => {
    const euclid = { kind: 'euclidean', note: 40, hold: 0.2, steps: 8, seed: 99 };
    const seeded = regionsOf([{ start: 0, duration: BAR, pattern: euclid }], {
      kind: 'euclidean',
      seed: 7,
    });
    expect(seeded.corrections).toEqual([]);
    expect(seeded.regions).toStrictEqual([
      { start: 0, duration: BAR, pattern: asSequencer({ ...euclid, seed: 0 }) },
    ]);
    const chord = regionsOf(
      [{ start: 0, duration: BAR, pattern: { ...CHORD_PATTERN_A, seed: 3 } }],
      {
        kind: 'chord',
      },
    );
    expect(chord.corrections).toEqual([]);
    expect(chord.regions).toStrictEqual([{ start: 0, duration: BAR, pattern: CHORD_PATTERN_A }]);
  });

  it("clamps a pattern's fields exactly as the part's sequencer's, reported at the pattern", () => {
    const wild = { kind: 'euclidean', note: 200, hold: 99, steps: 8, colour: 'red' };
    const { regions, corrections } = regionsOf([{ start: 0, duration: BAR, pattern: wild }], {
      kind: 'euclidean',
      seed: 1,
    });
    const pattern = asSequencer({ ...wild, seed: 0 });
    expect(pattern).toMatchObject({ note: MIDI_NOTE_MAX, hold: HOLD_MAX });
    expect(regions).toStrictEqual([{ start: 0, duration: BAR, pattern }]);
    const at = 'parts[0].regions[0].pattern';
    expect(corrections).toEqual([
      `${at}.note: clamped 200 to ${MIDI_NOTE_MAX}`,
      `${at}.hold: clamped 99 to ${HOLD_MAX}`,
      `${at}.colour: unknown key dropped`,
    ]);
  });

  it('keeps each surviving region its own pattern through the sort, the clamp and the drop', () => {
    const { regions, corrections } = regionsOf(
      [
        { start: 2 * BAR, duration: 4 * BAR, pattern: CHORD_PATTERN_B },
        { start: BAR, duration: 0, pattern: { ...CHORD_PATTERN_A, gate: 7 } },
        { start: 0, duration: 3 * BAR, pattern: CHORD_PATTERN_A },
      ],
      { kind: 'chord' },
    );
    // The dropped region's pattern is never read, so its bad gate is not reported.
    expect(corrections).toEqual([
      'parts[0].regions[2].duration: clamped 288 to 96',
      'parts[0].regions[1]: no length left inside the song — region dropped',
      'parts[0].regions[0].duration: clamped 384 to 192',
    ]);
    expect(regions).toStrictEqual([
      { start: 0, duration: BAR, pattern: CHORD_PATTERN_A },
      { start: 2 * BAR, duration: 2 * BAR, pattern: CHORD_PATTERN_B },
    ]);
  });

  it('keeps and re-checks patterns when the player fits a live partial to the song', () => {
    const { document } = makeArrangement(song([REGION_PATTERN_CHORD]));
    expect(fitTimelines(document)).toStrictEqual(document);
    const shorter: Arrangement = { ...document, transport: { ...document.transport, bars: 3 } };
    expect(fitTimelines(shorter).parts[0]?.regions).toStrictEqual([
      { start: 0, duration: 2 * BAR, pattern: CHORD_PATTERN_A },
      { start: 2 * BAR, duration: BAR, pattern: CHORD_PATTERN_B },
    ]);
    const regions = document.parts[0]?.regions ?? [];
    const kindChanged: Arrangement = {
      ...document,
      parts: [{ ...document.parts[0]!, sequencer: { kind: 'none' }, regions }],
    };
    expect(fitTimelines(kindChanged).parts[0]?.regions).toStrictEqual([
      { start: 0, duration: 2 * BAR },
      { start: 2 * BAR, duration: 2 * BAR },
    ]);
  });

  it('normalises a song with no region patterns with no pattern keys at all', () => {
    const result = makeArrangement(song([KICK]));
    expect(result.document.parts[0]?.regions).toStrictEqual(ALL);
  });
});

/** A four-bar song in `key` with the given harmony events, normalised; its events and the report. */
function eventsOf(
  events: unknown[],
  key: Record<string, unknown> = { root: 0, scale: 'major' },
): { events: unknown; corrections: string[]; document: Arrangement } {
  const result = makeArrangement(song([KICK], { harmony: { ...key, events } }));
  return { ...result, events: result.document.harmony.events };
}

describe('chromatic harmony events (windsor#330 decision 5)', () => {
  const at = (start: number, fields: Record<string, unknown>): Record<string, unknown> => ({
    start,
    duration: BAR,
    degree: 0,
    size: 3,
    ...fields,
  });

  it('keeps a named quality and a flat or sharp, in the canonical field order', () => {
    const { events, corrections, document } = eventsOf([
      { accidental: -1, quality: 'maj', size: 3, degree: 5, duration: BAR, start: 0 },
      at(BAR, { accidental: 1 }),
      at(2 * BAR, { quality: 'dim7', size: 4 }),
      at(3 * BAR, {}),
    ]);
    expect(corrections).toEqual([]);
    expect(events).toStrictEqual([
      { start: 0, duration: BAR, degree: 5, size: 3, quality: 'maj', accidental: -1 },
      { start: BAR, duration: BAR, degree: 0, size: 3, accidental: 1 },
      { start: 2 * BAR, duration: BAR, degree: 0, size: 4, quality: 'dim7' },
      { start: 3 * BAR, duration: BAR, degree: 0, size: 3 },
    ]);
    const first = document.harmony.events[0] ?? {};
    expect(Object.keys(first)).toEqual([
      'start',
      'duration',
      'degree',
      'size',
      'quality',
      'accidental',
    ]);
    // The export round-trips: normalising it again changes nothing, and the live fit agrees.
    const again = makeArrangement(JSON.parse(JSON.stringify(document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toStrictEqual(document);
    expect(fitTimelines(document)).toStrictEqual(document);
  });

  it('sets the size from the quality: silently when absent, reported when it disagrees', () => {
    // V7 in A natural minor, written as a triad.
    const minor = { root: 9, scale: 'naturalMinor' };
    const absent = eventsOf([{ start: 0, duration: 4 * BAR, degree: 4, quality: 'dom7' }], minor);
    expect(absent.corrections).toEqual([]);
    expect(absent.events).toStrictEqual([
      { start: 0, duration: 4 * BAR, degree: 4, size: 4, quality: 'dom7' },
    ]);
    const triad = eventsOf(
      [at(0, { degree: 4, size: 3, quality: 'dom7', duration: 4 * BAR })],
      minor,
    );
    expect(triad.events).toStrictEqual(absent.events);
    expect(triad.corrections).toEqual([
      "harmony.events[0].size: 3 is not dom7's 4 tones — corrected",
    ]);
  });

  it('drops a quality or an accidental it does not know, reported; a natural 0 silently', () => {
    const { events, corrections } = eventsOf([
      at(0, { quality: 'other' }),
      at(BAR, { quality: 'maj9' }),
      at(2 * BAR, { accidental: 2 }),
      at(3 * BAR, { accidental: 0.5, quality: 'min' }),
    ]);
    expect(events).toStrictEqual([
      at(0, {}),
      at(BAR, {}),
      at(2 * BAR, {}),
      at(3 * BAR, { quality: 'min' }),
    ]);
    expect(corrections).toEqual([
      `harmony.events[0].quality: "other" is not a chord quality — the scale's own chord`,
      `harmony.events[1].quality: "maj9" is not a chord quality — the scale's own chord`,
      'harmony.events[2].accidental: 2 is not a flat (-1) or a sharp (1) — natural',
      'harmony.events[3].accidental: 0.5 is not a flat (-1) or a sharp (1) — natural',
    ]);
    const natural = eventsOf([at(0, { accidental: 0, duration: 4 * BAR })]);
    expect(natural.corrections).toEqual([]);
    expect(natural.events).toStrictEqual([at(0, { duration: 4 * BAR })]);
  });
});
