/**
 * The Arp's step variation (windsor#935, record `2026-10-24-step-variation`):
 * parity at either amount 0, the stream per region, the groove kept with
 * Rests sound off and the beat-weighted flip with it on, a walk that never
 * moves, the list borrow, a one-note list, the retrigger strike, the gate's
 * look-ahead and ties, the varied gate, and Octave's pitch classes. Driven
 * tick by tick as the region gate would, over a C-minor triad at two
 * octaves (L = 6) unless it says otherwise.
 */
import { describe, expect, it } from 'vitest';

import { GATE_MIN } from '../audioConstants';
import { chordAt, type Harmony } from '../harmony/harmonyTimeline';
import { DEFAULT_ARP_CONFIG, type ArpSequencerConfig } from './arpSequencer';
import { arpNote, defaultArpSteps, type ArpStep } from './arpSteps';
import { Arpeggiator, arpNoteList } from './arpeggiator';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';
import { STEP_VARIATION_TABLE } from './stepVariationConstants';

const QUARTER = DIVISORS.quarter;
const MINOR = { root: 0, scale: 'naturalMinor' } as const;
const sampler = new ScaleSampler(MINOR);
const LONG = 4000 * QUARTER;
const TONIC: Harmony = { ...MINOR, events: [{ start: 0, duration: LONG, degree: 0, size: 3 }] };
const TIE: ArpStep = { kind: 'tie' };
const REST: ArpStep = { kind: 'rest' };
const FULL = { randomness: 1, probability: 1 };

const cells = (written: Record<number, ArpStep>): ArpStep[] => {
  const steps = defaultArpSteps();
  for (const [k, cell] of Object.entries(written)) steps[Number(k)] = cell;
  return steps;
};
const config = (over: Partial<ArpSequencerConfig> = {}): ArpSequencerConfig => ({
  ...DEFAULT_ARP_CONFIG,
  divisor: QUARTER,
  octaves: 2,
  gate: 0.5,
  ...over,
});

function drive(arp: Arpeggiator, steps: number, harmony = TONIC): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (let tick = 0; tick < steps * QUARTER; tick++) {
    events.push(
      ...arp.handleTick({
        tick,
        step: tick,
        bar: Math.floor(tick / TICKS_PER_BAR),
        tickInBar: tick % TICKS_PER_BAR,
        seconds: 0,
        secondsPerTick: 0,
        time: tick,
        chord: chordAt(harmony, LONG, tick),
        regionIndex: 0,
      }),
    );
  }
  return events;
}
const run = (over: Partial<ArpSequencerConfig>, steps = 48): NoteEvent[] =>
  drive(new Arpeggiator(sampler, config(over)), steps);
