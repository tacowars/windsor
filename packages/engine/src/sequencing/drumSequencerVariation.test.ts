/**
 * Step variation on the Drum (windsor#948, record
 * `2026-10-24-drum-sequencer` decision 5): Vary and Chance as on the Arp,
 * over a hit's own velocity, pitch offset and the part's gate, with the same
 * eight draws a step, rest included. The maths is `stepVariation.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_DRUM_CONFIG, DrumSequencer, type DrumSequencerConfig } from './drumSequencer';
import { DRUM_REST, drumHit, type DrumStep } from './drumSteps';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import type { SeqOverrides } from './regionGate';
import { DIVISORS, TICKS_PER_BAR } from './scheduler';

const SIXTEENTH = DIVISORS.sixteenth;
const BAR = TICKS_PER_BAR;
const VARIED = { randomness: 1, probability: 1 } as const;

/** The snare line of the listen: backbeats accented, ghosts between. */
const SNARE: DrumStep[] = Array.from({ length: 16 }, (_, i) => {
  if (i === 4 || i === 12) return drumHit({ accent: true });
  const ghosts: Record<number, number> = { 3: 0.3, 7: 0.25, 10: 0.3, 14: 0.35 };
  return ghosts[i] === undefined ? DRUM_REST : drumHit({ velocity: ghosts[i] });
});
/** Every step a hit, its pitch offset the step's index, so a borrow shows. */
const PITCHED: DrumStep[] = Array.from({ length: 16 }, (_, i) => drumHit({ pitch: i }));

const drum = (over: Partial<DrumSequencerConfig> = {}): DrumSequencer =>
  new DrumSequencer({ ...DEFAULT_DRUM_CONFIG, steps: SNARE, seed: 7, ...over });

function run(sequencer: DrumSequencer, ticks: number, from = 0, overrides?: SeqOverrides) {
  const events: NoteEvent[] = [];
  for (let tick = from; tick < from + ticks; tick++) {
    const at = { tick, step: tick, bar: Math.floor(tick / BAR), tickInBar: tick % BAR };
    const clock = { seconds: tick, secondsPerTick: 1, time: tick };
    events.push(...sequencer.handleTick({ ...at, ...clock, overrides }));
  }
  return events;
}
const ons = (events: readonly NoteEvent[]): NoteOnEvent[] =>
  events.filter((e): e is NoteOnEvent => e.kind === 'noteOn');
const stepOf = (e: NoteEvent): number => (e.tick / SIXTEENTH) % 16;

describe('at Vary 0 or Chance 0', () => {
  it('plays the written line event for event', () => {
    const written = run(drum(), 4 * BAR);
    expect(run(drum({ randomness: 0, probability: 1, restsSound: true }), 4 * BAR)).toEqual(
      written,
    );
    expect(run(drum({ randomness: 1, probability: 0, restsSound: true }), 4 * BAR)).toEqual(
      written,
    );
  });

  it('draws nothing: turning both up after a bar plays the stream from its start', () => {
    const late = drum();
    run(late, BAR);
    late.reconfigure({ ...late.config, ...VARIED });
    const fresh = drum(VARIED);
    const shifted = run(fresh, BAR).map((e) => ({ ...e, tick: e.tick + BAR, time: e.time + BAR }));
    expect(run(late, BAR, BAR)).toEqual(shifted);
  });
});

describe('the stream', () => {
  it('replays the same variation for the same seed and region, and another for another region', () => {
    const play = (region: number): NoteEvent[] => {
      const sequencer = drum({ ...VARIED, steps: PITCHED });
      sequencer.enter(region);
      return run(sequencer, 4 * BAR);
    };
    expect(play(3)).toEqual(play(3));
    expect(play(3)).not.toEqual(play(4));
  });

  it('editing one step leaves every other step’s draws where they were', () => {
    const steps = [...PITCHED];
    steps[5] = DRUM_REST;
    const before = ons(run(drum({ ...VARIED, steps: PITCHED, octaveMode: true }), 4 * BAR));
    const after = ons(run(drum({ ...VARIED, steps, octaveMode: true }), 4 * BAR));
    const others = (events: NoteOnEvent[]) => events.filter((e) => stepOf(e) !== 5);
    expect(others(after)).toEqual(others(before));
  });

  it('a switch or a knob moves no draw: Octave keeps every velocity, half the Vary halves each offset', () => {
    const base = ons(run(drum({ ...VARIED, steps: PITCHED }), 4 * BAR));
    const octave = ons(run(drum({ ...VARIED, steps: PITCHED, octaveMode: true }), 4 * BAR));
    expect(octave.map((e) => e.velocityOffset)).toEqual(base.map((e) => e.velocityOffset));
    const half = ons(run(drum({ ...VARIED, steps: PITCHED, randomness: 0.5 }), 4 * BAR));
    half.forEach((e, i) => {
      expect(e.velocityOffset).toBeCloseTo((base[i]?.velocityOffset ?? 0) / 2, 12);
    });
  });
});

