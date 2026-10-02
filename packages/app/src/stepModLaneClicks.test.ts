/**
 * The lane cells' click timing (windsor#31): every release writes at once,
 * a still second press on the same cell inside the window writes the reset,
 * and a click lands on its own lane, by parameter, or nowhere.
 */
import { describe, expect, it } from 'vitest';

import type { StepModLane, VoiceTargetPath } from '@windsor/engine';
import { LaneClickGate, type LaneClock, isDrag } from './stepModLaneClicks';
import { withParamValues } from './stepModLaneModel';
import { LANE_CLICK_SLOP_PX } from './stepModLaneTables';

const lane = (param: VoiceTargetPath, values: number[]): StepModLane => ({ param, values });

describe('clicks, drags and the double-click', () => {
  const CUT = 'filter.cutoff' as const;
  const LVL = 'ops.1.level' as const;
  /** A clock the test moves by hand. */
  function fakeClock(): LaneClock & { advance(ms: number): void } {
    let t = 0;
    return {
      now: () => t,
      advance(ms) {
        t += ms;
      },
    };
  }
  const setup = () => {
    const writes: [VoiceTargetPath, number[]][] = [];
    const clock = fakeClock();
    const gate = new LaneClickGate((lane, values) => writes.push([lane, [...values]]), clock, 250);
    return { writes, clock, gate };
  };

  it('writes a click at once', () => {
    const { writes, gate } = setup();
    gate.press(LVL, 2);
    expect(gate.release(LVL, 2, [0, 0, 0.5], false)).toBe('values');
    expect(writes).toEqual([[LVL, [0, 0, 0.5]]]);
  });

  it('writes a drag at once', () => {
    const { writes, gate } = setup();
    gate.press(CUT, 0);
    expect(gate.release(CUT, 0, [0.4, 0.8], true)).toBe('values');
    expect(writes).toEqual([[CUT, [0.4, 0.8]]]);
  });

  it('writes a still second press on the same cell inside the window as the reset', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 1);
    gate.release(CUT, 1, [0, 0.6, 0.2], false);
    clock.advance(250);
    gate.press(CUT, 1);
    // The second press painted where it went down; still, it is a double-click.
    expect(gate.release(CUT, 1, [0, 0.45, 0.2], false)).toBe('reset');
    expect(writes).toEqual([
      [CUT, [0, 0.6, 0.2]],
      [CUT, [0, 0, 0.2]],
    ]);
  });

  it('treats a second press after the window as a plain click', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 1);
    gate.release(CUT, 1, [0, 0.6], false);
    clock.advance(251);
    gate.press(CUT, 1);
    expect(gate.release(CUT, 1, [0, 0.3], false)).toBe('values');
    expect(writes).toEqual([
      [CUT, [0, 0.6]],
      [CUT, [0, 0.3]],
    ]);
  });

  it('times the window from the release to the second press, not to its release', () => {
    const { clock, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.5], false);
    clock.advance(200);
    gate.press(CUT, 0);
    clock.advance(200);
    expect(gate.release(CUT, 0, [0.5], false)).toBe('reset');
  });

  it('treats a second press on another cell, or on another lane at the same index, as a plain click', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.3, 0], false);
    clock.advance(50);
    gate.press(CUT, 1);
    expect(gate.release(CUT, 1, [0.3, 0.7], false)).toBe('values');
    clock.advance(50);
    gate.press(LVL, 1);
    expect(gate.release(LVL, 1, [0.5, 0.2], false)).toBe('values');
    expect(writes).toEqual([
      [CUT, [0.3, 0]],
      [CUT, [0.3, 0.7]],
      [LVL, [0.5, 0.2]],
    ]);
  });

  it('writes a second press on the same cell that drags as its drag, not the reset', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 1);
    gate.release(CUT, 1, [0, 0.6, 0.2], false);
    clock.advance(100);
    gate.press(CUT, 1);
    // Moved past the slop before the release: a drag refining the cell and painting the next.
    expect(isDrag(0, LANE_CLICK_SLOP_PX + 1)).toBe(true);
    expect(gate.release(CUT, 1, [0, 0.8, 0.5], true)).toBe('values');
    expect(writes).toEqual([
      [CUT, [0, 0.6, 0.2]],
      [CUT, [0, 0.8, 0.5]],
    ]);
  });

  it('writes a triple click as click, reset, click', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.7, 0.1], false);
    clock.advance(100);
    gate.press(CUT, 0);
    expect(gate.release(CUT, 0, [0.7, 0.1], false)).toBe('reset');
    clock.advance(100);
    gate.press(CUT, 0);
    expect(gate.release(CUT, 0, [0.4, 0.1], false)).toBe('values');
    expect(writes).toEqual([
      [CUT, [0.7, 0.1]],
      [CUT, [0, 0.1]],
      [CUT, [0.4, 0.1]],
    ]);
  });

  it('pairs nothing with a drag: a click after a drag on the same cell is a plain click', () => {
    const { clock, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.9], true);
    clock.advance(50);
    gate.press(CUT, 0);
    expect(gate.release(CUT, 0, [0.2], false)).toBe('values');
  });

  it('tells a click from a drag by the travel past the slop', () => {
    expect(isDrag(2, -3)).toBe(false);
    expect(isDrag(0, 4)).toBe(true);
    expect(isDrag(-4, 0)).toBe(true);
  });

  it('writes nothing for a lane that has gone, whatever took its place', () => {
    const lanes = [lane(LVL, [0.5])];
    expect(withParamValues(lanes, CUT, [0.9])).toBeNull();
    expect(withParamValues(lanes, LVL, [0.9])).toEqual([lane(LVL, [0.9])]);
  });
});
