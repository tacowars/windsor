/**
 * The Roll's zoom gestures (windsor#903): the ruler's drag zooms around the
 * pressed tick and scrolls with the pointer, within the region's floor and
 * 240 px per beat; the keys' drag sets the row height around the pressed
 * row, whatever mix of zoomed, thin and filled rows the keys lay out, and
 * scrolls the rows; a pinch zooms an axis only once the fingers are apart on
 * it; the Ctrl or ⌘ wheel's zoom. Every move works from the press, so moves
 * between two paints land where the last one says.
 */
import { describe, expect, it } from 'vitest';
import { type RollRow, type RowInput, type RowLayout, rollRows, rowIndexAt } from './rollRows';
import { ROLL_ROW_ZOOM, ROLL_TIME_ZOOM, ROLL_ZOOM_GESTURE } from './rollTables';
import {
  type PanePoint,
  type ZoomPress,
  keysDrag,
  pinchAxis,
  rulerDrag,
  startPinch,
  stepKeys,
  stepPinch,
  stepRuler,
  wheelFactor,
} from './rollZoomGestures';
import {
  type TimeBounds,
  fitsOf,
  regionFitPx,
  zoomRowsAbout,
  zoomTimeAbout,
} from './rollZoomModel';
import { SONG_DRAG_THRESHOLD_PX } from './songViewTables';
import type { RulerDrag, RulerDragEvent } from './songZoomModel';

const BEAT = 24;
const BAR = 4 * BEAT;
const PER = 60;

/** A 2-bar loop in an 8-bar region on a pane 1000 px wide. */
const TIME: TimeBounds = { widthPx: 1000, loopTicks: 2 * BAR, regionTicks: 8 * BAR };

/** A press at `x`, `y` in the pane, which sits at 40, 20 on screen. */
const press = (x: number, y: number): ZoomPress => ({
  pointerId: 1,
  clientX: 40 + x,
  clientY: 20 + y,
  at: { x, y },
});

const move = (drag: RulerDrag, dx: number, dy: number): RulerDragEvent => ({
  type: 'move',
  pointerId: drag.pointerId,
  buttons: 1,
  clientX: 40 + 300 + dx,
  clientY: 20 + 50 + dy,
});

/** The tick `x` px into a view. */
const tickAt = (view: { beatPx: number; left: number }, x: number): number =>
  view.left + (x * BEAT) / view.beatPx;

describe('the ruler', () => {
  const start = { beatPx: 100, left: BAR };
  const drag = rulerDrag(press(300, 50), start, TIME);
  const pressed = tickAt(start, 300);

  it('doubles px per beat for a drag up of 60 px and halves it for one down, the pressed tick fixed', () => {
    const up = stepRuler(drag, move(drag, 0, -PER)).view;
    expect(up?.beatPx).toBeCloseTo(200);
    expect(tickAt(up ?? start, 300)).toBeCloseTo(pressed);
    const down = stepRuler(drag, move(drag, 0, PER)).view;
    expect(down?.beatPx).toBeCloseTo(50);
    expect(tickAt(down ?? start, 300)).toBeCloseTo(pressed);
  });

  it('carries the pressed tick with the pointer sideways', () => {
    const view = stepRuler(drag, move(drag, -50, 0)).view;
    expect(view?.beatPx).toBe(100);
    expect(tickAt(view ?? start, 250)).toBeCloseTo(pressed);
  });

  it('clamps at 240 px per beat and at the region, which lights Region', () => {
    expect(stepRuler(drag, move(drag, 0, -10 * PER)).view?.beatPx).toBe(ROLL_TIME_ZOOM.maxBeatPx);
    const out = stepRuler(drag, move(drag, 0, 10 * PER)).view;
    expect(out).toEqual({ beatPx: regionFitPx(TIME), left: 0 });
    expect(fitsOf(out ?? start, TIME).region).toBe(true);
  });

  it('works from the press, however many moves come before a paint', () => {
    const first = stepRuler(drag, move(drag, 0, -PER));
    const second = stepRuler(first.drag, move(drag, 20, -PER / 2));
    expect(second.view).toEqual(stepRuler(drag, move(drag, 20, -PER / 2)).view);
    expect(second.view?.beatPx).toBeCloseTo(100 * Math.SQRT2);
  });

  it("starts past the Song tab's threshold, and a release in place changes nothing", () => {
    const under = SONG_DRAG_THRESHOLD_PX - 1;
    expect(stepRuler(drag, move(drag, 0, -under)).view).toBeNull();
    expect(stepRuler(drag, move(drag, 0, -SONG_DRAG_THRESHOLD_PX)).view).not.toBeNull();
    const up = stepRuler(drag, { type: 'up', pointerId: 1 });
    expect(up).toEqual({ drag: null, view: null, tap: true });
  });

  it('ends on a blur, a cancel or a move with the button up', () => {
    expect(stepRuler(drag, { type: 'blur' }).drag).toBeNull();
    expect(stepRuler(drag, { type: 'cancel', pointerId: 1 }).drag).toBeNull();
    const hover = { ...move(drag, 0, -PER), buttons: 0 };
    expect(stepRuler(drag, hover)).toEqual({ drag: null, view: null, tap: false });
  });
});

