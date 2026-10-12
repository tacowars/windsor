/**
 * Bounce to Roll's loop search and velocities (windsor#741,
 * `docs/log/2026-10-11-bounce-to-roll.md` decisions 4 and 5): a loop must
 * play the envelopes as well as the notes, and a part at Vel 0 keeps its
 * notes' own velocities, or silences them when an accent raises its Vel.
 */
import { describe, expect, it } from 'vitest';

import { BOUNCE_SLOT, gridNote, gridSpec } from '../__fixtures__/bounceRig';
import { applyBounce, bounceDocument } from '../__fixtures__/bounceToRollRig';
import type { GridSpec, RollSpec } from './arrangement';
import { bounceToRoll } from './bounceToRoll';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const STEP = 1 / 64;

/** The part's first region's roll after the bounce, normalised with nothing to trim. */
function bouncedRoll(grid: GridSpec, velocity = 0.8) {
  const doc = bounceDocument(grid, { velocity });
  const result = bounceToRoll(doc, BOUNCE_SLOT);
  const { normalised } = applyBounce(doc, result);
  expect(normalised.corrections).toEqual([]);
  const part = normalised.document.parts[0]!;
  return { roll: part.regions[0]!.pattern as RollSpec, part, result };
}

describe('the loop search', () => {
  /** Two bars of one repeated note, the cutoff at 0.5 for the first and −0.5 for the second. */
  const twoBars = (second: number) =>
    gridSpec(
      Array.from({ length: 32 }, () => gridNote(0)),
      {
        lanes: [
          { param: 'filter.cutoff', values: [...Array(16).fill(0.5), ...Array(16).fill(second)] },
        ],
      },
    );

  it('loops one bar when the envelope repeats each bar, and two when it moves between them', () => {
    expect(bouncedRoll(twoBars(0.5)).roll).toMatchObject({
      loopTicks: TICKS_PER_BAR,
      envelopes: [{ target: 'filter.cutoff', points: [{ tick: 0, value: 0.5, bend: 0 }] }],
    });
    const { roll } = bouncedRoll(twoBars(-0.5));
    expect(roll.loopTicks).toBe(2 * TICKS_PER_BAR);
    expect(roll.notes).toHaveLength(32);
    // The hold up to the change on the loop's end is never reached, and is not written.
    expect(roll.envelopes?.[0]?.points).toEqual([
      { tick: 0, value: 0.5, bend: 0 },
      { tick: TICKS_PER_BAR - STEP, value: 0.5, bend: 0 },
      { tick: TICKS_PER_BAR, value: -0.5, bend: 0 },
    ]);
  });
});

describe('a part at Vel 0', () => {
  it('writes each note at its own velocity and keeps the Vel at 0', () => {
    const { roll, part, result } = bouncedRoll(gridSpec([gridNote(0), gridNote(2)]), 0);
    expect(part.velocity).toBe(0);
    expect(roll.notes.every((note) => note.velocity === undefined)).toBe(true);
    expect(result.ok && result.summary.silenced).toBe(0);
  });

  it('with an accent written as `accent`, keeps the Vel at 0 and silences nothing (windsor#755)', () => {
    const grid = gridSpec([gridNote(0, { accent: true }), gridNote(2)], { accentVelocity: 0.3 });
    const { roll, part, result } = bouncedRoll(grid, 0);
    expect(part.velocity).toBe(0);
    expect(roll).toMatchObject({ accentVelocity: 0.3 });
    expect(roll.notes.slice(0, 2)).toEqual([
      { tick: 0, ticks: 6, pitch: 33, accent: true },
      { tick: 6, ticks: 6, pitch: 36 },
    ]);
    expect(result.ok && result.summary.silenced).toBe(0);
  });
});
