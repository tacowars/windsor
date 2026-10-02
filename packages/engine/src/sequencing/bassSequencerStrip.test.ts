/**
 * Basslead's step strip in the generator (windsor#367, record
 * `2026-10-01-sequencer-rack-devices` decisions 6, 9 and 10): rests, ties,
 * the loop length, and a note step's octave, accent, slide, lanes and
 * ratchet over the pitch the mode draws. Fixture: C natural minor on `i`,
 * the part at octave 2, a step a quarter note.
 */
import { describe, expect, it } from 'vitest';

import { CHORD_SIZE_TRIAD } from '../audioConstants';
import { chordAt, type Harmony } from '../harmony/harmonyTimeline';
import {
  BassSequencer,
  DEFAULT_BASS_CONFIG,
  bassNote,
  defaultBassSteps,
  type BassSequencerConfig,
  type BassStep,
} from './bassSequencer';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import type { PartTickEvent } from './regionGate';
import { ScaleSampler, SEMITONES_PER_OCTAVE } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';
import { STEP_MOD_PARAMS, STEP_MOD_SLOT_COUNT } from '../worklet/fm/stepModTables';

const BAR = TICKS_PER_BAR;
const QUARTER = DIVISORS.quarter;
const OCTAVE = 2;
const SECONDS_PER_TICK = 0.01;
const REST: BassStep = { kind: 'rest' };
const TIE: BassStep = { kind: 'tie' };

const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [{ start: 0, duration: 4 * BAR, degree: 0, size: CHORD_SIZE_TRIAD }],
};
const sampler = new ScaleSampler(HARMONY);
const C2 = sampler.noteFor(0, OCTAVE);
const C3 = C2 + SEMITONES_PER_OCTAVE;

/** A fixed C2 pedal at quarters, so only the strip and the density decide what plays. */
const bass = (over: Partial<BassSequencerConfig> = {}): BassSequencer => {
  const steps = over.steps ?? defaultBassSteps(QUARTER);
  return new BassSequencer(sampler, {
    ...DEFAULT_BASS_CONFIG,
    pitchMode: 'fixed',
    divisor: QUARTER,
    register: { octave: OCTAVE },
    length: steps.length,
    ...over,
    steps,
  });
};

/** Every local tick of `count` steps, as the gate hands them to a generator subscribed at 1. */
function drive(seq: BassSequencer, count: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let tick = 0; tick < count * seq.config.divisor; tick++) {
    const event: PartTickEvent = {
      tick,
      step: tick,
      bar: Math.floor(tick / BAR),
      tickInBar: tick % BAR,
      seconds: tick * SECONDS_PER_TICK,
      secondsPerTick: SECONDS_PER_TICK,
      time: tick * SECONDS_PER_TICK,
      chord: chordAt(HARMONY, 4 * BAR, tick),
      regionIndex: 0,
    };
    events.push(...seq.handleTick(event));
  }
  return events;
}

/** Each event as `[kind, tick, note]`. */
const trace = (events: NoteEvent[]): Array<[string, number, number]> =>
  events.map((e) => [e.kind, e.tick, e.note]);
