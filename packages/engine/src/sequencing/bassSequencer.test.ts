/**
 * The Bass / Drone's rules (#707): the three pitch modes, density, the tie
 * rule and the stream's restart on a region entry, driven step by step with
 * the chord the region gate would hand it. Fixture: C natural minor, `i` for
 * bar 1 and `VI` for bar 2, the part at octave 2.
 */
import { describe, expect, it } from 'vitest';

import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD } from '../audioConstants';
import { chordTones } from '../harmony/chordTheory';
import { chordAt, type Harmony } from '../harmony/harmonyTimeline';
import { BassSequencer, DEFAULT_BASS_CONFIG, type BassSequencerConfig } from './bassSequencer';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import type { PartTickEvent } from './regionGate';
import { ScaleSampler, SEMITONES_PER_OCTAVE } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const BAR = TICKS_PER_BAR;
const QUARTER = DIVISORS.quarter;
const OCTAVE = 2;
const SECONDS_PER_TICK = 0.01;

const harmonyOf = (...degrees: number[]): Harmony => ({
  root: 0,
  scale: 'naturalMinor',
  events: degrees.map((degree, bar) => ({
    start: bar * BAR,
    duration: BAR,
    degree,
    size: CHORD_SIZE_TRIAD,
  })),
});
/** i → VI, the ticket's fixture. */
const I_VI = harmonyOf(0, 5);
const sampler = new ScaleSampler(I_VI);
const C2 = sampler.noteFor(0, OCTAVE);
const A_FLAT_2 = sampler.noteFor(5, OCTAVE);
const G2 = sampler.noteFor(4, OCTAVE);
const E_FLAT_2 = sampler.noteFor(2, OCTAVE);

const bass = (over: Partial<BassSequencerConfig> = {}): BassSequencer =>
  new BassSequencer(sampler, {
    ...DEFAULT_BASS_CONFIG,
    divisor: QUARTER,
    register: { octave: OCTAVE },
    ...over,
  });

const songTicksOf = (harmony: Harmony): number =>
  harmony.events.reduce((end, e) => Math.max(end, e.start + e.duration), 0);

/** Steps `count` onsets from local tick `from`, handing each the chord the gate would. */
function drive(seq: BassSequencer, harmony: Harmony, count: number, from = 0): NoteEvent[] {
  const { divisor } = seq.config;
  const events: NoteEvent[] = [];
  for (let step = 0; step < count; step++) {
    const tick = from + step * divisor;
    const event: PartTickEvent = {
      tick,
      step: tick / divisor,
      bar: Math.floor(tick / BAR),
      tickInBar: tick % BAR,
      seconds: tick * SECONDS_PER_TICK,
      secondsPerTick: SECONDS_PER_TICK,
      time: tick * SECONDS_PER_TICK,
      chord: chordAt(harmony, songTicksOf(harmony), tick),
      regionIndex: 0,
    };
    events.push(...seq.handleTick(event));
  }
  return events;
}