describe('the keys', () => {
  /** A minor's pitch classes: A B C D E F G. */
  const A_MINOR = new Set([9, 11, 0, 2, 4, 5, 7]);
  /** The rows `rollRows` lays out in a pane 168 px tall, 12 at 7 px unless `over` says otherwise. */
  const layout = (over: Partial<RowInput>): RowLayout =>
    rollRows({
      keys: '12',
      fold: false,
      rowPx: 7,
      used: new Set(),
      scalePcs: A_MINOR,
      panePx: 168,
      ...over,
    });
  type View = { rowPx: number; top: number };
  const start = { rowPx: 7, top: 100 };
  const drag = keysDrag(press(20, 50), start, { rows: layout({}), heightPx: 168 });
  const keysMove = (dx: number, dy: number, y = 50): RulerDragEvent => ({
    type: 'move',
    pointerId: 1,
    buttons: 1,
    clientX: 40 + 20 + dx,
    clientY: 20 + y + dy,
  });
  /** The pitch `y` px under the pane's top in `view`, and how far down its row, as the next paint lays the rows out. */
  const pressed = (input: Partial<RowInput>, view: View, y: number) => {
    const { rows } = layout({ ...input, rowPx: view.rowPx });
    const row = rows[rowIndexAt(rows, view.top + y)] as RollRow;
    return { pitch: row.pitch, share: (view.top + y - row.top) / row.h };
  };
  const expectSameRow = (a: ReturnType<typeof pressed>, b: ReturnType<typeof pressed>): void => {
    expect(a.pitch).toBe(b.pitch);
    expect(a.share).toBeCloseTo(b.share);
  };

  /**
   * A press `y` px down `input`'s rows at `view`: a drag right of 60 px
   * doubles the rows with the pressed row under the pointer, and a second
   * move before the paint lands where one move to it lands, the row still
   * under the pointer.
   */
  const holdsPressedRow = (input: Partial<RowInput>, view: View, y: number): void => {
    const rows = layout({ ...input, rowPx: view.rowPx });
    const from = keysDrag(press(20, y), view, { rows, heightPx: 168 });
    const before = pressed(input, view, y);
    const first = stepKeys(from, keysMove(PER, 0, y));
    expect(first.view?.rowPx).toBeCloseTo(2 * view.rowPx);
    expectSameRow(pressed(input, first.view ?? view, y), before);
    const second = stepKeys(first.drag, keysMove(PER / 2, 6, y));
    expect(second.view).toEqual(stepKeys(from, keysMove(PER / 2, 6, y)).view);
    expectSameRow(pressed(input, second.view ?? view, y + 6), before);
  };

  it('doubles the row height for a drag right of 60 px, around the pressed row', () => {
    holdsPressedRow({}, start, 50);
  });

  it('holds the pressed row under Keys: Scale, past thin slivers that keep their height', () => {
    // Bb3, C#4 and F#4 lie outside A minor and hold notes: three 3 px slivers above the press.
    const scale = { keys: 'scale' as const, used: new Set([57, 58, 61, 66]) };
    expect(layout(scale).rows.filter((row) => row.thin)).toHaveLength(3);
    holdsPressedRow(scale, { rowPx: 7, top: 100 }, 90);
  });

  it('holds the pressed row under Fold, its rows filled taller than the zoom', () => {
    // 20 rows fill 168 px at 8 px each over the zoom's 7: the eleventh starts at y = 80.
    const fold = { fold: true, used: new Set(Array.from({ length: 20 }, (_, i) => 50 + i)) };
    const { rows } = layout(fold);
    expect(rows[10]).toMatchObject({ top: 80, h: 8 });
    holdsPressedRow(fold, { rowPx: 7, top: 0 }, 84);
  });

  it('a drag left makes rows shorter, between 4 and 24 px', () => {
    expect(stepKeys(drag, keysMove(-PER / 2, 0)).view?.rowPx).toBeCloseTo(7 / Math.SQRT2);
    expect(stepKeys(drag, keysMove(-10 * PER, 0)).view?.rowPx).toBe(ROLL_ROW_ZOOM.minPx);
    expect(stepKeys(drag, keysMove(10 * PER, 0)).view?.rowPx).toBe(ROLL_ROW_ZOOM.maxPx);
  });

  it('up and down carry the rows with the pointer', () => {
    expect(stepKeys(drag, keysMove(0, 20)).view).toEqual({ rowPx: 7, top: 80 });
    expect(stepKeys(drag, keysMove(0, -20)).view).toEqual({ rowPx: 7, top: 120 });
  });

  it('works from the press, and a tap is a release in place', () => {
    const first = stepKeys(drag, keysMove(PER, 0));
    expect(stepKeys(first.drag, keysMove(PER / 2, 10)).view).toEqual(
      stepKeys(drag, keysMove(PER / 2, 10)).view,
    );
    expect(stepKeys(drag, { type: 'up', pointerId: 1 }).tap).toBe(true);
    expect(stepKeys(first.drag, { type: 'up', pointerId: 1 }).tap).toBe(false);
  });
});

