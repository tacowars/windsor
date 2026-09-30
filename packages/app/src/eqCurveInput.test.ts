/**
 * The EQ curve's wheel undo steps (windsor#199) over a real `AppContext`, as
 * the gesture hook tests run: ticks on one band a moment apart are one step,
 * and a tick on another band within `UNDO_MERGE_MS` is a step of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { bandWheelGesture } from './eqCurveInput';
import type { BandWheelGesture } from './eqCurveInput';
import { settleGestures } from './gestureHooks';
import { UNDO_MERGE_MS } from './undoConstants';

type Ctx = ReturnType<typeof openGestureConsole>;
const levelOf = (ctx: Ctx): number | undefined => ctx.model.doc.parts[0]?.strip.level;

/** How far apart the ticks come: well inside the merge window. */
const TICK_MS = 50;

describe('the wheel over the curve', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    settleGestures();
    vi.useRealTimers();
  });

  /** One tick over `band`: the gesture touched, then its edit (a stand-in level). */
  function tick(ctx: Ctx, wheel: BandWheelGesture, band: number, value: number): void {
    wheel.touch(band);
    ctx.change(partChange(0, { strip: { level: value } }));
    vi.advanceTimersByTime(TICK_MS);
  }

  it('makes each band its own step when two are wheeled within the merge window', () => {
    const ctx = openGestureConsole();
    const start = levelOf(ctx);
    const wheel = bandWheelGesture(new EventTarget());
    tick(ctx, wheel, 0, 0.3);
    tick(ctx, wheel, 0, 0.4);
    tick(ctx, wheel, 1, 0.5);
    tick(ctx, wheel, 1, 0.6);
    vi.advanceTimersByTime(UNDO_MERGE_MS);
    expect(ctx.undoLabel).toBe('EQ band Q');
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(0.4);
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(start);
    expect(ctx.undo()).toBe(false);
  });

  it('makes a band wheeled again after another a new step', () => {
    const ctx = openGestureConsole();
    const wheel = bandWheelGesture(new EventTarget());
    tick(ctx, wheel, 0, 0.3);
    tick(ctx, wheel, 1, 0.4);
    tick(ctx, wheel, 0, 0.5);
    vi.advanceTimersByTime(UNDO_MERGE_MS);
    let steps = 0;
    while (ctx.undo()) steps++;
    expect(steps).toBe(3);
  });
});
