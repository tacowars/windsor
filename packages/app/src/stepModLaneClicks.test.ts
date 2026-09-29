/**
 * The lane cells' click timing (windsor#31): a double-click writes only its
 * reset, a click waits out the window, a drag writes at once, and a waiting
 * click lands on its own lane, by parameter, or nowhere.
 */
import { describe, expect, it } from 'vitest';

import type { StepModLane, StepModParam } from '@windsor/engine';
import { LaneClickGate, type LaneClock, isDrag } from './stepModLaneClicks';
import { rotateLanes } from './gridModel';
import { removeLane, withParamValues } from './stepModLaneModel';
import { LANE_CLICK_SLOP_PX } from './stepModLaneTables';

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
    gate.press(CUT, 1);
    gate.release(CUT, 1, [0, 0.6, 0.2], false);
    clock.advance(120);
    gate.press(CUT, 1);
    expect(writes).toEqual([]);
    // The second press painted where it went down; still, it is a double-click.
    expect(gate.release(CUT, 1, [0, 0.45, 0.2], false)).toBe('reset');
    // The browser's dblclick lands here; the gate has nothing left to do.
    clock.advance(1000);
    expect(writes).toEqual([[CUT, [0, 0, 0.2]]]);
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
    clock.advance(1000);
    expect(writes).toEqual([[CUT, [0, 0.8, 0.5]]]);
  });

  it('writes the held click when the second press is cancelled before its release', () => {
    const { writes, clock, gate } = setup();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.7, 0], false);
    clock.advance(50);
    gate.press(CUT, 0);
    gate.flush();
    clock.advance(1000);
    expect(writes).toEqual([[CUT, [0.7, 0]]]);
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
    gate.press(CUT, 1);
    expect(writes).toEqual([[CUT, [0.3, 0]]]);
    gate.release(CUT, 1, [0.3, 0.7], false);
    clock.advance(300);
    gate.press(CUT, 1);
    expect(gate.release(CUT, 1, [0.3, 0.2], false)).toBe('values');
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
    /** Another card edit: `next` reads the lanes through the getter it is handed, after any flush. */
    const edit = (next: (now: () => StepModLane[]) => StepModLane[]): void => {
      lanes = next(() => lanes);
    };
    return { clock, gate, remove, edit, writes, lanes: () => lanes };
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

  it('writes a held click before Rotate, so the turn carries the clicked value with its step', () => {
    const { clock, gate, writes, lanes, edit } = card();
    gate.press(CUT, 0);
    gate.release(CUT, 0, [0.9, 0], false);
    // Rotate by one within the window: the card flushes, then reads and turns the lanes.
    edit((now) => {
      gate.flush();
      return rotateLanes(now(), 1, 2);
    });
    expect(lanes()).toEqual([lane(CUT, [0, 0.9]), lane(LVL, [0.5, 0.5])]);
    clock.advance(1000);
    expect(writes).toEqual([[lane(CUT, [0.9, 0]), lane(LVL, [0.5, 0.5])]]);
    expect(lanes()).toEqual([lane(CUT, [0, 0.9]), lane(LVL, [0.5, 0.5])]);
  });

  it('writes nothing for a lane that has gone, whatever took its place', () => {
    const lanes = [lane(LVL, [0.5])];
    expect(withParamValues(lanes, CUT, [0.9])).toBeNull();
    expect(withParamValues(lanes, LVL, [0.9])).toEqual([lane(LVL, [0.9])]);
  });
});