const ons = (events: NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
/** Which steps struck, as `x` and `.`. */
const struck = (events: NoteEvent[], count: number): string => {
  const at = new Set(ons(events).map((e) => e.tick / QUARTER));
  return Array.from({ length: count }, (_, k) => (at.has(k) ? 'x' : '.')).join('');
};

describe('rests and ties (windsor#367 decision 4)', () => {
  it('a rest releases the held note and plays nothing', () => {
    const events = drive(bass({ gate: 1, steps: [bassNote(), REST] }), 2);
    expect(trace(events)).toEqual([
      ['noteOn', 0, C2],
      ['noteOff', QUARTER, C2],
    ]);
  });

  it('a rest and a tie draw nothing: the note steps sound as a strip of notes alone would', () => {
    const notes = struck(drive(bass({ gate: 0.5, density: 0.5, seed: 4 }), 16), 16);
    const written: BassStep[] = [bassNote(), REST, bassNote(), TIE];
    const mixed = drive(bass({ gate: 0.5, density: 0.5, seed: 4, steps: written }), 32);
    const noteSteps = struck(mixed, 32)
      .split('')
      .filter((_, k) => k % 2 === 0)
      .join('');
    expect(noteSteps).toBe(notes);
    expect(noteSteps).toMatch(/x/);
    expect(noteSteps).toMatch(/\./);
  });

  it('a tie holds the note on and moves its release to gate of the tie’s step', () => {
    const events = drive(bass({ gate: 0.5, steps: [bassNote(), TIE, REST, REST] }), 4);
    expect(trace(events)).toEqual([
      ['noteOn', 0, C2],
      ['noteOff', QUARTER + QUARTER / 2, C2],
    ]);
  });

  it('ties chain: the note runs through each to the last one’s gate', () => {
    const events = drive(bass({ gate: 0.5, steps: [bassNote(), TIE, TIE, REST] }), 4);
    expect(trace(events)).toEqual([
      ['noteOn', 0, C2],
      ['noteOff', 2 * QUARTER + QUARTER / 2, C2],
    ]);
  });

  it('at gate 1 a tie holds until the next note or rest', () => {
    const events = drive(bass({ gate: 1, steps: [bassNote(), TIE, REST, REST] }), 4);
    expect(trace(events)).toEqual([
      ['noteOn', 0, C2],
      ['noteOff', 2 * QUARTER, C2],
    ]);
  });

  it('a tie with nothing held is silent', () => {
    expect(drive(bass({ gate: 0.5, steps: [REST, TIE] }), 4)).toEqual([]);
    const skipped = drive(bass({ gate: 0.5, density: 0, steps: [bassNote(), TIE] }), 4);
    expect(skipped).toEqual([]);
  });
});

describe('the loop (windsor#367 decision 2)', () => {
  it('length below the steps written loops over the first `length`', () => {
    const steps: BassStep[] = [bassNote(), REST, bassNote({ octave: 1 }), bassNote()];
    const seq = bass({ gate: 0.5, steps, length: 2 });
    const notes = ons(drive(seq, 6)).map((e) => [e.tick / QUARTER, e.note]);
    expect(notes).toEqual([
      [0, C2],
      [2, C2],
      [4, C2],
    ]);
    expect(seq.config.steps).toHaveLength(4);
    expect([0, 1, 2, 3].map((k) => seq.stepAt(k))).toEqual([0, 1, 0, 1]);
  });

  it('a note before a tie that wraps the loop holds across it', () => {
    const events = drive(bass({ gate: 0.5, steps: [TIE, REST, bassNote()] }), 4);
    expect(trace(events)).toEqual([
      ['noteOn', 2 * QUARTER, C2],
      ['noteOff', 3 * QUARTER + QUARTER / 2, C2],
    ]);
  });
});

describe('a note step (windsor#367 decision 3)', () => {
  it('adds its octave to the pitch the mode drew', () => {
    const steps = [bassNote({ octave: 1 }), bassNote({ octave: -1 })];
    const notes = ons(drive(bass({ gate: 0.5, steps }), 2)).map((e) => e.note);
    expect(notes).toEqual([C3, C2 - SEMITONES_PER_OCTAVE]);
  });

  it('an accent rides on the note-on with the part’s amounts; a plain note has none', () => {
    const steps = [bassNote({ accent: true }), bassNote()];
    const [accented, plain] = ons(
      drive(bass({ gate: 0.5, accentVelocity: 0.3, accentMod: 0.6, steps }), 2),
    );
    expect(accented?.accent).toEqual({ velocity: 0.3, mod: 0.6 });
    expect(plain?.accent).toBeUndefined();
  });

  it('a slide holds the note before it, then takes the voice legato before the old off', () => {
    const steps = [bassNote(), bassNote({ slide: true, octave: 1 }), REST, REST];
    const events = drive(bass({ gate: 0.5, steps }), 4);
    expect(trace(events)).toEqual([
      ['noteOn', 0, C2],
      ['noteOn', QUARTER, C3],
      ['noteOff', QUARTER, C2],
      ['noteOff', QUARTER + QUARTER / 2, C3],
    ]);
    expect(ons(events)[1]?.slide).toBe(true);
  });

  it('a slide with nothing held is a plain note, and a slide to the pitch held a tie', () => {
    const alone = ons(drive(bass({ gate: 0.5, steps: [REST, bassNote({ slide: true })] }), 2));
    expect(alone.map((e) => [e.note, e.slide])).toEqual([[C2, undefined]]);
    const same = drive(
      bass({ gate: 0.5, steps: [bassNote(), bassNote({ slide: true }), REST] }),
      3,
    );
    expect(trace(same)).toEqual([
      ['noteOn', 0, C2],
      ['noteOff', QUARTER + QUARTER / 2, C2],
    ]);
  });

  it('carries the lanes’ offsets at its step; a step where every lane reads 0 carries none', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.5, 0, -0.25] }];
    const steps = [bassNote(), bassNote(), bassNote()];
    const [first, second, third] = ons(drive(bass({ gate: 0.5, steps, lanes }), 3));
    const slots = (value: number): number[] => {
      const offsets = new Array<number>(STEP_MOD_SLOT_COUNT).fill(0);
      offsets[STEP_MOD_PARAMS.indexOf('filter.cutoff')] = value;
      return offsets;
    };
    expect(first?.stepMod).toEqual(slots(0.5));
    expect(second?.stepMod).toBeUndefined();
    expect(third?.stepMod).toEqual(slots(-0.25));
  });

  it('keeps the gate-1 rule for a plain repeat: the note continues', () => {
    expect(trace(drive(bass({ gate: 1 }), 4))).toEqual([['noteOn', 0, C2]]);
  });
});

