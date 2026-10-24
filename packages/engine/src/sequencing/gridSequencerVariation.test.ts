/**
 * The Grid's step variation (windsor#935, record `2026-10-24-step-variation`):
 * parity at either amount 0, the stream per region, the groove kept with
 * Rests sound off and the beat-weighted flip with it on, draws that never
 * move with an edit, the borrow's boundaries, and Octave's pitch classes,
 * symmetry and MIDI bounds. The maths alone is `stepVariation.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { MIDI_NOTE_MAX } from '../audioConstants';
import {
  DEFAULT_GRID_CONFIG,
  GridSequencer,
  gridNote,
  type GridSequencerConfig,
  type GridStep,
} from './gridSequencer';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS } from './scheduler';
import { STEP_VARIATION_TABLE } from './stepVariationConstants';

const STEP = DIVISORS.sixteenth;
/** C natural minor at register octave 3: degree 0 is C3 = 48. */
const minor = new ScaleSampler({ root: 0, scale: 'naturalMinor' });
const REST: GridStep = { kind: 'rest' };
const TIE: GridStep = { kind: 'tie' };
const FULL = { randomness: 1, probability: 1 };

const make = (
  steps: readonly GridStep[],
  over: Partial<GridSequencerConfig> = {},
  table = STEP_VARIATION_TABLE,
  sampler = minor,
): GridSequencer =>
  new GridSequencer(
    sampler,
    { ...DEFAULT_GRID_CONFIG, register: { octave: 3 }, steps, length: steps.length, ...over },
    table,
  );

/** `count` steps from local step 0, as the region gate hands them over. */
function drive(seq: GridSequencer, count: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let step = 0; step < count; step++) {
    const tick = step * STEP;
    const tickEvent = { tick, step, bar: 0, tickInBar: 0, seconds: 0, secondsPerTick: 0, time: 0 };
    events.push(...seq.handleTick(tickEvent));
  }
  return events;
}

const onsOf = (events: readonly NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
/** Each local step's note-on, or null where it struck nothing. */
const byStep = (events: readonly NoteEvent[], count: number): (NoteOnEvent | null)[] => {
  const at = new Map(onsOf(events).map((e) => [e.tick / STEP, e]));
  return Array.from({ length: count }, (_, s) => at.get(s) ?? null);
};

/** Every kind of step: rests, a tie, accents, a slide and a ratchet. */
const LINE: GridStep[] = [
  gridNote(0, { accent: true }),
  gridNote(2),
  TIE,
  REST,
  gridNote(4, { slide: true }),
  gridNote(6, { ratchet: 3 }),
  REST,
  gridNote(1, { octave: 1 }),
];
/** Eight distinct plain notes: what sounds is exactly which steps strike. */
const PLAIN = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => gridNote(d));

describe('parity and the stream', () => {
  it('at Randomness 0 or Probability 0 emits exactly what a plain line does, event for event', () => {
    const plain = drive(make(LINE), 64);
    const switches = { restsSound: true, octaveMode: true, seed: 5 };
    expect(drive(make(LINE, { ...switches, randomness: 0, probability: 1 }), 64)).toEqual(plain);
    expect(drive(make(LINE, { ...switches, randomness: 1, probability: 0 }), 64)).toEqual(plain);
  });

  it('plays the same for the same seed and region, and replays on re-entry', () => {
    const over = { ...FULL, restsSound: true, seed: 9 };
    const first = drive(make(LINE, over), 64);
    expect(drive(make(LINE, over), 64)).toEqual(first);
    expect(drive(make(LINE, { ...over, seed: 10 }), 64)).not.toEqual(first);
    const seq = make(LINE, over);
    drive(seq, 64);
    seq.release(0, 0);
    seq.enter(0);
    expect(drive(seq, 64)).toEqual(first);
    seq.release(0, 0);
    seq.enter(1);
    expect(drive(seq, 64)).not.toEqual(first);
  });
});

