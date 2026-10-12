/**
 * A Roll note's accent and ratchet in the config and the performer
 * (windsor#753, record `2026-10-12-roll-note-accent-and-ratchet`): the check
 * refuses each out of its range; an accented note-on carries the roll's
 * accent amounts, or the Grid's defaults; a ratcheted one carries a roll
 * over the note's length as played; slide by overlap is unchanged; a
 * ratcheted note keeps its release through a live edit; and the setters and
 * the shared onsets the console reads.
 */
import { describe, expect, it } from 'vitest';

import { ACCENT_MOD_DEFAULT, ACCENT_VELOCITY_DEFAULT, RATCHET_MAX } from '../audioConstants';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import type { PartTickEvent } from './regionGate';
import {
  RollSequencer,
  assertRollConfig,
  rollSharedOnsets,
  withRollNoteAccent,
  withRollNoteRatchet,
  type RollNote,
  type RollSequencerConfig,
} from './rollSequencer';

const SECONDS_PER_TICK = 0.02;

/** A local tick as the region gate hands it over. */
const at = (tick: number): PartTickEvent => ({
  tick,
  step: tick,
  bar: 0,
  tickInBar: tick,
  seconds: tick * SECONDS_PER_TICK,
  secondsPerTick: SECONDS_PER_TICK,
  time: tick * SECONDS_PER_TICK,
  chord: null,
  regionIndex: 0,
});

/** Every event from local tick 0 to `to` − 1. */
function events(roll: RollSequencer, to: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let t = 0; t < to; t++) out.push(...roll.handleTick(at(t)));
  return out;
}

const noteOns = (list: readonly NoteEvent[]): NoteOnEvent[] =>
  list.filter((e): e is NoteOnEvent => e.kind === 'noteOn');

const label = (e: NoteEvent): string =>
  e.kind === 'noteOn' ? `${e.tick}:on:${e.note}${e.slide ? '~' : ''}` : `${e.tick}:off:${e.note}`;

const config = (
  notes: RollNote[],
  over: Partial<RollSequencerConfig> = {},
): RollSequencerConfig => ({
  loopTicks: 96,
  notes,
  ...over,
});

describe('the check (windsor#753)', () => {
  it('accepts an accent, a ratchet of 1 to RATCHET_MAX and accent amounts at their bounds', () => {
    const notes: RollNote[] = [
      { tick: 0, ticks: 24, pitch: 60, accent: true, ratchet: RATCHET_MAX },
      { tick: 24, ticks: 24, pitch: 62, ratchet: 2 },
      { tick: 48, ticks: 24, pitch: 64, ratchet: 1 },
    ];
    expect(() =>
      assertRollConfig(config(notes, { accentVelocity: 0, accentMod: 1 })),
    ).not.toThrow();
    expect(() =>
      assertRollConfig(config(notes, { accentVelocity: 1, accentMod: 0 })),
    ).not.toThrow();
  });

  it.each([
    ['ratchet 5', { ratchet: 5 }, /notes\[0\]\.ratchet/],
    ['ratchet 0', { ratchet: 0 }, /notes\[0\]\.ratchet/],
    ['ratchet 1.5', { ratchet: 1.5 }, /notes\[0\]\.ratchet/],
    ['accent "yes"', { accent: 'yes' }, /notes\[0\]\.accent/],
    ['accent false', { accent: false }, /notes\[0\]\.accent/],
  ])('refuses a note with %s', (_, over, message) => {
    const note = { tick: 0, ticks: 24, pitch: 60, ...over } as unknown as RollNote;
    expect(() => assertRollConfig(config([note]))).toThrow(message);
  });

  it.each([
    ['accentMod', 2],
    ['accentMod', -0.1],
    ['accentVelocity', 1.5],
    ['accentVelocity', Number.NaN],
  ])('refuses %s %s', (key, value) => {
    expect(() => assertRollConfig(config([], { [key]: value }))).toThrow(key);
  });
});

describe('an accented note (windsor#753)', () => {
  it("carries the roll's accent amounts, and the note's own velocity unchanged", () => {
    const note: RollNote = { tick: 0, ticks: 12, pitch: 60, velocity: 0.5, accent: true };
    const roll = new RollSequencer(config([note], { accentVelocity: 0.4, accentMod: 0.25 }));
    const [on] = noteOns(events(roll, 1));
    expect(on).toMatchObject({ velocity: 0.5, accent: { velocity: 0.4, mod: 0.25 } });
  });

  it("carries the Grid's defaults when the roll names none, and a plain note carries no accent", () => {
    const roll = new RollSequencer(
      config([
        { tick: 0, ticks: 12, pitch: 60, accent: true },
        { tick: 12, ticks: 12, pitch: 62 },
      ]),
    );
    const [accented, plain] = noteOns(events(roll, 13));
    expect(accented?.accent).toEqual({
      velocity: ACCENT_VELOCITY_DEFAULT,
      mod: ACCENT_MOD_DEFAULT,
    });
    expect(plain).not.toHaveProperty('accent');
    expect(plain).not.toHaveProperty('roll');
  });

  it('takes new accent amounts live', () => {
    const notes: RollNote[] = [{ tick: 0, ticks: 12, pitch: 60, accent: true }];
    const roll = new RollSequencer(config(notes));
    roll.reconfigure(config(notes, { accentVelocity: 0.1, accentMod: 0.3 }));
    expect(noteOns(events(roll, 1))[0]?.accent).toEqual({ velocity: 0.1, mod: 0.3 });
  });
});