describe('a ratchet (windsor#367 decision 3, windsor#366’s roll)', () => {
  it('×3 at gate 0.5 marks the note-on a closed roll and leaves nothing held', () => {
    const seq = bass({ gate: 0.5, steps: [bassNote({ ratchet: 3 }), REST] });
    const events = drive(seq, 1);
    expect(trace(events)).toEqual([['noteOn', 0, C2]]);
    expect(ons(events)[0]?.roll).toEqual({
      hits: 3,
      ticks: QUARTER,
      secondsPerTick: SECONDS_PER_TICK,
      gate: 0.5,
      open: false,
    });
    expect(seq.heldNote).toBeNull();
  });

  it('is held open where the plain note would run on: before a tie, and at gate 1', () => {
    const tied = bass({ gate: 0.5, steps: [bassNote({ ratchet: 2 }), TIE] });
    expect(ons(drive(tied, 1))[0]?.roll?.open).toBe(true);
    expect(tied.heldNote).toBe(C2);
    const whole = bass({ gate: 1, steps: [bassNote({ ratchet: 2 })] });
    expect(ons(drive(whole, 1))[0]?.roll?.open).toBe(true);
  });

  it('at gate 1 strikes its roll on the pitch held, where a plain repeat ties', () => {
    const steps = [bassNote(), bassNote({ ratchet: 2 })];
    const events = drive(bass({ gate: 1, steps }), 2);
    expect(trace(events)).toEqual([
      ['noteOn', 0, C2],
      ['noteOff', QUARTER, C2],
      ['noteOn', QUARTER, C2],
    ]);
    expect(ons(events)[1]?.roll?.hits).toBe(2);
  });

  it('draws once, before the roll: the struck steps are those of a plain strip, and a skip plays no hit', () => {
    const plain = struck(drive(bass({ gate: 0.5, density: 0.5, seed: 4 }), 16), 16);
    const rolled = drive(
      bass({ gate: 0.5, density: 0.5, seed: 4, steps: [bassNote({ ratchet: 3 })] }),
      16,
    );
    expect(struck(rolled, 16)).toBe(plain);
    expect(ons(rolled).every((e) => e.roll?.hits === 3)).toBe(true);
    expect(drive(bass({ density: 0, steps: [bassNote({ ratchet: 3 })] }), 4)).toEqual([]);
  });
});