const ons = (events: NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
const offs = (events: NoteEvent[]) => events.filter((e) => e.kind === 'noteOff');
const stepsPerBar = BAR / QUARTER;
/** Which of `count` steps sounded, as `x` / `.`. */
const pattern = (events: NoteEvent[], divisor: number, count: number): string => {
  const on = new Set(ons(events).map((e) => e.tick / divisor));
  return Array.from({ length: count }, (_, i) => (on.has(i) ? 'x' : '.')).join('');
};

describe('followRoot', () => {
  it('at 1/4 plays four C2 onsets in bar 1 and four A♭2 in bar 2', () => {
    const events = drive(bass({ gate: 0.5 }), I_VI, 2 * stepsPerBar);
    const notes = ons(events).map((e) => [e.tick, e.note]);
    expect(notes).toEqual([
      ...Array.from({ length: stepsPerBar }, (_, i) => [i * QUARTER, C2]),
      ...Array.from({ length: stepsPerBar }, (_, i) => [BAR + i * QUARTER, A_FLAT_2]),
    ]);
  });

  it('at gate 1 the held C2 sounds across the boundary until the bar-2 onset retunes it', () => {
    const seq = bass({ gate: 1 });
    const events = drive(seq, I_VI, 2 * stepsPerBar);
    expect(events).toEqual([
      { kind: 'noteOn', tick: 0, time: 0, note: C2, degree: 0 },
      { kind: 'noteOff', tick: BAR, time: BAR * SECONDS_PER_TICK, note: C2 },
      { kind: 'noteOn', tick: BAR, time: BAR * SECONDS_PER_TICK, note: A_FLAT_2, degree: 5 },
    ]);
    expect(seq.heldNote).toBe(A_FLAT_2);
  });
});

describe('followChord', () => {
  const triadOthers = (degree: number): number[] =>
    chordTones(sampler.offsets, degree, CHORD_SIZE_TRIAD)
      .slice(1)
      .map((tone) => sampler.rootNote(OCTAVE) + (tone % SEMITONES_PER_OCTAVE));
  const roots = new Set([C2, A_FLAT_2]);
  const steps = 64;

  it('rootBias 1 plays only roots over 64 steps', () => {
    const played = ons(
      drive(bass({ pitchMode: 'followChord', rootBias: 1, gate: 0.5 }), I_VI, steps),
    );
    expect(played).toHaveLength(steps);
    for (const e of played) expect(roots.has(e.note), String(e.note)).toBe(true);
  });

  it('rootBias 0 never plays the root, and draws each of the other tones', () => {
    const played = ons(
      drive(bass({ pitchMode: 'followChord', rootBias: 0, gate: 0.5 }), I_VI, steps),
    );
    expect(played).toHaveLength(steps);
    const bar1 = new Set(played.filter((e) => e.tick % (2 * BAR) < BAR).map((e) => e.note));
    const bar2 = new Set(played.filter((e) => e.tick % (2 * BAR) >= BAR).map((e) => e.note));
    expect([...bar1].sort()).toEqual(triadOthers(0).sort());
    expect([...bar2].sort()).toEqual(triadOthers(5).sort());
  });

  it('rootBias 0.8 at seed 7 plays, over four bars, the pinned sequence', () => {
    const seq = bass({ pitchMode: 'followChord', rootBias: 0.8, gate: 0.5, seed: 7 });
    const played = ons(drive(seq, I_VI, 4 * stepsPerBar)).map((e) => e.note);
    expect(played).toEqual(PINNED_ROOT_BIAS);
  });

  it('rootBias 0.8 lands on the root between 75 % and 85 % of 1 000 steps', () => {
    const count = 1000;
    const seq = bass({ pitchMode: 'followChord', rootBias: 0.8, gate: 0.5, seed: 3 });
    const played = ons(drive(seq, harmonyOf(0), count));
    const share = played.filter((e) => e.note === C2).length / count;
    expect(share).toBeGreaterThanOrEqual(0.75);
    expect(share).toBeLessThanOrEqual(0.85);
  });

  it('a seventh chord draws from its three non-root tones', () => {
    const seventh: Harmony = {
      ...I_VI,
      events: [{ start: 0, duration: BAR, degree: 0, size: CHORD_SIZE_SEVENTH }],
    };
    const expected = chordTones(sampler.offsets, 0, CHORD_SIZE_SEVENTH)
      .slice(1)
      .map((tone) => sampler.rootNote(OCTAVE) + (tone % SEMITONES_PER_OCTAVE));
    const played = ons(
      drive(bass({ pitchMode: 'followChord', rootBias: 0, gate: 0.5 }), seventh, steps),
    );
    expect(new Set(played.map((e) => e.note))).toEqual(new Set(expected));
    expect(expected).toHaveLength(CHORD_SIZE_SEVENTH - 1);
  });
});

describe('fixed', () => {
  it('fixedDegree 4 over i → VI → III → VII plays G2 at every onset', () => {
    const progression = harmonyOf(0, 5, 2, 6);
    const played = ons(
      drive(bass({ pitchMode: 'fixed', fixedDegree: 4, gate: 0.5 }), progression, 4 * stepsPerBar),
    );
    expect(played).toHaveLength(4 * stepsPerBar);
    for (const e of played) expect(e.note).toBe(G2);
  });
});

describe('density', () => {
  const count = 32;

  it('density 1 sounds every step', () => {
    expect(ons(drive(bass({ gate: 0.5, density: 1 }), I_VI, count))).toHaveLength(count);
  });

  it('density 0 emits no note-on and no note-off', () => {
    expect(drive(bass({ gate: 0.5, density: 0 }), I_VI, count)).toEqual([]);
    expect(drive(bass({ gate: 1, density: 0 }), I_VI, count)).toEqual([]);
  });

  it('density 0.5 at seed 11 is the pinned pattern, the same from two fresh instances', () => {
    const run = (): string =>
      pattern(drive(bass({ gate: 0.5, density: 0.5, seed: 11 }), I_VI, count), QUARTER, count);
    expect(run()).toBe(PINNED_DENSITY);
    expect(run()).toBe(run());
  });

  it('a rest at gate 1 releases the held note on its own step', () => {
    const events = drive(bass({ gate: 1, density: 0.5, seed: 11 }), harmonyOf(0), count);
    const shape = pattern(events, QUARTER, count);
    const firstRest = shape.indexOf('.', shape.indexOf('x'));
    expect(offs(events).some((e) => e.tick === firstRest * QUARTER)).toBe(true);
  });
});

describe('the tie rule', () => {
  it('gate 1 over two bars of i is one note-on at tick 0 and no note-off until the release', () => {
    const seq = bass({ gate: 1 });
    const events = drive(seq, harmonyOf(0, 0), 2 * stepsPerBar);
    expect(events).toEqual([{ kind: 'noteOn', tick: 0, time: 0, note: C2, degree: 0 }]);
    expect(seq.release(2 * BAR, 0)).toEqual([
      { kind: 'noteOff', tick: 2 * BAR, time: 0, note: C2 },
    ]);
    expect(seq.release(2 * BAR, 0)).toEqual([]);
  });

  it('gate 0.7 at divisor 24 puts a note-off round(0.7 × 24) ticks after each on', () => {
    const gate = 0.7;
    const divisor = 24;
    const events = drive(bass({ gate, divisor }), I_VI, 2 * stepsPerBar);
    const on = ons(events);
    expect(on).toHaveLength(2 * stepsPerBar);
    expect(offs(events).map((e) => e.tick)).toEqual(
      on.map((e) => e.tick + Math.round(gate * divisor)),
    );
  });
});

describe('the stream', () => {
  const count = 16;
  const config = { gate: 0.5, density: 0.5, seed: 5 } as const;

  it('restarts on a region re-entry', () => {
    const seq = bass(config);
    seq.enter(0);
    const first = pattern(drive(seq, I_VI, count), QUARTER, count);
    seq.enter(0);
    expect(pattern(drive(seq, I_VI, count), QUARTER, count)).toBe(first);
    seq.enter(1);
    expect(pattern(drive(seq, I_VI, count), QUARTER, count)).not.toBe(first);
  });

  it('is not restarted by a chord change mid-region', () => {
    const changing = pattern(drive(bass(config), I_VI, count), QUARTER, count);
    const still = pattern(drive(bass(config), harmonyOf(0, 0), count), QUARTER, count);
    expect(changing).toBe(still);
  });

  it('keeps running through a live reconfigure', () => {
    const whole = pattern(drive(bass(config), I_VI, count), QUARTER, count);
    const seq = bass(config);
    const half = count / 2;
    const head = drive(seq, I_VI, half);
    seq.reconfigure({ ...seq.config, pitchMode: 'fixed', gate: 0.25 });
    const tail = drive(seq, I_VI, half, half * QUARTER);
    expect(pattern([...head, ...tail], QUARTER, count)).toBe(whole);
  });
});

it('shows no playhead: the card has no strip', () => {
  expect(bass().stepAt(3)).toBe(-1);
});

/** Seed 7's first four bars: one E♭ among the roots. A stream pin, not a tunable. */
const PINNED_ROOT_BIAS = [
  ...[C2, C2, C2, C2, A_FLAT_2, A_FLAT_2, A_FLAT_2, A_FLAT_2],
  ...[C2, E_FLAT_2, C2, C2, A_FLAT_2, A_FLAT_2, A_FLAT_2, A_FLAT_2],
];
/** Seed 11 at density 0.5, 32 steps. A stream pin, not a tunable. */
const PINNED_DENSITY = '......x..xx.x..xxxxx.x..x...x.xx';
