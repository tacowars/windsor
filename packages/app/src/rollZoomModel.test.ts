/**
 * The Roll's zoom maths (windsor#902; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 1, 3 and 8): the
 * fits, the floor and the ceiling, the clamps, zooming about a point, an
 * edge moved with the other held, which fit a view sits on, and the zoom
 * bars' thumbs.
 */
import { describe, expect, it } from 'vitest';
import { type RollRow, type RowInput, type RowLayout, rollRows, rowIndexAt } from './rollRows';
import {
  type RowView,
  type TimeBounds,
  clampTime,
  fitView,
  fitsOf,
  fracAt,
  leastThumb,
  loopFitPx,
  regionFitPx,
  settleFit,
  shownTicks,
  spanRows,
  spanTime,
  thumbOf,
  zoomRowsAbout,
  zoomTimeAbout,
} from './rollZoomModel';

const BEAT = 24;
const BAR = 4 * BEAT;

/** A `loop`-bar loop in a `region`-bar region, on a pane `widthPx` wide. */
const bounds = (loop: number, region: number, widthPx: number): TimeBounds => ({
  loopTicks: loop * BAR,
  regionTicks: region * BAR,
  widthPx,
});

describe('the fits, the floor and the ceiling', () => {
  it('Region lays the whole region across the width less its inset, with no fixed floor', () => {
    expect(regionFitPx(bounds(2, 50, 602))).toBe(3);
    // 256 bars in a narrow pane: well under half a px per beat, the whole region still shown.
    expect(regionFitPx(bounds(1, 256, 402))).toBeCloseTo(400 / 1024);
  });

  it('Loop lays the loop across the width less its handle’s inset', () => {
    expect(loopFitPx(bounds(2, 50, 814))).toBe(100);
    expect(fitView('loop', bounds(2, 50, 814))).toEqual({ beatPx: 100, left: 0 });
  });

  it('a half-bar loop on a wide pane stops at 240 px per beat', () => {
    expect(loopFitPx(bounds(0.5, 50, 1000))).toBe(240);
  });

  it('a loop as long as the region fits as the region does', () => {
    const b = bounds(4, 4, 802);
    expect(loopFitPx(b)).toBe(regionFitPx(b));
  });

  it('a 1-bar region on a wide pane is held at the ceiling', () => {
    const b = bounds(0.5, 1, 1202);
    expect(regionFitPx(b)).toBe(240);
    expect(loopFitPx(b)).toBe(240);
  });

  it('clamps a view between the floor and the ceiling, its left edge within the region', () => {
    const b = bounds(2, 50, 602);
    expect(clampTime({ beatPx: 1000, left: -5 }, b)).toEqual({ beatPx: 240, left: 0 });
    expect(clampTime({ beatPx: 0.1, left: 300 }, b)).toEqual({ beatPx: 3, left: 0 });
    const end = 50 * BAR - shownTicks(602, 240);
    expect(clampTime({ beatPx: 240, left: 1e9 }, b).left).toBeCloseTo(end);
  });
});

describe('zooming about a point', () => {
  it('keeps the tick under the point where it is', () => {
    const b = bounds(2, 50, 800);
    const view = { beatPx: 20, left: 4 * BAR };
    const next = zoomTimeAbout(view, b, { factor: 2, x: 200 });
    expect(next.beatPx).toBe(40);
    const under = (v: typeof view): number => v.left + (200 * BEAT) / v.beatPx;
    expect(under(next)).toBeCloseTo(under(view));
  });

  it('stops at the floor and the ceiling', () => {
    const b = bounds(2, 50, 802);
    expect(zoomTimeAbout({ beatPx: 200, left: 0 }, b, { factor: 4, x: 0 }).beatPx).toBe(240);
    expect(zoomTimeAbout({ beatPx: 5, left: 0 }, b, { factor: 0.1, x: 0 })).toEqual({
      beatPx: 4,
      left: 0,
    });
  });
});

describe('moving one edge with the other held', () => {
  const b = bounds(2, 50, 800);

  it('the end, with the start held', () => {
    expect(spanTime(b, { start: 0, end: 4 * BAR, hold: 'start' })).toEqual({ beatPx: 50, left: 0 });
    expect(spanTime(b, { start: 8 * BAR, end: 10 * BAR, hold: 'start' })).toEqual({
      beatPx: 100,
      left: 8 * BAR,
    });
  });

  it('the start, with the end held', () => {
    const view = spanTime(b, { start: 2 * BAR, end: 6 * BAR, hold: 'end' });
    expect(view).toEqual({ beatPx: 50, left: 2 * BAR });
    expect(view.left + shownTicks(800, view.beatPx)).toBe(6 * BAR);
  });

  it('stops at the ceiling with the held edge where it was', () => {
    const start = spanTime(b, { start: 10 * BAR, end: 10 * BAR + 1, hold: 'start' });
    expect(start).toEqual({ beatPx: 240, left: 10 * BAR });
    const end = spanTime(b, { start: 10 * BAR - 1, end: 10 * BAR, hold: 'end' });
    expect(end.beatPx).toBe(240);
    expect(end.left + shownTicks(800, 240)).toBeCloseTo(10 * BAR);
  });

  it('stops at the floor, the whole region from bar 1', () => {
    expect(spanTime(b, { start: 20 * BAR, end: 90 * BAR, hold: 'start' })).toEqual({
      beatPx: regionFitPx(b),
      left: 0,
    });
  });
});