describe('what a varied hit plays', () => {
  it('a velocity offset about its own velocity, and a gate moved about the part’s', () => {
    const events = run(drum(VARIED), 4 * BAR);
    const hits = ons(events);
    expect(hits.some((e) => e.velocityOffset !== undefined && e.velocityOffset > 0)).toBe(true);
    expect(hits.some((e) => e.velocityOffset !== undefined && e.velocityOffset < 0)).toBe(true);
    // The ghost keeps its own velocity; the offset rides beside it.
    expect(hits.filter((e) => stepOf(e) === 3).every((e) => e.velocity === 0.3)).toBe(true);
    const held = events
      .filter((e) => e.kind === 'noteOff')
      .map((e) => e.tick % SIXTEENTH || SIXTEENTH);
    expect(new Set(held).size).toBeGreaterThan(1);
  });

  it('with Octave off borrows the pitch offset of another hit', () => {
    const notes = ons(run(drum({ ...VARIED, steps: PITCHED }), 4 * BAR));
    const borrowed = notes.filter((e) => e.note !== 60 + stepOf(e));
    expect(borrowed.length).toBeGreaterThan(0);
    expect(notes.every((e) => e.note >= 60 && e.note < 76)).toBe(true);
  });

  it('with Octave on keeps every played note’s pitch class', () => {
    const notes = ons(run(drum({ ...VARIED, steps: PITCHED, octaveMode: true }), 8 * BAR));
    expect(notes.some((e) => e.note !== 60 + stepOf(e))).toBe(true);
    expect(notes.every((e) => (e.note - 60 - stepOf(e)) % 12 === 0)).toBe(true);
  });
});

describe('Rests sound', () => {
  it('off: the sounding steps are the written ones over 1,000 passes', () => {
    const sounding = new Set(ons(run(drum(VARIED), 1000 * BAR)).map(stepOf));
    expect([...sounding].sort((a, b) => a - b)).toEqual([3, 4, 7, 10, 12, 14]);
  });

  it('on: a rest that sounds plays the nearest hit’s velocity and pitch, no accent and no ratchet', () => {
    const steps: DrumStep[] = Array.from({ length: 16 }, () => DRUM_REST);
    steps[0] = drumHit({ velocity: 0.4, pitch: 5, accent: true, ratchet: 3 });
    const events = ons(run(drum({ ...VARIED, restsSound: true, steps }), 16 * BAR));
    const flipped = events.filter((e) => stepOf(e) !== 0);
    expect(flipped.length).toBeGreaterThan(10);
    for (const e of flipped) {
      expect(e).toMatchObject({ velocity: 0.4, note: 65 });
      expect(e.accent).toBeUndefined();
      expect(e.roll).toBeUndefined();
    }
    // And a hit may go silent, its roll with it.
    expect(events.filter((e) => stepOf(e) === 0).length).toBeLessThan(16);
  });
});

describe('Per effect', () => {
  it('at Chance 1 plays what one roll does', () => {
    const one = run(drum({ ...VARIED, steps: PITCHED }), 4 * BAR);
    expect(run(drum({ ...VARIED, steps: PITCHED, chancePerEffect: true }), 4 * BAR)).toEqual(one);
  });

  it('below it, rolls each effect apart: a hit may vary its velocity and keep its pitch', () => {
    const over = { randomness: 1, probability: 0.4, chancePerEffect: true, steps: PITCHED };
    const notes = ons(run(drum(over), 8 * BAR));
    const velocityOnly = notes.filter(
      (e) => e.velocityOffset !== undefined && e.note === 60 + stepOf(e),
    );
    const pitchOnly = notes.filter(
      (e) => e.velocityOffset === undefined && e.note !== 60 + stepOf(e),
    );
    expect(velocityOnly.length).toBeGreaterThan(0);
    expect(pitchOnly.length).toBeGreaterThan(0);
  });
});

describe('the lanes', () => {
  it('`seq.randomness` and `seq.probability` move the values read on the step', () => {
    const laned = run(drum({ steps: PITCHED }), 4 * BAR, 0, VARIED);
    expect(laned).toEqual(run(drum({ ...VARIED, steps: PITCHED }), 4 * BAR));
  });
});