describe('the pinch', () => {
  const MIN = ROLL_ZOOM_GESTURE.pinchMinPx;
  const views = {
    time: { beatPx: 100, left: BAR },
    rows: { rowPx: 7, top: 100 },
    timeBounds: TIME,
    rowBounds: { heightPx: 168, scaled: 73, fixedPx: 0 },
  };
  const pair = (a: PanePoint, b: PanePoint): [PanePoint, PanePoint] => [a, b];

  it('zooms an axis only once the fingers are 40 px apart on it, from the spread they had then', () => {
    expect(pinchAxis(null, MIN - 1)).toEqual({ from: null, factor: 1 });
    expect(pinchAxis(null, MIN)).toEqual({ from: MIN, factor: 1 });
    expect(pinchAxis(MIN, 2 * MIN)).toEqual({ from: MIN, factor: 2 });
    // Closing past 40 px holds at 40, never a sliver's ratio.
    expect(pinchAxis(2 * MIN, 1)).toEqual({ from: 2 * MIN, factor: 0.5 });
  });

  it('spread sideways zooms time around the midpoint, and leaves the rows', () => {
    const pinch = startPinch(pair({ x: 100, y: 50 }, { x: 300, y: 60 }), views);
    const step = stepPinch(pinch, pair({ x: 0, y: 50 }, { x: 400, y: 60 }));
    expect(step.time).toEqual(zoomTimeAbout(views.time, TIME, { factor: 2, x: 200 }));
    expect(step.rows.rowPx).toBe(7);
    expect(step.rows.top).toBeCloseTo(100);
    expect(step.zooms).toEqual({ time: true, rows: false });
  });

  it('spread up and down zooms the rows once they are apart on it', () => {
    const pinch = startPinch(pair({ x: 200, y: 40 }, { x: 210, y: 60 }), views);
    const apart = stepPinch(pinch, pair({ x: 200, y: 30 }, { x: 210, y: 80 }));
    expect(apart.rows.rowPx).toBe(7);
    expect(apart.zooms.rows).toBe(true);
    const wider = stepPinch(apart.pinch, pair({ x: 200, y: 5 }, { x: 210, y: 105 }));
    const about = { factor: 2, y: 50, to: 55 };
    expect(wider.rows).toEqual(zoomRowsAbout(views.rows, views.rowBounds, about));
    expect(wider.time.beatPx).toBe(100);
  });

  it('the tick under the starting midpoint follows the midpoint', () => {
    const pinch = startPinch(pair({ x: 100, y: 50 }, { x: 300, y: 50 }), views);
    const step = stepPinch(pinch, pair({ x: 60, y: 50 }, { x: 260, y: 50 }));
    expect(step.time.beatPx).toBe(100);
    expect(tickAt(step.time, 160)).toBeCloseTo(tickAt(views.time, 200));
  });
});

describe('the Ctrl or ⌘ wheel', () => {
  it('zooms in for a wheel up and out for a wheel down, by e per 100 px, at most 50 px an event', () => {
    expect(wheelFactor({ deltaY: -10, deltaMode: 0 })).toBeCloseTo(Math.exp(0.1));
    expect(wheelFactor({ deltaY: 10, deltaMode: 0 })).toBeCloseTo(Math.exp(-0.1));
    expect(wheelFactor({ deltaY: -400, deltaMode: 0 })).toBeCloseTo(Math.exp(0.5));
  });

  it('counts a line of wheel as 16 px', () => {
    expect(wheelFactor({ deltaY: 1, deltaMode: 1 })).toBeCloseTo(Math.exp(-0.16));
  });
});
