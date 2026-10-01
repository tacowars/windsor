/**
 * The under-the-hits pass while paused (windsor#383, decision 1): paused on
 * pass 3 of a 7-step lane under 16 steps, the cells show and write the lane
 * indices the resume plays; stopped, pass 0.
 */
import { describe, expect, it } from 'vitest';

import type { RegionStep } from '@windsor/engine';
import { laneStep } from '@windsor/engine';
import { type LaneLayout, cellLaneIndex } from './euclidLaneView';
import { type PassSource, shownPass } from './euclidPass';

const STEPS = 16;
const LENGTH = 7;
/** Pass 3, five steps in: the step the pause kept. */
const HELD: RegionStep = { step: 5, live: true, localStep: 3 * STEPS + 5 };

const source = (change: Partial<PassSource>): PassSource => ({
  view: 'hits',
  steps: STEPS,
  at: null,
  state: 'paused',
  heldStep: () => HELD,
  ...change,
});

const layout = (pass: number): LaneLayout => ({ view: 'hits', steps: STEPS, pass, length: LENGTH });

describe('the under-the-hits pass', () => {
  it('paused on pass 3, shows pass 3', () => {
    expect(shownPass(source({}))).toBe(3);
  });

  it('paused, each cell writes the lane index the resume plays under it', () => {
    const shown = layout(shownPass(source({})));
    for (let cell = 0; cell < STEPS; cell++) {
      // On resume, trigger cell `cell` of this pass is local step 48 + cell.
      expect(cellLaneIndex(shown, cell)).toBe(laneStep(3 * STEPS + cell, LENGTH));
    }
    // Pass 3 starts on lane step 48 mod 7 = 6, not on pass 0's 0.
    expect(cellLaneIndex(shown, 0)).toBe(6);
  });

  it('stopped, shows pass 0 without reading the held step', () => {
    let read = false;
    const stopped = source({
      state: 'idle',
      heldStep: () => {
        read = true;
        return HELD;
      },
    });
    expect(shownPass(stopped)).toBe(0);
    expect(read).toBe(false);
  });

  it('playing, reads the frame step', () => {
    const at: RegionStep = { step: 2, live: true, localStep: 2 * STEPS + 2 };
    expect(shownPass(source({ state: 'playing', at }))).toBe(2);
  });

  it('in the own-length view, is always pass 0', () => {
    expect(shownPass(source({ view: 'own' }))).toBe(0);
  });
});