describe('the rhythm', () => {
  it('with Rests sound off, the sounding steps are the written ones at every amount, over 1,000 passes', () => {
    const line = [gridNote(0), REST, gridNote(2), TIE, gridNote(4), REST, REST, gridNote(5)];
    const written = line.map((s) => s.kind === 'note');
    for (const randomness of [0.3, 1]) {
      for (const octaveMode of [false, true]) {
        const seq = make(line, { randomness, probability: 1, octaveMode, seed: 2 });
        const sounding = byStep(drive(seq, 8 * 1000), 8 * 1000).map((on) => on !== null);
        expect(sounding).toEqual(Array.from({ length: 8000 }, (_, s) => written[s % 8]));
      }
    }
  });

  it('with Rests sound on, a beat flips about half as often as an off-beat step', () => {
    const passes = 2000;
    const seq = make(PLAIN, { ...FULL, restsSound: true, seed: 4 });
    const struck = byStep(drive(seq, 8 * passes), 8 * passes);
    const rate = (onBeat: boolean): number => {
      const steps = struck.filter((_, s) => (s % 4 === 0) === onBeat);
      return steps.filter((on) => on === null).length / steps.length;
    };
    expect(rate(false)).toBeCloseTo(STEP_VARIATION_TABLE.flipOffbeat, 1);
    expect(rate(true)).toBeCloseTo(STEP_VARIATION_TABLE.flipOnbeat, 1);
    expect(rate(true) / rate(false)).toBeGreaterThan(0.4);
    expect(rate(true) / rate(false)).toBeLessThan(0.6);
  });

  it('a flipped rest sounds the nearest note step plain; a tie never flips; a silenced ratchet plays no hit', () => {
    const line = [gridNote(3, { accent: true, ratchet: 2 }), REST, TIE, gridNote(5)];
    const ons = onsOf(drive(make(line, { ...FULL, restsSound: true, seed: 1 }), 400));
    const fromRests = ons.filter((e) => (e.tick / STEP) % 4 === 1);
    expect(fromRests.length).toBeGreaterThan(0);
    for (const on of fromRests) {
      expect(on.accent).toBeUndefined();
      expect(on.roll).toBeUndefined();
      expect(on.slide).toBeUndefined();
    }
    expect(ons.some((e) => (e.tick / STEP) % 4 === 2)).toBe(false);
  });
});

describe('the draws never move with an edit', () => {
  const traits = (on: NoteOnEvent | null) => on && { note: on.note, velocity: on.velocity };

  it('editing one step leaves every other step as it played', () => {
    const over = { ...FULL, octaveMode: true, seed: 6 };
    const edited = PLAIN.map((s, i) => (i === 3 ? REST : s));
    const a = byStep(drive(make(PLAIN, over), 800), 800);
    const b = byStep(drive(make(edited, over), 800), 800);
    for (let s = 0; s < 800; s++) {
      if (s % 8 !== 3) expect(traits(b[s]!), `step ${s}`).toEqual(traits(a[s]!));
    }
  });

  it('turning Rests sound on leaves every step it does not flip as it played', () => {
    const over = { ...FULL, octaveMode: true, seed: 6 };
    const off = byStep(drive(make(PLAIN, over), 800), 800);
    const on = byStep(drive(make(PLAIN, { ...over, restsSound: true }), 800), 800);
    expect(on.filter((e) => e === null).length).toBeGreaterThan(0);
    on.forEach((e, s) => e && expect(traits(e), `step ${s}`).toEqual(traits(off[s]!)));
  });
});

