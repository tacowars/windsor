/**
 * The EQ curve's wheel undo steps (windsor#199) over a real `AppContext`, as
 * the gesture hook tests run: ticks on one band a moment apart are one step,
 * and a tick on another band within `UNDO_MERGE_MS` is a step of its own.
 * And the wheel handler over event-shaped objects: a notch turns Q as far
 * whether the device reports it in pixels, lines or pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EQ } from '@windsor/engine';

import { openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { bandWheelGesture, wheelCurve } from './eqCurveInput';
import type { BandWheelGesture, EqWheel, EqWheelHost } from './eqCurveInput';
import { WHEEL_DELTA_MODE, eqPlot, pointAt, withBand } from './eqCurveModel';
import { EQ_GESTURE } from './eqTables';
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

describe('the wheel over a point, whatever unit the device reports', () => {
  const RATE = 48000;
  const PLOT = eqPlot(12);
  const BAND = 2;
  const spec = withBand(DEFAULT_EQ, BAND, {
    ...DEFAULT_EQ.bands[BAND]!,
    on: true,
    type: 'bell',
    freq: 1000,
    gain: 0,
    q: 1,
  });
  const at = pointAt(spec, BAND, PLOT, RATE);

  /** The band's Q after one wheel event of `deltaY` in `deltaMode` over its point. */
  function qAfter(deltaY: number, deltaMode: number): number {
    let edited = spec;
    const host: EqWheelHost = {
      canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect },
      spec: () => spec,
      plot: () => PLOT,
      sampleRate: () => RATE,
      selected: () => BAND,
      select: () => undefined,
      edit: (next) => {
        edited = next;
      },
      full: () => undefined,
    };
    const e: EqWheel = {
      clientX: at.x,
      clientY: at.y,
      deltaX: 0,
      deltaY,
      deltaMode,
      shiftKey: false,
      preventDefault: () => undefined,
    };
    wheelCurve(host, { touch: () => undefined }, e);
    return edited.bands[BAND]!.q;
  }

  it('turns Q as far for a notch in lines as for the same notch in pixels', () => {
    const byPixels = qAfter(-3 * EQ_GESTURE.wheelLinePx, WHEEL_DELTA_MODE.pixel);
    expect(byPixels).toBeGreaterThan(1);
    expect(qAfter(-3, WHEEL_DELTA_MODE.line)).toBeCloseTo(byPixels, 9);
  });

  it('turns Q as far for a page as for the plot height in pixels', () => {
    const byPixels = qAfter(-PLOT.height, WHEEL_DELTA_MODE.pixel);
    expect(byPixels).toBeGreaterThan(1);
    expect(qAfter(-1, WHEEL_DELTA_MODE.page)).toBeCloseTo(byPixels, 9);
  });
});
