import { describe, expect, it } from 'vitest';
import { DISPLAY_ROW, fromDisplay, toDisplay } from './automationDisplay';
import type { AutomationTargetRow } from './automationLane';
import { AUTOMATION_LEVEL_FLOOR_DB } from './automationTargetTables';
import { requireCatalogRow, voiceTargetId } from './automationTargets';

const LEVEL = requireCatalogRow('strip.level');
const CUTOFF = requireCatalogRow(voiceTargetId('filter.cutoff'));
const DECAY = requireCatalogRow(voiceTargetId('ops.0.env.decayTime'));
const PAN = requireCatalogRow('strip.pan');
const RES = requireCatalogRow(voiceTargetId('filter.resonance'));

const ROWS: readonly AutomationTargetRow[] = [LEVEL, CUTOFF, DECAY, PAN, RES, DISPLAY_ROW];
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