describe('the borrow, Octave off', () => {
  it('a line of one step plays its own pitch, at a varied velocity', () => {
    const ons = onsOf(drive(make([gridNote(2)], { ...FULL, seed: 3 }), 64));
    expect(new Set(ons.map((e) => e.note))).toEqual(new Set([51]));
    expect(ons.some((e) => e.velocity !== undefined)).toBe(true);
  });

  it('a line with no note steps keeps its rests', () => {
    const line = [REST, TIE, REST];
    const switches = { restsSound: true, seed: 3 };
    expect(onsOf(drive(make(line, { ...FULL, ...switches }), 300))).toEqual([]);
  });

  it('borrows only inside `length`, and a rest or tie there lends the nearest note', () => {
    // Steps past the loop hold degrees the loop never plays.
    const line = [gridNote(0), REST, gridNote(2), TIE, gridNote(6), gridNote(5)];
    const ons = onsOf(drive(make(line, { ...FULL, length: 4, seed: 8 }), 4000));
    expect(new Set(ons.map((e) => e.note))).toEqual(new Set([48, 51]));
    expect(ons.some((e) => (e.tick / STEP) % 4 === 0 && e.note === 51)).toBe(true);
  });

  it('a slide keeps its rule: a borrowed pitch equal to the held note is a tie', () => {
    const same = [gridNote(0), gridNote(0, { slide: true })];
    const sameRun = drive(make(same, { ...FULL, seed: 2 }), 400);
    expect(onsOf(sameRun).filter((e) => (e.tick / STEP) % 2 === 1)).toEqual([]);
    const moving = [gridNote(0), gridNote(2, { slide: true })];
    const events = drive(make(moving, { ...FULL, seed: 2 }), 400);
    const slides = onsOf(events).filter((e) => (e.tick / STEP) % 2 === 1);
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.length).toBeLessThan(200);
    for (const on of slides) {
      expect(on.slide).toBe(true);
      // Legato: the sliding note-on goes out before the held note's off, a different pitch.
      const off = events[events.indexOf(on) + 1];
      expect(off).toMatchObject({ kind: 'noteOff', tick: on.tick });
      expect(off?.note).not.toBe(on.note);
    }
  });
});

describe('Octave on', () => {
  const OCTAVES = { ...FULL, octaveMode: true };

  it('every sounding note keeps its step’s pitch class', () => {
    const ons = onsOf(drive(make(LINE, { ...OCTAVES, restsSound: true, seed: 7 }), 2000));
    const classes = new Set([0, 3, 7, 10, 2].map((pc) => pc % 12));
    for (const on of ons) expect(classes.has(on.note % 12)).toBe(true);
    const plain = onsOf(drive(make(PLAIN, { ...OCTAVES, seed: 7 }), 800));
    const written = onsOf(drive(make(PLAIN), 800));
    plain.forEach((on, i) => expect(on.note % 12).toBe(written[i]!.note % 12));
  });

  it('shifts up and down equally often, for a C and for a B', () => {
    for (const [root, home] of [
      [0, 48],
      [11, 59],
    ] as const) {
      const sampler = new ScaleSampler({ root, scale: 'naturalMinor' });
      const seq = make([gridNote(0)], { ...OCTAVES, seed: 12 }, STEP_VARIATION_TABLE, sampler);
      const notes = onsOf(drive(seq, 20000)).map((e) => e.note);
      const up = notes.filter((n) => n > home).length;
      const down = notes.filter((n) => n < home).length;
      expect(up + down).toBeGreaterThan(8000);
      expect(Math.abs(up - down) / (up + down)).toBeLessThan(0.03);
    }
  });

  it('never leaves MIDI 0–127 at the register extremes, at the wider σ too', () => {
    const wide = { ...STEP_VARIATION_TABLE, octaveSigma: 2.25 };
    for (const octave of [-1, 9]) {
      const seq = make([gridNote(0), gridNote(2)], { ...OCTAVES, register: { octave } }, wide);
      const notes = onsOf(drive(seq, 4000)).map((e) => e.note);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...notes)).toBeLessThanOrEqual(MIDI_NOTE_MAX);
      expect(new Set(notes).size).toBeGreaterThan(2);
    }
  });
});