describe('which fit a view sits on', () => {
  const b = bounds(2, 50, 814);

  it('reads Loop and Region from the view itself', () => {
    expect(fitsOf(fitView('loop', b), b)).toEqual({ loop: true, region: false });
    expect(fitsOf(fitView('region', b), b)).toEqual({ loop: false, region: true });
    expect(fitsOf({ beatPx: 100, left: BAR }, b)).toEqual({ loop: false, region: false });
  });

  it('a zoom-out clamped at the floor leaves Region on', () => {
    const out = zoomTimeAbout(fitView('region', b), b, { factor: 0.5, x: 300 });
    expect(settleFit('region', out, b)).toBe('region');
  });

  it('a zoom that lands exactly on the loop’s fit is on Loop', () => {
    const at = spanTime(b, { start: 0, end: 2 * BAR + (14 * BEAT) / 100, hold: 'start' });
    expect(at.beatPx).toBeCloseTo(100);
    expect(settleFit(null, at, b)).toBe('loop');
  });

  it('a scroll off the loop leaves it', () => {
    expect(settleFit('loop', { beatPx: 100, left: BAR }, b)).toBeNull();
  });

  it('a loop as long as the region sits on both, and keeps the one it had', () => {
    const same = bounds(4, 4, 802);
    expect(fitsOf(fitView('region', same), same)).toEqual({ loop: true, region: true });
    expect(settleFit('region', fitView('region', same), same)).toBe('region');
    expect(settleFit(null, fitView('region', same), same)).toBe('loop');
  });
});

describe('the rows', () => {
  /** A minor's pitch classes: A B C D E F G. */
  const A_MINOR = new Set([9, 11, 0, 2, 4, 5, 7]);
  /** The rows in a pane 160 px tall: 12's 73 rows at 8 px unless `over` says otherwise. */
  const layout = (over: Partial<RowInput>): RowLayout =>
    rollRows({
      keys: '12',
      fold: false,
      rowPx: 8,
      used: new Set(),
      scalePcs: A_MINOR,
      panePx: 160,
      ...over,
    });
  const twelve = { rows: layout({}), heightPx: 160 };
  /** The pitch at the top edge of `view` (laid out as the next paint lays it out), and how far down its row. */
  const topRow = (input: Partial<RowInput>, view: RowView) => {
    const { rows } = layout({ ...input, rowPx: view.rowPx });
    const row = rows[rowIndexAt(rows, view.top)] as RollRow;
    return { pitch: row.pitch, share: (view.top - row.top) / row.h };
  };

  it('clamp to 4 to 24 px, the top within the rows', () => {
    const view = { rowPx: 8, top: 0 };
    expect(zoomRowsAbout(view, twelve, { rowPx: 30, y: 0, to: 3 })).toEqual({ rowPx: 24, top: 0 });
    const low = zoomRowsAbout(view, twelve, { rowPx: 2, y: 0, to: -1e6 });
    expect(low).toEqual({ rowPx: 4, top: 73 * 4 - 160 });
  });

  it('zoom about a row, keeping it where it is', () => {
    const next = zoomRowsAbout({ rowPx: 8, top: 200 }, twelve, { rowPx: 12, y: 80 });
    expect(next.rowPx).toBe(12);
    expect((next.top + 80) / 12).toBeCloseTo((200 + 80) / 8);
  });

  it('move the bottom edge with the top held, and the top with the bottom held', () => {
    const view = { rowPx: 8, top: 0 };
    // 20 rows of 73 shown → 8 px rows; 10 rows → 16 px.
    const bottom = spanRows(view, twelve, { start: 0.5, end: 0.5 + 10 / 73, hold: 'start' });
    expect(bottom.rowPx).toBeCloseTo(16);
    expect(bottom.top).toBeCloseTo(0.5 * 73 * 16);
    const top = spanRows(view, twelve, { start: 0.5, end: 0.5 + 10 / 73, hold: 'end' });
    expect(top.top + 160).toBeCloseTo((0.5 + 10 / 73) * 73 * 16);
  });

  it('stop at 4 and 24 px', () => {
    const view = { rowPx: 8, top: 0 };
    expect(spanRows(view, twelve, { start: 0, end: 1, hold: 'start' }).rowPx).toBe(4);
    expect(spanRows(view, twelve, { start: 0, end: 0.01, hold: 'start' }).rowPx).toBe(24);
  });

  it('under Keys: Scale, leave thin slivers their height and hold the edge’s pitch', () => {
    // Bb3, C#4 and F#4 lie outside A minor and hold notes: three 3 px slivers.
    const scale = { keys: 'scale' as const, used: new Set([57, 58, 61, 66]) };
    const drawn = { rows: layout(scale), heightPx: 160 };
    const thin = drawn.rows.rows.filter((row) => row.thin);
    expect(thin).toHaveLength(3);
    const view = { rowPx: 8, top: 0 };
    const all = spanRows(view, drawn, { start: 0, end: 1, hold: 'start' });
    const scaled = drawn.rows.rows.length - thin.length;
    expect(all.rowPx).toBeCloseTo(Math.max(4, (160 - 3 * 3) / scaled));
    // The bottom edge from 60% to 80% of the rows, the top held at 60%, past the slivers.
    const held = { rowPx: 8, top: 0.6 * drawn.rows.height };
    const span = spanRows(view, drawn, { start: 0.6, end: 0.8, hold: 'start' });
    expect(span.rowPx).not.toBeCloseTo(8);
    const before = topRow(scale, held);
    const after = topRow(scale, span);
    expect(after.pitch).toBe(before.pitch);
    expect(after.share).toBeCloseTo(before.share);
  });

  it('under Fold, zoom rows the pane’s fill holds taller than the zoom', () => {
    // 20 rows fill 160 px at 8 px each over the zoom's 7; 10 rows to the pane → 16 px.
    const fold = {
      fold: true,
      rowPx: 7,
      used: new Set(Array.from({ length: 20 }, (_, i) => 50 + i)),
    };
    const drawn = { rows: layout(fold), heightPx: 160 };
    const view = { rowPx: 7, top: 0 };
    const span = spanRows(view, drawn, { start: 0.25, end: 0.75, hold: 'start' });
    expect(span).toEqual({ rowPx: 16, top: 5 * 16 });
  });

  it('a grip moved several times before the repaint lands where one move to the last pointer lands', () => {
    const scale = { keys: 'scale' as const, used: new Set([61]) };
    const drawn = { rows: layout(scale), heightPx: 160 };
    const view = { rowPx: 8, top: 0 };
    // Each move writes the zoom; the rows drawn stay the ones laid out at 8 px.
    let zoom = view;
    for (const end of [0.62, 0.68, 0.75]) {
      zoom = spanRows(view, drawn, { start: 0.4, end, hold: 'start' });
    }
    expect(zoom).toEqual(spanRows(view, drawn, { start: 0.4, end: 0.75, hold: 'start' }));
    expect(zoom.rowPx).not.toBe(8);
  });
});

