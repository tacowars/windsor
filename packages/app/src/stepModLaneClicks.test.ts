/**
 * The lane cells' click timing (windsor#31): a double-click writes only its
 * reset, a click waits out the window, a drag writes at once, and a waiting
 * click lands on its own lane, by parameter, or nowhere.
 */
import { describe, expect, it } from 'vitest';

import type { StepModLane, StepModParam } from '@windsor/engine';
import { LaneClickGate, type LaneClock, isDrag } from './stepModLaneClicks';
import { removeLane, withParamValues } from './stepModLaneModel';

const lane = (param: StepModParam, values: number[]): StepModLane => ({ param, values });

describe('clicks, drags and the double-click', () => {
  const CUT = 'filter.cutoff' as const;
  const LVL = 'ops.1.level' as const;
  /** A clock the test moves by hand, firing due timers as it goes. */
  function fakeClock(): LaneClock & { advance(ms: number): void } {
    let t = 0;
    let timers: { due: number; fn: () => void; live: boolean }[] = [];
    return {
      now: () => t,
      after: (ms, fn) => {
        const timer = { due: t + ms, fn, live: true };
        timers.push(timer);
        return () => void (timer.live = false);
      },
      advance(ms) {
        t += ms;
        const due = timers.filter((x) => x.live && x.due <= t);
        timers = timers.filter((x) => !due.includes(x));
        for (const x of due) x.fn();
      },
    };
  }
  const setup = () => {
    const writes: [StepModParam, number[]][] = [];
    const clock = fakeClock();
    const gate = new LaneClickGate((lane, values) => writes.push([lane, [...values]]), clock, 250);
    return { writes, clock, gate };
  };

  it('writes a double-click (down, up, down, up, dblclick) once, as the reset', () => {
    const { writes, clock, gate } = setup();
    expect(gate.press(CUT, 1)).toBe('paint');
    gate.release(CUT, 1, [0, 0.6, 0.2], false);
    clock.advance(120);
    expect(gate.press(CUT, 1)).toBe('reset');
    gate.release(CUT, 1, [], false);
    // The browser's dblclick lands here; the gate has nothing left to do.
    clock.advance(1000);
    expect(writes).toEqual([[CUT, [0, 0, 0.2]]]);
  });

  it('writes a single click once, when the window closes', () => {
    const { writes, clock, gate } = setup();
    gate.press(LVL, 2);
    gate.release(LVL, 2, [0, 0, 0.5], false);
    clock.advance(249);
    expect(writes).toEqual([]);
    clock.advance(1);
    expect(writes).toEqual([[LVL, [0, 0, 0.5]]]);
    clock.advance(1000);
    expect(writes).toHaveLength(1);
  });

  it('writes a drag at once', () => {
    const { writes, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.4, 0.8], true);
    expect(writes).toEqual([[CUT, [0.4, 0.8]]]);
  });

  it('writes a waiting click before a press elsewhere, and a late second press is a new click', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.3, 0], false);
    expect(gate.press(CUT, 1)).toBe('paint');
    expect(writes).toEqual([[CUT, [0.3, 0]]]);
    gate.release(CUT, 1, [0.3, 0.7], false);
    clock.advance(300);
    expect(gate.press(CUT, 1)).toBe('paint');
    expect(writes).toEqual([
      [CUT, [0.3, 0]],
      [CUT, [0.3, 0.7]],
    ]);
  });

  it('tells a click from a drag by the travel past the slop', () => {
    expect(isDrag(2, -3)).toBe(false);
    expect(isDrag(0, 4)).toBe(true);
    expect(isDrag(-4, 0)).toBe(true);
  });
  /** A card over the gate: its lanes, written by parameter the way `stepModLane.ts` writes them. */
  const card = () => {
    const { clock } = setup();
    let lanes: StepModLane[] = [lane(CUT, [0, 0]), lane(LVL, [0.5, 0.5])];
    const writes: StepModLane[][] = [];
    const gate = new LaneClickGate(
      (param, values) => {
        const next = withParamValues(lanes, param, values);
        if (!next) return;
        lanes = next;
        writes.push(next);
      },
      clock,
      250,
    );
    const remove = (index: number): void => {
      gate.cancel(lanes[index]!.param);
      lanes = removeLane(lanes, index);
    };
    return { clock, gate, remove, writes, lanes: () => lanes };
  };

  it('drops a waiting click when its lane is removed in the window', () => {
    const { clock, gate, remove, writes, lanes } = card();
    gate.press(CUT, 1);
    gate.release(CUT, 1, [0, 0.9], false);
    remove(0);
    clock.advance(1000);
    expect(writes).toEqual([]);
    expect(lanes()).toEqual([lane(LVL, [0.5, 0.5])]);
  });

  it('keeps a waiting click on its own lane when an earlier lane is removed in the window', () => {
    const { clock, gate, remove, writes, lanes } = card();
    gate.press(LVL, 0);
    gate.release(LVL, 0, [-0.4, 0.5], false);
    remove(0);
    clock.advance(1000);
    expect(lanes()).toEqual([lane(LVL, [-0.4, 0.5])]);
    expect(writes).toEqual([[lane(LVL, [-0.4, 0.5])]]);
  });

  it('writes nothing for a lane that has gone, whatever took its place', () => {
    const lanes = [lane(LVL, [0.5])];
    expect(withParamValues(lanes, CUT, [0.9])).toBeNull();
    expect(withParamValues(lanes, LVL, [0.9])).toEqual([lane(LVL, [0.9])]);
  });
});
