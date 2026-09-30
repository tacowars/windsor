/**
 * The EQ curve's wheel undo steps (windsor#199) over a real `AppContext`, as
 * the gesture hook tests run: ticks on one band a moment apart are one step,
 * and a tick on another band within `UNDO_MERGE_MS` is a step of its own.
 * And the wheel handler over event-shaped objects: a notch turns Q as far
 * whether the device reports it in pixels, lines or pages. And the two limits
 * every gesture keeps: a 6 dB cut's Q, which it has none of, never moves, and
 * below 44.9 kHz the plot and every frequency input end where the engine's
 * filters do (`EQ_DSP.maxFrequencyRatio` of the sample rate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EqBand, EqSpec } from '@windsor/engine';
import { DEFAULT_EQ, EQ_BOUNDS, EQ_DSP } from '@windsor/engine';

import { openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { bandWheelGesture, wheelCurve } from './eqCurveInput';
import type { BandWheelGesture, EqWheel, EqWheelHost } from './eqCurveInput';
import {
  WHEEL_DELTA_MODE,
  doubleClick,
  dragBand,
  eqPlot,
  freqOfX,
  keyEdit,
  pointAt,
  withBand,
  xOfFreq,
} from './eqCurveModel';
import { EQ_GESTURE, EQ_PLOT } from './eqTables';
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
    expect(ctx.undoLabel).toBe('EQ band 2');
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(0.4);
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(start);
    expect(ctx.undo()).toBe(false);
  });

  it('names a wheel step on band 5 "EQ band 5", as a drag names it', () => {
    const ctx = openGestureConsole();
    const wheel = bandWheelGesture(new EventTarget());
    tick(ctx, wheel, 4, 0.3);
    tick(ctx, wheel, 4, 0.4);
    vi.advanceTimersByTime(UNDO_MERGE_MS);
    expect(ctx.undoLabel).toBe('EQ band 5');
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

/**
 * One wheel event of `deltaY` in `deltaMode` over band `band`'s point: the
 * spec after it, and how many edits and undo-step touches it made.
 */
function wheelOnce(
  spec: EqSpec,
  band: number,
  o: { deltaY: number; deltaMode: number; rate: number },
): { spec: EqSpec; edits: number; touches: number } {
  const plot = eqPlot(12, o.rate);
  const at = pointAt(spec, band, plot, o.rate);
  const done = { spec, edits: 0, touches: 0 };
  const host: EqWheelHost = {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect },
    spec: () => spec,
    plot: () => plot,
    sampleRate: () => o.rate,
    selected: () => band,
    select: () => undefined,
    edit: (next) => {
      done.spec = next;
      done.edits++;
    },
    full: () => undefined,
  };
  const e: EqWheel = {
    clientX: at.x,
    clientY: at.y,
    deltaX: 0,
    deltaY: o.deltaY,
    deltaMode: o.deltaMode,
    shiftKey: false,
    preventDefault: () => undefined,
  };
  wheelCurve(host, { touch: () => void done.touches++ }, e);
  return done;
}

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

  function qAfter(deltaY: number, deltaMode: number): number {
    return wheelOnce(spec, BAND, { deltaY, deltaMode, rate: RATE }).spec.bands[BAND]!.q;
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

/** A band on `index` of DEFAULT_EQ: `fields` over an on bell at 1 kHz, Q 1. */
function specWith(index: number, fields: Partial<EqBand>): EqSpec {
  const band: EqBand = { ...DEFAULT_EQ.bands[index]!, on: true, type: 'bell', freq: 1000, q: 1 };
  return withBand(DEFAULT_EQ, index, { ...band, ...fields });
}

describe('a 6 dB cut, which has no Q', () => {
  const RATE = 48000;
  const PLOT = eqPlot(12, RATE);
  const cut = specWith(0, { type: 'lowcut', slope: 6, freq: 200, q: 3 });
  const band = cut.bands[0]!;

  it('keeps its Q under an Alt-drag, and the drag leaves it as it was', () => {
    const start = { band, scale: 1, x: 100, y: 80 };
    const moved = dragBand(start, { x: 160, y: 0, fine: false, alt: true }, PLOT);
    expect(moved).toEqual(band);
  });

  it('keeps its Q under the wheel, which edits nothing and opens no step', () => {
    const done = wheelOnce(cut, 0, { deltaY: -300, deltaMode: WHEEL_DELTA_MODE.pixel, rate: RATE });
    expect(done).toEqual({ spec: cut, edits: 0, touches: 0 });
  });

  it('keeps its Q under Alt with ↑ or ↓, which edits nothing', () => {
    for (const key of ['ArrowUp', 'ArrowDown'])
      expect(keyEdit(cut, 0, { key, alt: true, shift: false }, PLOT), key).toBeNull();
  });
});

describe('the plot at a 32 kHz sample rate', () => {
  const RATE = 32000;
  const PLOT = eqPlot(12, RATE);
  const EDGE = RATE * EQ_DSP.maxFrequencyRatio;
  const drag = (b: EqBand, dx: number, dy = 0): EqBand =>
    dragBand(
      { band: b, scale: 1, x: 100, y: 80 },
      { x: 100 + dx, y: 80 + dy, fine: false, alt: false },
      PLOT,
    );

  it("ends at the highest frequency the engine plays there, and at 48 kHz at the range's top", () => {
    expect(PLOT.maxFreq).toBe(EDGE);
    expect(xOfFreq(EDGE, PLOT)).toBeCloseTo(EQ_PLOT.width, 9);
    expect(freqOfX(EQ_PLOT.width, PLOT)).toBeCloseTo(EDGE, 6);
    expect(eqPlot(12, 48000).maxFreq).toBe(EQ_BOUNDS.freq[1]);
    expect(eqPlot(12).maxFreq).toBe(EQ_BOUNDS.freq[1]);
  });

  it('stops a drag, an arrow key and a double-click at that edge', () => {
    const spec = specWith(0, { freq: 15000 });
    expect(drag(spec.bands[0]!, EQ_PLOT.width)).toEqual({ ...spec.bands[0]!, freq: EDGE });
    const key = keyEdit(spec, 0, { key: 'ArrowRight', alt: false, shift: false }, PLOT);
    expect(key && 'band' in key && key.band.freq).toBe(EDGE);
    const added = doubleClick(DEFAULT_EQ, { x: EQ_PLOT.width, y: 80 }, PLOT, RATE);
    expect(added.kind === 'add' && added.spec.bands[added.band]!.freq).toBeCloseTo(EDGE, 6);
  });

  it('draws a stored 20 kHz point at the edge and keeps 20 kHz until it is moved across', () => {
    const spec = specWith(2, { freq: 20000, gain: 3 });
    const stored = spec.bands[2]!;
    expect(pointAt(spec, 2, PLOT, RATE).x).toBe(EQ_PLOT.width - EQ_PLOT.pointRadius);
    expect(drag(stored, 0, -20).freq).toBe(20000);
    const up = keyEdit(spec, 2, { key: 'ArrowUp', alt: false, shift: false }, PLOT);
    expect(up && 'band' in up && up.band.freq).toBe(20000);
    expect(drag(stored, -1).freq).toBeLessThanOrEqual(EDGE);
  });
});
