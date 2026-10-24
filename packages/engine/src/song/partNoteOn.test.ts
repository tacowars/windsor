/**
 * A pitched note-on as its part plays it (#602, windsor#17): the accent's
 * velocity bump and mod, the slide, a step's offsets, and no extras at all
 * for a plain note; a varied step's velocity offset (windsor#945), held in
 * `[velocityFloor, 1]` only when there is one.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_GRID_CONFIG, GridSequencer, gridNote } from '../sequencing/gridSequencer';
import type { NoteOnEvent } from '../sequencing/noteEvent';
import type { EuclidHitRead } from '../sequencing/euclidLanes';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { STEP_VARIATION_TABLE } from '../sequencing/stepVariationConstants';
import { euclidNoteOn, partNoteOn } from './partNoteOn';

const on = (over: Partial<NoteOnEvent> = {}): NoteOnEvent => ({
  kind: 'noteOn',
  tick: 0,
  time: 0,
  note: 60,
  degree: 0,
  ...over,
});

describe('partNoteOn', () => {
  it('a plain note plays at the part’s velocity with no extras', () => {
    expect(partNoteOn(on(), 0.7)).toEqual({ velocity: 0.7, extras: undefined });
  });

  it('an accent bumps the velocity, capped at 1, and sends its mod', () => {
    const played = partNoteOn(on({ accent: { velocity: 0.5, mod: 0.8 } }), 0.7);
    expect(played).toStrictEqual({ velocity: 1, extras: { mod: 0.8, slide: false } });
  });

  it('a slide is flagged with no mod', () => {
    expect(partNoteOn(on({ slide: true }), 0.7).extras).toStrictEqual({ mod: 0, slide: true });
  });

  it('a step’s offsets ride along, alone or with the accent', () => {
    const stepMod = [0, 0.5];
    expect(partNoteOn(on({ stepMod }), 0.7).extras).toStrictEqual({
      mod: 0,
      slide: false,
      stepMod,
    });
    const both = partNoteOn(on({ stepMod, accent: { velocity: 0.1, mod: 1 } }), 0.7);
    expect(both.extras).toStrictEqual({ mod: 1, slide: false, stepMod });
  });
});

describe('a varied step’s velocity offset (windsor#945)', () => {
  const FLOOR = STEP_VARIATION_TABLE.velocityFloor;

  it('adds the offset to the part’s velocity, up or down, inside [velocityFloor, 1]', () => {
    expect(partNoteOn(on({ velocityOffset: 0.2 }), 0.5).velocity).toBeCloseTo(0.7, 12);
    expect(partNoteOn(on({ velocityOffset: -0.2 }), 0.5).velocity).toBeCloseTo(0.3, 12);
    expect(partNoteOn(on({ velocityOffset: -0.6 }), 0.5).velocity).toBe(FLOOR);
    expect(partNoteOn(on({ velocityOffset: 0.6 }), 0.5).velocity).toBe(1);
  });

  it('at part velocity 1 an upward offset plays 1, and an accented varied note stays at most 1', () => {
    expect(partNoteOn(on({ velocityOffset: 0.3 }), 1).velocity).toBe(1);
    const accent = { velocity: 0.3, mod: 1 };
    expect(partNoteOn(on({ velocityOffset: 0.3, accent }), 0.9).velocity).toBe(1);
    expect(partNoteOn(on({ velocityOffset: -0.2, accent }), 0.6).velocity).toBeCloseTo(0.7, 12);
  });

  it('brings no floor without an offset: a Figure cell at velocity 0 stays silent', () => {
    expect(partNoteOn(on({ velocity: 0 }), 0.8).velocity).toBe(0);
    expect(partNoteOn(on({ velocity: 0.01 }), 0.8).velocity).toBeCloseTo(0.008, 12);
    expect(partNoteOn(on(), 0).velocity).toBe(0);
  });

  it('a Grid at velocity 0.5, Vary 1, Chance 1 plays a mean of 0.5, as often up as down', () => {
    const steps = 20000;
    const seq = new GridSequencer(new ScaleSampler({ root: 0, scale: 'naturalMinor' }), {
      ...DEFAULT_GRID_CONFIG,
      steps: [gridNote(0)],
      length: 1,
      randomness: 1,
      probability: 1,
      seed: 945,
    });
    const played: number[] = [];
    for (let step = 0; step < steps; step++) {
      const tick = {
        tick: step,
        step,
        bar: 0,
        tickInBar: 0,
        seconds: 0,
        secondsPerTick: 0,
        time: 0,
      };
      for (const e of seq.handleTick(tick)) {
        if (e.kind === 'noteOn') played.push(partNoteOn(e, 0.5).velocity);
      }
    }
    expect(played).toHaveLength(steps);
    const mean = played.reduce((sum, v) => sum + v, 0) / steps;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
    const up = played.filter((v) => v > 0.5).length;
    const down = played.filter((v) => v < 0.5).length;
    expect(Math.abs(up - down) / (up + down)).toBeLessThan(0.03);
    expect(Math.min(...played)).toBeGreaterThanOrEqual(FLOOR);
    expect(Math.max(...played)).toBeLessThanOrEqual(1);
  });
});

describe('euclidNoteOn (windsor#355)', () => {
  const read = (over: Partial<EuclidHitRead> = {}): EuclidHitRead => ({
    ratchet: 1,
    accent: undefined,
    semitones: 0,
    stepMod: undefined,
    ...over,
  });

  it('a plain hit plays the part’s note and velocity with no extras', () => {
    expect(euclidNoteOn(read(), 36, 0.8)).toEqual({ note: 36, velocity: 0.8, extras: undefined });
  });

  it('adds the pitch lane and clamps to MIDI 0..127', () => {
    expect(euclidNoteOn(read({ semitones: 24 }), 120, 1).note).toBe(127);
    expect(euclidNoteOn(read({ semitones: -24 }), 5, 1).note).toBe(0);
    expect(euclidNoteOn(read({ semitones: -7 }), 60, 1).note).toBe(53);
  });

  it('an accent bumps the velocity, capped at 1, and sends its mod with the offsets', () => {
    const stepMod = [0, 0.5];
    const played = euclidNoteOn(read({ accent: { velocity: 0.3, mod: 0.6 }, stepMod }), 40, 0.9);
    expect(played).toStrictEqual({
      note: 40,
      velocity: 1,
      extras: { mod: 0.6, slide: false, stepMod },
    });
  });
});
