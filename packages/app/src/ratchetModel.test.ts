/**
 * The shared ratchet model (windsor#368; record
 * `2026-10-01-sequencer-rack-devices` decision 6): a note step's roll cycles
 * ×1 → ×2 → ×3 → ×4 → ×1, a rest or a tie has none and ignores a click, a
 * note that becomes a rest or a tie loses its roll, and Rotate carries the
 * roll with its step. The Euclid row's own cases stay in
 * `euclidRatchetModel.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { GridStep } from '@windsor/engine';
import { RATCHET_MAX, gridNote } from '@windsor/engine';
import { cycleKind, rotateSteps, withStep } from './gridModel';
import { cycleStepRatchet, nextRatchet, stepRatchet, takesRatchet } from './ratchetModel';

const REST: GridStep = { kind: 'rest' };
const TIE: GridStep = { kind: 'tie' };

describe('a step’s ratchet (windsor#368)', () => {
  it('cycles a note ×1 → ×2 → ×3 → ×4 → ×1', () => {
    let step: GridStep = gridNote(2, { accent: true });
    const seen: number[] = [];
    for (let click = 0; click < RATCHET_MAX + 1; click++) {
      step = cycleStepRatchet(step);
      seen.push(stepRatchet(step));
    }
    expect(seen).toEqual([2, 3, 4, 1, 2]);
    expect(step).toEqual(gridNote(2, { accent: true, ratchet: 2 }));
  });

  it('writes no field at ×1, as the engine’s normaliser does', () => {
    const four = gridNote(0, { ratchet: RATCHET_MAX });
    expect(cycleStepRatchet(four)).toEqual(gridNote());
    expect(cycleStepRatchet(four)).not.toHaveProperty('ratchet');
  });

  it('reads a note without one as ×1', () => {
    expect(stepRatchet(gridNote())).toBe(1);
    expect(stepRatchet(undefined)).toBe(1);
    expect(nextRatchet(1)).toBe(2);
    expect(nextRatchet(RATCHET_MAX)).toBe(1);
  });

  it('gives a rest or a tie none: grey, and a click leaves it as it is', () => {
    expect(takesRatchet(REST)).toBe(false);
    expect(takesRatchet(TIE)).toBe(false);
    expect(takesRatchet(undefined)).toBe(false);
    expect(takesRatchet(gridNote())).toBe(true);
    expect(cycleStepRatchet(REST)).toBe(REST);
    expect(cycleStepRatchet(TIE)).toBe(TIE);
    expect(stepRatchet(TIE)).toBe(1);
  });

  it('drops a note’s ratchet when it becomes a tie, and a rest becomes a plain note', () => {
    const rolled = gridNote(3, { ratchet: 3 });
    const tie = cycleKind(rolled);
    expect(tie).toEqual(TIE);
    expect(cycleKind(cycleKind(tie))).toEqual(gridNote());
  });

  it('turns with its step under Rotate', () => {
    const steps: GridStep[] = [
      gridNote(0, { ratchet: 2 }),
      REST,
      gridNote(1),
      gridNote(2, { ratchet: 4 }),
    ];
    const turned = rotateSteps(steps, 1, steps.length);
    expect(turned.map(stepRatchet)).toEqual([4, 2, 1, 1]);
    expect(turned[0]).toEqual(gridNote(2, { ratchet: 4 }));
    // Back again, and a cycle on the moved step lands on that step only.
    const back = rotateSteps(turned, -1, steps.length);
    expect(back).toEqual(steps);
    const cycled = withStep(back, 3, cycleStepRatchet(back[3]!));
    expect(cycled.map(stepRatchet)).toEqual([2, 1, 1, 1]);
  });
});
