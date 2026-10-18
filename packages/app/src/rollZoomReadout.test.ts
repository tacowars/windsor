/**
 * The zoom's words (windsor#903 decisions 6 and 7): the span shown in bars
 * or beats, the bars shown, the rows in octaves to the nearest half, and the
 * summary led by the bars shown. A fit's room for the brace handle never
 * reads as one more bar.
 */
import { describe, expect, it } from 'vitest';
import { rollRows } from './rollRows';
import { rollSummary, shownBars, slackTicks } from './rollSummary';
import { octaveText, octavesShown, spanText, timeText } from './rollZoomReadout';
import { type TimeBounds, loopFitPx, regionFitPx } from './rollZoomModel';

const BEAT = 24;
const BAR = 4 * BEAT;

/** The bars shown at `beatPx` from tick `left` on a pane `widthPx` wide, in a `regionBars` region. */
function shownAt(view: { beatPx: number; left: number }, widthPx: number, regionBars: number) {
  const pxPerTick = view.beatPx / BEAT;
  const at = { left: view.left, ticks: widthPx / pxPerTick, slack: slackTicks(pxPerTick, BAR) };
  return shownBars(at, BAR, regionBars * BAR);
}

describe('the span', () => {
  it('reads in bars from one bar, to a tenth under ten and whole from ten', () => {
    expect(spanText(2 * BAR, BAR)).toBe('2 bars');
    expect(spanText(BAR, BAR)).toBe('1 bar');
    expect(spanText(1.5 * BAR, BAR)).toBe('1.5 bars');
    expect(spanText(12.3 * BAR, BAR)).toBe('12 bars');
    expect(spanText(9.96 * BAR, BAR)).toBe('10 bars');
  });

  it('reads in beats under a bar', () => {
    expect(spanText(2 * BEAT, BAR)).toBe('2 beats');
    expect(spanText(BEAT, BAR)).toBe('1 beat');
    expect(spanText(1.5 * BEAT, BAR)).toBe('1.5 beats');
  });

  it('names the bars shown after the span', () => {
    expect(timeText('2 bars', { first: 1, last: 2 })).toBe('2 bars · bars 1–2');
    expect(timeText('3 beats', { first: 4, last: 4 })).toBe('3 beats · bar 4');
  });
});

describe('the bars shown', () => {
  it('a 2-bar loop on its fit shows bars 1–2, its handle’s room not counted', () => {
    for (const widthPx of [200, 300, 1000]) {
      const bounds: TimeBounds = { widthPx, loopTicks: 2 * BAR, regionTicks: 50 * BAR };
      expect(shownAt({ beatPx: loopFitPx(bounds), left: 0 }, widthPx, 50)).toEqual({
        first: 1,
        last: 2,
      });
    }
  });

  it('the region on its fit shows every bar', () => {
    const bounds: TimeBounds = { widthPx: 602, loopTicks: 2 * BAR, regionTicks: 50 * BAR };
    expect(shownAt({ beatPx: regionFitPx(bounds), left: 0 }, 602, 50)).toEqual({
      first: 1,
      last: 50,
    });
  });

  it('a view scrolled to bar 3 two bars wide shows bars 3–4; under a bar, one bar', () => {
    expect(shownAt({ beatPx: 100, left: 2 * BAR }, 800, 50)).toEqual({ first: 3, last: 4 });
    expect(shownAt({ beatPx: 240, left: 0 }, 400, 50)).toEqual({ first: 1, last: 1 });
  });

  it('lead the summary', () => {
    const input = { loopTicks: 2 * BAR, regionTicks: 50 * BAR, barTicks: BAR, notes: 3 };
    const words = { key: 'C minor', snap: '1/16' };
    expect(rollSummary({ ...input, ...words, shown: { first: 1, last: 2 } })).toBe(
      'bars 1–2 of 50 · 2-bar loop in a 50-bar region · 3 notes · C minor · snap 1/16',
    );
    expect(rollSummary({ ...input, ...words, shown: { first: 1, last: 1 } })).toMatch(
      /^bar 1 of 50 · /,
    );
  });
});

describe('the rows', () => {
  it('read in octaves to the nearest half', () => {
    expect(octaveText(2)).toBe('2 oct');
    expect(octaveText(1.5)).toBe('1½ oct');
    expect(octaveText(1.3)).toBe('1½ oct');
    expect(octaveText(1.2)).toBe('1 oct');
    expect(octaveText(0.5)).toBe('½ oct');
    expect(octaveText(0.1)).toBe('0 oct');
  });

  it('count the pitches from the row at the top edge to the row at the bottom edge', () => {
    const input = { keys: '12' as const, fold: false, used: new Set<number>() };
    const layout = rollRows({ ...input, rowPx: 7, scalePcs: new Set(), panePx: 168 });
    expect(octavesShown(layout.rows, { top: 0, heightPx: 168 })).toBe(2);
    expect(octaveText(octavesShown(layout.rows, { top: 70, heightPx: 126 }))).toBe('1½ oct');
  });
});