describe('the zoom bars’ thumbs', () => {
  it('fill the track when the whole is shown, and are never under the least nor over half the track for it', () => {
    expect(thumbOf({ start: 0, end: 1 }, 600, 84)).toEqual({ start: 0, length: 600 });
    expect(thumbOf({ start: 0.5, end: 0.5 }, 600, 84).length).toBe(84);
    expect(leastThumb(120, 84)).toBe(60);
    expect(thumbOf({ start: 1, end: 1 }, 600, 84)).toEqual({ start: 516, length: 84 });
  });

  it('a grip follows the pointer at the least length: a 50-bar region at 240 px per beat', () => {
    const track = 1000;
    const b = bounds(0.5, 50, track);
    const shown = shownTicks(track, 240) / b.regionTicks;
    const share = { start: 0.3, end: 0.3 + shown };
    const before = thumbOf(share, track, 84);
    expect(before.length).toBeLessThan(84 + 0.05 * track);
    // The end grip dragged 70 px out: the thumb's end moves 70 px, its start stays.
    const moved = { start: share.start, end: share.end + fracAt(70, track, 84) };
    const after = thumbOf(moved, track, 84);
    expect(after.start).toBeCloseTo(before.start);
    expect(after.start + after.length).toBeCloseTo(before.start + before.length + 70);
    // The start grip dragged 70 px in: the start moves 70 px, the end stays.
    const wide = { start: 0.3, end: 0.5 };
    const narrow = thumbOf({ start: 0.3 + fracAt(70, track, 84), end: 0.5 }, track, 84);
    const was = thumbOf(wide, track, 84);
    expect(narrow.start).toBeCloseTo(was.start + 70);
    expect(narrow.start + narrow.length).toBeCloseTo(was.start + was.length);
  });

  it('the middle scrolls by the thumb’s own travel, so it stays under the pointer to both ends', () => {
    const track = 600;
    const shown = 0.01;
    const at = (start: number): number => thumbOf({ start, end: start + shown }, track, 84).start;
    expect(at(fracAt(100, track, 84))).toBeCloseTo(at(0) + 100);
    // Dragged from the start across the track the thumb doesn't fill, the view ends at the end.
    const thumb = thumbOf({ start: 0, end: shown }, track, 84);
    expect(fracAt(track - thumb.length, track, 84) + shown).toBeCloseTo(1);
  });
});
