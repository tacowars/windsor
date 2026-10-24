/**
 * The Drum's strip edits (windsor#951; record `2026-10-24-drum-device`):
 * the cells' writes, Length, Rotate, Reverse, Randomize's rule (decision 4)
 * and the pattern the picker shows and writes over the engine's bank.
 */
import type { DrumStep, StepModLane } from '@windsor/engine';
import { DRUM_PATTERNS, drumHit } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  cycleHitRatchet,
  drumLengthChange,
  drumPatternChange,
  isGhost,
  randomDrumSteps,
  reverseDrum,
  setHitVelocity,
  shownPattern,
  toggleHit,
  toggleHitAccent,
  turnDrum,
} from './drumGridModel';

const REST: DrumStep = { kind: 'rest' };
const lane = (values: number[]): StepModLane => ({ param: 'ops.0.env.decayTime', values });

/** Four steps: a hit, a rest, a ghost, a rest. */
const LINE = {
  length: 4,
  steps: [drumHit(), REST, drumHit({ velocity: 0.3 }), REST],
  lanes: [lane([0.1, 0.2, 0.3, 0.4])],
};

describe('a step’s cells', () => {
  it('toggles a hit to a rest and a rest to a plain hit at 1', () => {
    expect(toggleHit(drumHit({ velocity: 0.4, accent: true }))).toEqual(REST);
    expect(toggleHit(REST)).toEqual({ kind: 'hit', accent: false });
  });

  it('writes a velocity on the Vel bar’s 0.05 grid, none at 1', () => {
    expect(setHitVelocity(drumHit(), 0.32)).toEqual({ kind: 'hit', accent: false, velocity: 0.3 });
    expect(setHitVelocity(drumHit({ velocity: 0.3 }), 1)).toEqual({ kind: 'hit', accent: false });
    expect(setHitVelocity(REST, 0.5)).toEqual(REST);
  });

  it('dims a hit under 0.5 as a ghost', () => {
    expect(isGhost(drumHit({ velocity: 0.45 }))).toBe(true);
    expect(isGhost(drumHit({ velocity: 0.5 }))).toBe(false);
    expect(isGhost(REST)).toBe(false);
  });

  it('toggles the accent and cycles the ratchet ×1 → ×4 → ×1, a rest untouched', () => {
    expect(toggleHitAccent(drumHit())).toEqual({ kind: 'hit', accent: true });
    let step: DrumStep = drumHit();
    const rolls: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      step = cycleHitRatchet(step);
      rolls.push(step.kind === 'hit' ? step.ratchet : -1);
    }
    expect(rolls).toEqual([2, 3, 4, undefined]);
    expect(cycleHitRatchet(REST)).toEqual(REST);
  });
});

describe('the line', () => {
  it('Length grows the list with rests and pads the lanes, never shortening either', () => {
    const longer = drumLengthChange(LINE, 6);
    expect(longer?.length).toBe(6);
    expect(longer?.steps.slice(4)).toEqual([REST, REST]);
    expect(longer?.lanes[0]?.values).toEqual([0.1, 0.2, 0.3, 0.4, 0, 0]);
    const shorter = drumLengthChange(LINE, 2);
    expect(shorter?.length).toBe(2);
    expect(shorter?.steps).toHaveLength(4);
    expect(drumLengthChange(LINE, 4)).toBeNull();
    expect(drumLengthChange(LINE, 99)?.length).toBe(32);
  });

  it('Rotate turns the loop and its lane values by the move, the steps past it kept', () => {
    const line = { ...LINE, length: 3 };
    const turn = turnDrum(line, 0, 1);
    expect(turn.turned).toBe(1);
    expect(turn.change?.steps).toEqual([LINE.steps[2], LINE.steps[0], LINE.steps[1], REST]);
    expect(turn.change?.lanes[0]?.values).toEqual([0.3, 0.1, 0.2, 0.4]);
    expect(turnDrum(line, 1, 1).change).toBeNull();
  });

  it('Reverse mirrors the loop and its lane values', () => {
    const { steps, lanes } = reverseDrum(LINE);
    expect(steps).toEqual([REST, LINE.steps[2], REST, LINE.steps[0]]);
    expect(lanes[0]?.values).toEqual([0.4, 0.3, 0.2, 0.1]);
  });
});

describe('Randomize (decision 4)', () => {
  /** A draw that returns `values` in turn. */
  const script = (values: number[]): (() => number) => {
    let i = 0;
    return () => values[i++ % values.length]!;
  };

  it('keeps the hit count, places them anew and draws each a velocity from 0.3 to 1', () => {
    // Places: index 3 of [0..3], then index 1+0 of the rest; velocities: the lowest, the highest.
    const out = randomDrumSteps(LINE.steps, 4, script([0.99, 0, 0, 0.999]));
    expect(out.filter((s) => s.kind === 'hit')).toHaveLength(2);
    expect(out[3]).toEqual({ kind: 'hit', accent: false, velocity: 0.3 });
    expect(out[1]).toEqual({ kind: 'hit', accent: false });
    expect(out[0]).toEqual(REST);
  });

  it('draws one hit on an empty loop, and keeps the steps past the loop', () => {
    const steps = [REST, REST, drumHit({ accent: true })];
    const out = randomDrumSteps(steps, 2, script([0.5, 0.5]));
    expect(out.slice(0, 2).filter((s) => s.kind === 'hit')).toHaveLength(1);
    expect(out[2]).toEqual(steps[2]);
  });

  it('only ever draws velocities on the 0.05 grid from 0.3 to 1', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const out = randomDrumSteps(LINE.steps, 4, script([0.5, k / 200]));
      for (const s of out) if (s.kind === 'hit') seen.add(s.velocity ?? 1);
    }
    expect(Math.min(...seen)).toBe(0.3);
    expect(Math.max(...seen)).toBe(1);
    expect(seen.size).toBe(15);
  });
});

describe('the Pattern picker over the bank', () => {
  const first = DRUM_PATTERNS[0]!;

  it('writes a pattern’s steps and length as one change, the lanes fitted', () => {
    const change = drumPatternChange(LINE, first.id);
    expect(change?.steps).toEqual(first.steps);
    expect(change?.length).toBe(first.steps.length);
    expect(change?.lanes[0]?.values).toEqual([
      0.1,
      0.2,
      0.3,
      0.4,
      ...Array.from({ length: first.steps.length - 4 }, () => 0),
    ]);
    expect(drumPatternChange(LINE, '')).toBeNull();
    expect(drumPatternChange(LINE, 'no-such-pattern')).toBeNull();
  });

  it('names the pattern a line still is, and Custom one edit later', () => {
    const picked = { steps: [...first.steps], length: first.steps.length };
    expect(shownPattern(picked)).toBe(first.id);
    const edited = { ...picked, steps: picked.steps.map((s, i) => (i === 1 ? toggleHit(s) : s)) };
    expect(shownPattern(edited)).toBe('');
    expect(shownPattern(LINE)).toBe('');
  });
});
