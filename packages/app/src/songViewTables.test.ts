/**
 * The Song view's px maths and per-kind lookups (#709 decision 1): a tick's
 * px at the table's scale, the ruler's labels, and one tone, summary and
 * cycle length per kind the engine declares.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  PPQ,
  SEQUENCER_KINDS,
  TICKS_PER_BAR,
  hitStep,
} from '@windsor/engine';
import {
  CYCLE_TICKS,
  LANE_TONE,
  REGION_SUMMARY,
  SONG_VIEW,
  beatTickPx,
  forKind,
  pxToTick,
  rulerLabels,
  tickToPx,
} from './songViewTables';

describe('the ruler scale', () => {
  it('puts the playhead at 0, 96 and 216 px for ticks 0, 96 and 216 at 96 px per bar', () => {
    const PX = 96;
    expect(tickToPx(0, PX)).toBe(0);
    expect(tickToPx(TICKS_PER_BAR, PX)).toBe(PX);
    expect(tickToPx(2.25 * TICKS_PER_BAR, PX)).toBe(2.25 * PX);
    expect(pxToTick(tickToPx(TICKS_PER_BAR + PPQ))).toBe(TICKS_PER_BAR + PPQ);
  });

  it('labels the bars 1..n and ticks the beats inside a bar', () => {
    expect(rulerLabels(4)).toEqual(['1', '2', '3', '4']);
    expect(rulerLabels(0)).toEqual([]);
    expect(beatTickPx(SONG_VIEW.pxPerBar)).toEqual([1, 2, 3].map((b) => tickToPx(b * PPQ)));
  });
});

describe('the per-kind tables', () => {
  it('cover every kind the engine declares', () => {
    for (const kind of SEQUENCER_KINDS) {
      expect(LANE_TONE[kind], kind).toBeDefined();
      expect(typeof REGION_SUMMARY[kind], kind).toBe('function');
      expect(typeof CYCLE_TICKS[kind], kind).toBe('function');
    }
    expect(LANE_TONE.euclidean).toBe('perc');
    expect(LANE_TONE.grid).toBe('pitch');
  });

  it('gives a grid, a Euclidean line and a Chord Player their pattern cycle, and an arp none', () => {
    const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid' as const, length: 7 };
    expect(forKind(CYCLE_TICKS, grid)).toBe(7 * grid.divisor);
    const euclid = { ...DEFAULT_EUCLIDEAN_CONFIG, kind: 'euclidean' as const, note: 36, hold: 1 };
    expect(forKind(CYCLE_TICKS, euclid)).toBe(euclid.steps * euclid.divisor);
    const chord = { ...DEFAULT_CHORD_CONFIG, kind: 'chord' as const };
    expect(forKind(CYCLE_TICKS, chord)).toBeNull();
    const two = { ...chord, steps: [hitStep({ duration: 2, repeat: 2 }), hitStep()] };
    expect(forKind(CYCLE_TICKS, two)).toBe(5 * chord.divisor);
    expect(forKind(CYCLE_TICKS, { ...DEFAULT_ARP_CONFIG, kind: 'arp' })).toBeNull();
  });

  it('summarises a region from the spec, naming the step count and the rate', () => {
    const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid' as const, length: 7, divisor: 6 };
    expect(forKind(REGION_SUMMARY, grid)).toBe('grid · 7 steps · 1/16');
    expect(
      forKind(REGION_SUMMARY, {
        ...DEFAULT_EUCLIDEAN_CONFIG,
        kind: 'euclidean',
        note: 36,
        hold: 1,
      }),
    ).toMatch(/^euclid \d+\/\d+ · /);
  });
});