const onsOf = (events: readonly NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
const byStep = (events: readonly NoteEvent[], steps: number): (NoteOnEvent | null)[] => {
  const at = new Map(onsOf(events).map((e) => [e.tick / QUARTER, e]));
  return Array.from({ length: steps }, (_, s) => at.get(s) ?? null);
};
const LIST = arpNoteList(sampler, config(), chordAt(TONIC, LONG, 0)!);

/** Every kind of cell over the six-cell cycle: a gate, a tie, a rest, a slide and a ratchet. */
const WRITTEN = cells({
  0: arpNote({ accent: true, gate: 0.5 }),
  1: TIE,
  2: REST,
  3: arpNote({ slide: true }),
  4: arpNote({ ratchet: 3, octave: 1 }),
});

describe('parity and the stream', () => {
  it('at Randomness 0 or Probability 0 emits exactly what a plain arp does, event for event', () => {
    for (const style of ['up', 'random'] as const) {
      const plain = run({ style, steps: WRITTEN, seed: 3 });
      const switches = { style, steps: WRITTEN, seed: 3, restsSound: true, octaveMode: true };
      expect(run({ ...switches, randomness: 0, probability: 1 })).toEqual(plain);
      expect(run({ ...switches, randomness: 1, probability: 0 })).toEqual(plain);
    }
  });

  it('plays the same for the same seed and region, and replays on re-entry', () => {
    const over = { ...FULL, restsSound: true, steps: WRITTEN, seed: 9 };
    const first = run(over);
    expect(run(over)).toEqual(first);
    expect(run({ ...over, seed: 10 })).not.toEqual(first);
    const arp = new Arpeggiator(sampler, config(over));
    drive(arp, 48);
    arp.release(0, 0);
    arp.enter(0);
    expect(drive(arp, 48)).toEqual(first);
  });

  it('never moves the walk: an unvaried onset plays the plain walk’s pitch, a random style included', () => {
    for (const style of ['up', 'randomOther'] as const) {
      const plain = byStep(run({ style, seed: 5 }, 600), 600);
      const varied = byStep(run({ style, seed: 5, randomness: 1, probability: 0.3 }, 600), 600);
      const same = varied.filter((on, s) => on?.note === plain[s]?.note).length;
      expect(same, style).toBeGreaterThan(600 * 0.65);
      // A varied onset borrows a list note.
      for (const on of varied) expect(LIST).toContain(on!.note);
    }
  });
});

describe('the rhythm', () => {
  it('with Rests sound off, the sounding steps are the written ones at every amount, over 1,000 passes', () => {
    const written = cells({ 1: REST, 3: TIE, 4: REST });
    const expected = Array.from({ length: 6000 }, (_, s) => ![1, 3, 4].includes(s % 6));
    for (const randomness of [0.3, 1]) {
      for (const octaveMode of [false, true]) {
        const over = { randomness, probability: 1, octaveMode, steps: written, seed: 2 };
        const sounding = byStep(run(over, 6000), 6000).map((on) => on !== null);
        expect(sounding).toEqual(expected);
      }
    }
  });

  it('with Rests sound on, a beat flips about half as often as an off-beat step', () => {
    const struck = byStep(run({ ...FULL, restsSound: true, seed: 4 }, 12000), 12000);
    const rate = (onBeat: boolean): number => {
      const steps = struck.filter((_, s) => (s % 4 === 0) === onBeat);
      return steps.filter((on) => on === null).length / steps.length;
    };
    expect(rate(false)).toBeCloseTo(STEP_VARIATION_TABLE.flipOffbeat, 1);
    expect(rate(true) / rate(false)).toBeGreaterThan(0.4);
    expect(rate(true) / rate(false)).toBeLessThan(0.6);
  });

  it('editing one cell, or turning Rests sound on, leaves every other onset as it played', () => {
    const traits = (on: NoteOnEvent | null) => on && { note: on.note, velocity: on.velocity };
    const over = { ...FULL, octaveMode: true, seed: 6 };
    const a = byStep(run(over, 600), 600);
    const edited = byStep(run({ ...over, steps: cells({ 2: REST }) }, 600), 600);
    const flipping = byStep(run({ ...over, restsSound: true }, 600), 600);
    a.forEach((on, s) => {
      if (s % 6 !== 2) expect(traits(edited[s]!), `step ${s}`).toEqual(traits(on));
      if (flipping[s]) expect(traits(flipping[s]!), `step ${s}`).toEqual(traits(on));
    });
  });
});

describe('the boundaries', () => {
  it('a one-note list borrows only its one note, and Octave moves it by octaves inside MIDI', () => {
    // G minor at register 9: the triad clips to its root, G9 = 127.
    const g = { root: 7, scale: 'naturalMinor' } as const;
    const top: Harmony = { ...g, events: [{ start: 0, duration: LONG, degree: 0, size: 3 }] };
    const play = (over: Partial<ArpSequencerConfig>) => {
      const arp = new Arpeggiator(
        new ScaleSampler(g),
        config({ ...FULL, octaves: 1, register: { octave: 9 }, ...over }),
      );
      return onsOf(drive(arp, 400, top)).map((e) => e.note);
    };
    expect(new Set(play({}))).toEqual(new Set([127]));
    const octaves = play({ octaveMode: true });
    expect(octaves.every((n) => n % 12 === 7 && n <= 127)).toBe(true);
    expect(new Set(octaves).size).toBeGreaterThan(1);
  });

  it('a retrigger reset still strikes cell 0, a tie there and every amount on', () => {
    const change: Harmony = {
      ...MINOR,
      events: [
        { start: 0, duration: 2 * TICKS_PER_BAR, degree: 0, size: 3 },
        { start: 2 * TICKS_PER_BAR, duration: LONG, degree: 5, size: 4 },
      ],
    };
    for (let seed = 0; seed < 20; seed++) {
      const over = { ...FULL, retrigger: true, seed, steps: cells({ 0: TIE }) };
      const events = drive(new Arpeggiator(sampler, config(over)), 9, change);
      expect(byStep(events, 9)[8], `seed ${seed}`).not.toBeNull();
    }
  });

  it('keeps the gate’s look-ahead and ties: a note before a tie runs to the next onset', () => {
    const steps = cells({ 1: TIE });
    const events = run({ ...FULL, steps, seed: 1 }, 600);
    for (const on of onsOf(events)) {
      expect((on.tick / QUARTER) % 6).not.toBe(1);
      if ((on.tick / QUARTER) % 6 !== 0) continue;
      const off = events.find((e) => e.kind === 'noteOff' && e.tick > on.tick);
      expect(off!.tick).toBeGreaterThanOrEqual(on.tick + QUARTER);
    }
  });

  it('a varied gate stays inside [GATE_MIN, 1], and spreads about the written one', () => {
    const events = run({ ...FULL, gate: 0.5, steps: cells({ 0: arpNote({ ratchet: 2 }) }) }, 600);
    const gates = onsOf(events).flatMap((on) => (on.roll ? [on.roll.gate] : []));
    expect(Math.min(...gates)).toBeGreaterThanOrEqual(GATE_MIN);
    expect(Math.max(...gates)).toBeLessThanOrEqual(1);
    expect(gates.some((g) => g < 0.5) && gates.some((g) => g > 0.5)).toBe(true);
  });

  it('with Octave on, every sounding note keeps its walked pitch class', () => {
    const plain = byStep(run({ steps: WRITTEN, seed: 2 }, 600), 600);
    const varied = byStep(run({ ...FULL, octaveMode: true, steps: WRITTEN, seed: 2 }, 600), 600);
    varied.forEach((on, s) => on && expect(on.note % 12).toBe(plain[s]!.note % 12));
  });
});
