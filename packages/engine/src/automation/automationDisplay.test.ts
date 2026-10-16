import { describe, expect, it } from 'vitest';
import { DISPLAY_ROW, fromDisplay, toDisplay } from './automationDisplay';
import { valueAt } from './automationEvaluate';
import type { AutomationTargetRow } from './automationLane';
import { AUTOMATION_LEVEL_FLOOR_DB, FEEDBACK_KNEE } from './automationTargetTables';
import { requireCatalogRow, voiceTargetId } from './automationTargets';

const LEVEL = requireCatalogRow('strip.level');
const CUTOFF = requireCatalogRow(voiceTargetId('filter.cutoff'));
const DECAY = requireCatalogRow(voiceTargetId('ops.0.env.decayTime'));
const PAN = requireCatalogRow('strip.pan');
const RES = requireCatalogRow(voiceTargetId('filter.resonance'));
const FEEDBACK = requireCatalogRow(voiceTargetId('ops.3.feedback'));

const ROWS: readonly AutomationTargetRow[] = [
  LEVEL,
  CUTOFF,
  DECAY,
  PAN,
  RES,
  FEEDBACK,
  DISPLAY_ROW,
];
const HEIGHTS = Array.from({ length: 41 }, (_, i) => i / 40);
const dbOf = (gain: number): number => 20 * Math.log10(gain);

describe('toDisplay and fromDisplay', () => {
  it('round-trip every height on each scale', () => {
    for (const row of ROWS) {
      for (const y of HEIGHTS)
        expect(toDisplay(row, fromDisplay(row, y)), `${row.target} ${y}`).toBeCloseTo(y, 12);
    }
  });

  it('maps the ends of each row exactly', () => {
    for (const row of ROWS) {
      expect(fromDisplay(row, 0)).toBe(row.min);
      expect(fromDisplay(row, 1)).toBe(row.max);
      expect(toDisplay(row, row.max)).toBe(1);
      expect(toDisplay(row, row.min)).toBe(0);
    }
  });

  it('is the identity on the display row', () => {
    for (const y of HEIGHTS) {
      expect(toDisplay(DISPLAY_ROW, y)).toBe(y);
      expect(fromDisplay(DISPLAY_ROW, y)).toBe(y);
    }
  });

  it('draws the level in dB from the floor, and below the floor at 0', () => {
    const maxDb = dbOf(LEVEL.max);
    expect(toDisplay(LEVEL, 1)).toBeCloseTo(
      -AUTOMATION_LEVEL_FLOOR_DB / (maxDb - AUTOMATION_LEVEL_FLOOR_DB),
      12,
    );
    expect(dbOf(fromDisplay(LEVEL, 0.5))).toBeCloseTo((AUTOMATION_LEVEL_FLOOR_DB + maxDb) / 2, 9);
    expect(toDisplay(LEVEL, 10 ** ((AUTOMATION_LEVEL_FLOOR_DB - 6) / 20))).toBe(0);
    expect(toDisplay(LEVEL, 0)).toBe(0);
  });

  it('draws the cutoff in octaves: each octave is the same height', () => {
    const octave = toDisplay(CUTOFF, 200) - toDisplay(CUTOFF, 100);
    expect(toDisplay(CUTOFF, 4000) - toDisplay(CUTOFF, 2000)).toBeCloseTo(octave, 12);
    expect(octave).toBeCloseTo(1 / Math.log2(CUTOFF.max / CUTOFF.min), 12);
  });

  it('draws a decay time on a log sweep from its floor, 0 below it', () => {
    expect(DECAY.min).toBe(0);
    expect(toDisplay(DECAY, DECAY.floor!)).toBe(0);
    expect(toDisplay(DECAY, 0)).toBe(0);
    expect(toDisplay(DECAY, 0.0005)).toBe(0);
    expect(toDisplay(DECAY, 0.002)).toBeGreaterThan(0);
  });

  it('clamps values outside the row', () => {
    expect(toDisplay(PAN, -3)).toBe(0);
    expect(toDisplay(PAN, 3)).toBe(1);
    expect(toDisplay(CUTOFF, 1e6)).toBe(1);
    expect(fromDisplay(PAN, -0.5)).toBe(-1);
    expect(fromDisplay(PAN, 1.5)).toBe(1);
  });
});

describe('the feedback knee (windsor#842)', () => {
  it('is a knee row over −1..10 with its bend from the table: 60 % of the height, at 1', () => {
    expect(FEEDBACK).toMatchObject({ min: -1, max: 10, scale: 'knee', knee: FEEDBACK_KNEE });
    expect(FEEDBACK_KNEE).toEqual({ at: 0.6, value: 1 });
  });

  it('puts 0 at 30 %, 1 at 60 % and 10 at the top, each exactly, both ways', () => {
    for (const [value, y] of [
      [-1, 0],
      [0, 0.3],
      [1, 0.6],
      [10, 1],
    ] as const) {
      expect(toDisplay(FEEDBACK, value), `${value}`).toBe(y);
      expect(fromDisplay(FEEDBACK, y), `${y}`).toBe(value);
    }
  });

  it('is linear below the knee and geometric above it', () => {
    expect(toDisplay(FEEDBACK, 0.5)).toBeCloseTo(0.45, 12);
    expect(toDisplay(FEEDBACK, Math.sqrt(10))).toBeCloseTo(0.8, 12);
    expect(fromDisplay(FEEDBACK, 0.8)).toBeCloseTo(Math.sqrt(10), 12);
    expect(toDisplay(FEEDBACK, 12)).toBe(1);
    expect(toDisplay(FEEDBACK, -3)).toBe(0);
  });

  it('round-trips the values either side of the knee', () => {
    for (const v of [-0.75, -0.0001, 0.0001, 0.9999, 1.0001, 2.5, 7.07, 9.9999]) {
      const back = fromDisplay(FEEDBACK, toDisplay(FEEDBACK, v));
      expect(Math.abs(back - v), `${v}`).toBeLessThan(1e-12 * Math.max(1, Math.abs(v)));
    }
  });

  it('plays a straight lane segment along the knee, as it is drawn', () => {
    const points = [
      { tick: 0, value: 1, bend: 0 },
      { tick: 96, value: 10, bend: 0 },
    ];
    expect(valueAt(FEEDBACK, points, 48)).toBeCloseTo(Math.sqrt(10), 12);
  });

  it('draws a knee row that names no knee straight', () => {
    const { target, min, max } = FEEDBACK;
    const straight: AutomationTargetRow = { target, label: '', min, max, scale: 'knee', unit: '' };
    expect(toDisplay(straight, 4.5)).toBe(0.5);
    expect(fromDisplay(straight, 0.5)).toBe(4.5);
  });
});