describe('a ratcheted note (windsor#753)', () => {
  it("carries a roll of its hits over its length, open at gate 1, at the tick's tempo", () => {
    const roll = new RollSequencer(config([{ tick: 6, ticks: 18, pitch: 60, ratchet: 3 }]));
    const played = events(roll, 30);
    expect(played.map(label)).toEqual(['6:on:60', '24:off:60']);
    expect(noteOns(played)[0]?.roll).toEqual({
      hits: 3,
      ticks: 18,
      secondsPerTick: SECONDS_PER_TICK,
      gate: 1,
      open: true,
    });
  });

  it('spans only what the loop lets the note play: it is cut at the loop end, as its release is', () => {
    const roll = new RollSequencer(config([{ tick: 90, ticks: 24, pitch: 60, ratchet: 2 }]));
    const played = events(roll, 97);
    expect(played.map(label)).toEqual(['90:on:60', '96:off:60']);
    expect(noteOns(played)[0]?.roll?.ticks).toBe(6);
  });

  it('plays one hit when the loop cut leaves it shorter than ROLL_RATCHET_MIN_TICKS', () => {
    const roll = new RollSequencer(config([{ tick: 95, ticks: 12, pitch: 60, ratchet: 4 }]));
    const played = events(roll, 97);
    expect(played.map(label)).toEqual(['95:on:60', '96:off:60']);
    expect(noteOns(played)[0]).not.toHaveProperty('roll');
  });

  it('keeps its ratchet when the loop cut leaves exactly ROLL_RATCHET_MIN_TICKS', () => {
    const roll = new RollSequencer(config([{ tick: 93, ticks: 12, pitch: 60, ratchet: 4 }]));
    expect(noteOns(events(roll, 97))[0]?.roll).toMatchObject({ hits: 4, ticks: 3 });
  });

  it('slides into an overlapping note of another pitch as a plain note does', () => {
    const roll = new RollSequencer(
      config([
        { tick: 0, ticks: 24, pitch: 60, ratchet: 4 },
        { tick: 18, ticks: 12, pitch: 64 },
      ]),
    );
    expect(events(roll, 31).map(label)).toEqual(['0:on:60', '18:on:64~', '24:off:60', '30:off:64']);
  });

  it('slides on its own onset while another pitch is held, its roll riding on that note-on', () => {
    const roll = new RollSequencer(
      config([
        { tick: 0, ticks: 18, pitch: 60 },
        { tick: 12, ticks: 12, pitch: 67, ratchet: 2, accent: true },
      ]),
    );
    const played = events(roll, 25);
    expect(played.map(label)).toEqual(['0:on:60', '12:on:67~', '18:off:60', '24:off:67']);
    expect(noteOns(played)[1]).toMatchObject({ slide: true, roll: { hits: 2, ticks: 12 } });
  });

  it('keeps its scheduled release through an edit that removes it, since its hits are queued', () => {
    const notes: RollNote[] = [
      { tick: 0, ticks: 24, pitch: 60, ratchet: 2 },
      { tick: 0, ticks: 24, pitch: 64 },
    ];
    const roll = new RollSequencer(config(notes));
    const before = events(roll, 6);
    roll.reconfigure(config([]));
    const after: NoteEvent[] = [];
    for (let t = 6; t < 30; t++) after.push(...roll.handleTick(at(t)));
    expect([...before, ...after].map(label)).toEqual([
      '0:on:60',
      '0:on:64',
      // The plain note goes on the next tick; the ratcheted one at its end.
      '6:off:64',
      '24:off:60',
    ]);
  });
});

describe('the setters and the shared onsets (windsor#753)', () => {
  const NOTE: RollNote = { tick: 0, ticks: 12, pitch: 60, velocity: 0.5 };

  it('set and clear an accent and a ratchet, writing a plain one as no key', () => {
    const marked = withRollNoteRatchet(withRollNoteAccent(NOTE, true), 3);
    expect(marked).toEqual({ ...NOTE, accent: true, ratchet: 3 });
    const cleared = withRollNoteRatchet(withRollNoteAccent(marked, false), 1);
    expect(cleared).toEqual(NOTE);
    expect(Object.keys(cleared)).toEqual(['tick', 'ticks', 'pitch', 'velocity']);
    expect(NOTE).not.toHaveProperty('accent');
  });

  it('names each onset two or more notes share, in any order', () => {
    const notes: RollNote[] = [
      { tick: 24, ticks: 6, pitch: 64 },
      { tick: 0, ticks: 6, pitch: 60 },
      { tick: 24, ticks: 6, pitch: 60 },
      { tick: 12, ticks: 6, pitch: 60 },
      { tick: 24, ticks: 6, pitch: 67 },
    ];
    expect([...rollSharedOnsets(notes)]).toEqual([24]);
    expect(rollSharedOnsets([]).size).toBe(0);
  });
});
