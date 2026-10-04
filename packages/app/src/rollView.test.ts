/**
 * The Roll's view settings (windsor#602 decision 2): the snap table, Fit,
 * the ↔ zoom leaving and restoring it, the ↕ zoom, and the summary.
 */
import { describe, expect, it } from 'vitest';
import { ROLL_SNAPS } from './rollTables';
import { rollSummary, repeatsText } from './rollSummary';
import {
  beatPxOf,
  defaultRollView,
  fitBeatPx,
  fitTime,
  rollViewOf,
  rowZoomText,
  timeZoomText,
  zoomRows,
  zoomTime,
} from './rollView';

const BAR = 96;

describe('the snap table', () => {
  it('is 1/4 to 1/32, the triplets and Off, in ticks on the 24 PPQ grid', () => {
    expect(ROLL_SNAPS.map((s) => [s.label, s.ticks])).toEqual([
      ['1/4', 24],
      ['1/8', 12],
      ['1/8T', 8],
      ['1/16', 6],
      ['1/16T', 4],
      ['1/32', 3],
      ['Off', 1],
    ]);
    expect(ROLL_SNAPS[defaultRollView().snap]?.label).toBe('1/16');
  });
});

describe('the zooms', () => {
  it('Fit lays the region across the width, never under the floor', () => {
    expect(fitBeatPx(642, 8 * BAR)).toBe(20);
    expect(fitBeatPx(50, 64 * BAR)).toBe(6);
  });

  it('− and + leave Fit from its width, Fit restores it', () => {
    const fit = 20;
    const zoom = defaultRollView().zoom.device;
    expect(timeZoomText(zoom, beatPxOf(zoom, fit), BAR)).toBe('fit');
    const wider = zoomTime(zoom, fit, 1);
    expect(wider.beatPx).toBeCloseTo(28);
    expect(timeZoomText(wider, beatPxOf(wider, fit), BAR)).toBe('112 px/bar');
    expect(zoomTime(wider, fit, -1).beatPx).toBeCloseTo(20);
    expect(fitTime(wider).beatPx).toBeNull();
    expect(zoomTime({ beatPx: 119, row: 0 }, fit, 1).beatPx).toBe(120);
  });

  it('steps the rows through 5 to 19 px, and the two views keep their own', () => {
    const view = defaultRollView();
    expect(rowZoomText(view.zoom.device)).toBe('7 px/row');
    expect(rowZoomText(view.zoom.wide)).toBe('15 px/row');
    expect(rowZoomText(zoomRows(view.zoom.wide, 5))).toBe('19 px/row');
    expect(rowZoomText(zoomRows(view.zoom.device, -5))).toBe('5 px/row');
  });

  it('keeps a part’s view for the session', () => {
    const views = new Map();
    rollViewOf(3, views).fold = true;
    expect(rollViewOf(3, views).fold).toBe(true);
    expect(rollViewOf(4, views).fold).toBe(false);
  });
});

describe('the summary', () => {
  it('reads as the mockup’s', () => {
    const text = rollSummary({
      loopTicks: 4 * BAR,
      regionTicks: 8 * BAR,
      barTicks: BAR,
      notes: 41,
      key: 'A minor',
      snap: '1/16',
    });
    expect(text).toBe('4-bar loop in an 8-bar region · 41 notes · A minor · snap 1/16');
    expect(
      rollSummary({
        loopTicks: BAR,
        regionTicks: BAR,
        barTicks: BAR,
        notes: 1,
        key: 'C major',
        snap: 'Off',
      }),
    ).toBe('1-bar loop in a 1-bar region · 1 note · C major · snap Off');
  });

  it('counts the repeats past the loop', () => {
    expect(repeatsText(4 * BAR, 8 * BAR)).toBe('repeats ×2');
    expect(repeatsText(3 * BAR, 8 * BAR)).toBe('repeats ×2.7');
    expect(repeatsText(8 * BAR, 8 * BAR)).toBeNull();
  });
});
