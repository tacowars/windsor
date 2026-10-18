/**
 * The Roll's view settings (windsor#602 decision 2): the snap table, the
 * zoom each view opens on and draws at (windsor#902), and the summary.
 */
import { describe, expect, it } from 'vitest';
import { ROLL_SNAPS } from './rollTables';
import { rollSummary, repeatsText } from './rollSummary';
import { beatPxOf, defaultRollView, rollViewOf } from './rollView';

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
  const bounds = { loopTicks: 2 * BAR, regionTicks: 50 * BAR, widthPx: 814 };

  it('opens both views on the loop, the device at 7 px rows and Expanded at 15', () => {
    const { device, wide } = defaultRollView().zoom;
    expect([device.fit, device.rowPx]).toEqual(['loop', 7]);
    expect([wide.fit, wide.rowPx]).toEqual(['loop', 15]);
    expect(beatPxOf(device, bounds)).toBe(100);
  });

  it('draws a fit at its own zoom, and a view off a fit within the floor and the ceiling', () => {
    expect(beatPxOf({ fit: 'region', beatPx: 50, rowPx: 7 }, bounds)).toBeCloseTo(812 / 200);
    expect(beatPxOf({ fit: null, beatPx: 50, rowPx: 7 }, bounds)).toBe(50);
    expect(beatPxOf({ fit: null, beatPx: 500, rowPx: 7 }, bounds)).toBe(240);
    expect(beatPxOf({ fit: null, beatPx: 1, rowPx: 7 }, bounds)).toBeCloseTo(812 / 200);
  });

  it('a view on a fit refits when the width or the loop changes', () => {
    const zoom = defaultRollView().zoom.device;
    expect(beatPxOf(zoom, { ...bounds, widthPx: 414 })).toBe(50);
    expect(beatPxOf(zoom, { ...bounds, loopTicks: 4 * BAR })).toBe(50);
  });

  it('keeps a part’s view for the session', () => {
    const views = new Map();
    rollViewOf(3, views).fold = true;
    expect(rollViewOf(3, views).fold).toBe(true);
    expect(rollViewOf(4, views).fold).toBe(false);
  });

  it('opens on the Vel lane, and keeps a part’s lane for the session (windsor#754)', () => {
    const views = new Map();
    expect(rollViewOf(1, views).lane).toBe('vel');
    rollViewOf(1, views).lane = 'rat';
    rollViewOf(2, views).lane = 'acc';
    expect(rollViewOf(1, views).lane).toBe('rat');
    expect(rollViewOf(2, views).lane).toBe('acc');
    expect(defaultRollView().lane).toBe('vel');
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
