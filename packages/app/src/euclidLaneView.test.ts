/**
 * The Euclid card's lane views and playheads (windsor#356, decision 6 and
 * the acceptance list): under the hits, the index each cell shows, the
 * restart notch and the dimmed rests over passes of a 7-step lane under 16
 * steps; each row's ring on its own step from the engine's local step; and
 * the full cycle in steps and bars.
 */
import { describe, expect, it } from 'vitest';

import type { RegionStep } from '@windsor/engine';
import { DIVISORS, euclid } from '@windsor/engine';
import {
  type LaneLayout,
  cellCount,
  cellLaneIndex,
  cycleText,
  dimmedAt,
  fullCycle,
  laneHead,
  passOf,
  restartsAt,
  triggerHead,
} from './euclidLaneView';
import { DARK, ghostOf } from './regionPlayhead';

const hits = (pass: number): LaneLayout => ({ view: 'hits', steps: 16, pass, length: 7 });
const own: LaneLayout = { view: 'own', steps: 16, pass: 3, length: 7 };
const cells = (layout: LaneLayout): number[] =>
  Array.from({ length: cellCount(layout) }, (_, i) => i);

describe('a 7-step lane under 16 steps', () => {
  it('lays each pass out from where the lane is at that pass', () => {
    expect(cells(hits(0)).map((i) => cellLaneIndex(hits(0), i))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1,
    ]);
    // Pass 1 starts on local step 16, lane step 2.
    expect(cells(hits(1)).map((i) => cellLaneIndex(hits(1), i))).toEqual([
      2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3,
    ]);
    // Pass 7 is 112 steps in, a whole number of lane cycles: back to the start.
    expect(cellLaneIndex(hits(7), 0)).toBe(0);
  });

  it('marks a notch where the lane starts over, never on the first cell', () => {
    const notches = (layout: LaneLayout): number[] =>
      cells(layout).filter((i) => restartsAt(layout, i));
    expect(notches(hits(0))).toEqual([7, 14]);
    expect(notches(hits(1))).toEqual([5, 12]);
    expect(notches(hits(2))).toEqual([3, 10]);
    expect(notches(own)).toEqual([]);
  });

  it('dims the cells under a rest, only under the hits', () => {
    const figure = euclid(5, 16, 0);
    const dim = cells(hits(1)).filter((i) => dimmedAt(hits(1), figure, i));
    expect(dim).toEqual(cells(hits(1)).filter((i) => !figure[i]));
    expect(cells(own).some((i) => dimmedAt(own, figure, i))).toBe(false);
  });

  it('draws one cell per lane step at its own length, the cell its own index', () => {
    expect(cellCount(own)).toBe(7);
    expect(cells(own).map((i) => cellLaneIndex(own, i))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('the playheads', () => {
  const at = (localStep: number, live = true): RegionStep => ({
    step: localStep % 16,
    live,
    localStep,
  });

  it('puts each lane on its own step at its own length', () => {
    expect(laneHead(at(23), own)).toBe(23 % 7);
    expect(laneHead(at(23), { ...own, length: 5 })).toBe(3);
    expect(triggerHead(at(23))).toBe(7);
  });

  it('follows the trigger under the hits, the pass from the local step', () => {
    expect(laneHead(at(23), hits(1))).toBe(7);
    expect(passOf(at(23), 16)).toBe(1);
    expect(passOf(at(47), 16)).toBe(2);
    expect(passOf(null, 16)).toBe(0);
  });

  it('is a ghost while the region is not sounding, dark while halted', () => {
    expect(laneHead(at(9, false), own)).toBe(ghostOf(2));
    expect(triggerHead(at(9, false))).toBe(ghostOf(9));
    expect(laneHead(null, own)).toBe(DARK);
    expect(triggerHead(null)).toBe(DARK);
  });

  it('reads a region step without a local step as pass 0 at its step', () => {
    expect(laneHead({ step: 9, live: true }, own)).toBe(2);
  });
});

describe('the full cycle', () => {
  it('is the lcm of the steps and every lane, in steps and bars', () => {
    const cycle = fullCycle(16, [7, 5, 10], DIVISORS.sixteenth);
    expect(cycle).toEqual({ steps: 560, bars: 35 });
    expect(cycleText(cycle)).toBe('Rows line up every 35 bars (560 steps)');
  });

  it('is the trigger alone with no lanes', () => {
    const cycle = fullCycle(16, [], DIVISORS.sixteenth);
    expect(cycle).toEqual({ steps: 16, bars: 1 });
    expect(cycleText(cycle)).toBe('Rows line up every 1 bar (16 steps)');
    expect(cycleText(fullCycle(12, [], DIVISORS.sixteenth))).toBe(
      'Rows line up every 0.75 bars (12 steps)',
    );
  });
});
