/**
 * `ArrangementPlayer.stepAt` (#619 decision 2): the one position rule the
 * console's playheads read, so the three sequencer cards show the step the
 * engine is actually sounding instead of each re-deriving one.
 *
 * Every case asserts against the engine's own answer rather than against a
 * formula written out a second time: the grid case reads the *note the player
 * sounded* back to the step that wrote it, the Euclidean case compares against
 * the `step` a sequencer on the same transport emits, the chord case compares
 * tick by tick against `ChordSequencer.stepAt`, and the boundary case states
 * its expectations as expressions of the progression's own step durations — so
 * a retuned duration moves the expectation with it.
 *
 * These cases are their own file rather than part of `arrangementPlayer.test.ts`:
 * that file is already over `max-lines` on its binding cases, the way the chord
 * and Euclidean player cases are their own files too.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, FULL_SLOT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Arrangement, EuclideanDriver, MusicPart } from './arrangement';
import { driverOf } from './arrangement';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import {
  ChordSequencer,
  chordStep,
  restStep,
  type ChordSequencerConfig,
} from '../sequencing/chordSequencer';
import { EuclideanSequencer } from '../sequencing/euclideanSequencer';
import { gridNote } from '../sequencing/gridSequencer';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const { kick, arp, drone } = FULL_SLOT;
const BARS = 4;
const secondsPerTick = SECONDS_PER_MINUTE / FULL_ARRANGEMENT.bpm / PPQ;
/** The transport tick a recorded call time belongs to (the Euclidean player tests' rule). */
const tickOf = (time: number | undefined): number => Math.round((time ?? 0) / secondsPerTick);

/** A run of eight degrees a semitone apart, so a sounded note names the step that wrote it. */
const LADDER_ROOT = 48;
const LADDER_DEGREES = [0, 1, 2, 3, 4, 5, 6, 7];

/** The fixture's drone slot as a grid part: eight eighths, one distinct degree each. */
const LADDER: Arrangement = {
  ...FULL_ARRANGEMENT,
  key: { root: LADDER_ROOT, scale: LADDER_DEGREES },
  parts: FULL_ARRANGEMENT.parts.map((part): MusicPart =>
    part.slot === drone
      ? {
          ...part,
          sequencer: {
            kind: 'grid',
            divisor: DIVISORS.eighth,
            steps: LADDER_DEGREES.map((degree) => gridNote(degree)),
            length: LADDER_DEGREES.length,
            skipChance: 0,
            accentVelocity: 0.2,
            accentMod: 1,
            register: { octave: 0 },
          },
        }
      : part,
  ),
};

/** A progression whose three steps are of three different lengths, the last one twice. */
const CHORD_DRIVER = {
  divisor: DIVISORS.bar,
  gate: 1,
  voicing: 'close',
  register: { octave: 0 },
  steps: [
    chordStep(0, { duration: 1 }),
    restStep({ duration: 2 }),
    chordStep(4, { duration: 0.5, repeat: 2 }),
  ],
} as const;

const PROGRESSION: Arrangement = {
  ...FULL_ARRANGEMENT,
  key: { root: 48, scale: 'naturalMinor' },
  parts: FULL_ARRANGEMENT.parts.map((part): MusicPart =>
    part.slot === drone ? { ...part, sequencer: { kind: 'chord', ...CHORD_DRIVER } } : part,
  ),
};

/** The same progression as a standalone sequencer: the engine's own layout of it. */
const chordEngine = (): ChordSequencer =>
  new ChordSequencer(new ScaleSampler(PROGRESSION.key), {
    ...(CHORD_DRIVER as unknown as ChordSequencerConfig),
    seed: FULL_ARRANGEMENT.seed,
    generatorIndex: drone,
  });

describe('ArrangementPlayer.stepAt (#619)', () => {
  it('names the grid step that sounded: every note the player sent is on stepAt’s column', () => {
    const { parts, player, run } = rig(LADDER);
    run(BARS);
    const notes = parts.drone.calls.filter((call) => call.kind === 'noteOn');
    expect(notes.length).toBe(BARS * LADDER_DEGREES.length);
    for (const call of notes) {
      const tick = tickOf(call.time);
      // The scale is one semitone per degree, so the note *is* the step it came from.
      expect(player.stepAt(drone, tick), `tick ${tick}`).toBe((call.note ?? 0) - LADDER_ROOT);
    }
  });

  it('matches the step a Euclidean sequencer on the same transport emits, over four bars', () => {
    const { player, transport, run } = rig();
    const config = {
      ...(driverOf(FULL_PARTS.kick.sequencer) as EuclideanDriver),
      seed: FULL_ARRANGEMENT.seed,
      generatorIndex: kick,
    };
    const sequencer = new EuclideanSequencer(config);
    const emitted: { tick: number; step: number }[] = [];
    transport.subscribe(config.divisor, (event) => {
      const onset = sequencer.handleTick(event);
      if (onset) emitted.push({ tick: onset.tick, step: onset.step });
    });
    run(BARS);
    expect(emitted.length).toBeGreaterThan(0);
    for (const { tick, step } of emitted) {
      expect(player.stepAt(kick, tick), `tick ${tick}`).toBe(step);
    }
  });

  it('follows a chord progression’s own segments, tick by tick over four bars', () => {
    const { player, run } = rig(PROGRESSION);
    run(BARS);
    const sequencer = chordEngine();
    for (let tick = 0; tick < BARS * TICKS_PER_BAR; tick++) {
      expect(player.stepAt(drone, tick), `tick ${tick}`).toBe(sequencer.stepAt(tick)?.step ?? -1);
    }
  });

  it('places the progression’s boundaries at its own step durations, and wraps on its total', () => {
    const { player } = rig(PROGRESSION);
    const base = CHORD_DRIVER.divisor;
    const ticksOf = (step: (typeof CHORD_DRIVER.steps)[number]): number =>
      step.duration * step.repeat * base;
    const [first, rest, last] = CHORD_DRIVER.steps;
    const second = ticksOf(first);
    const third = second + ticksOf(rest);
    const length = third + ticksOf(last);
    expect(player.stepAt(drone, 0)).toBe(0);
    expect(player.stepAt(drone, second - 1)).toBe(0);
    expect(player.stepAt(drone, second)).toBe(1);
    expect(player.stepAt(drone, third - 1)).toBe(1);
    expect(player.stepAt(drone, third)).toBe(2);
    // The progression wraps on its own total length, which is not a whole bar.
    expect(player.stepAt(drone, length)).toBe(0);
    expect(player.stepAt(drone, length * BARS + third)).toBe(2);
  });

  it('has no step for a none part, or for an absent slot', () => {
    const { player } = rig(withPart(FULL_ARRANGEMENT, 'arp', { sequencer: { kind: 'none' } }));
    expect(player.stepAt(arp, TICKS_PER_BAR)).toBe(-1);
    expect(player.stepAt(FULL_ARRANGEMENT.parts.length, 0)).toBe(-1);
  });
});
