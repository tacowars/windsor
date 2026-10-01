/**
 * The Song view's px maths and per-kind lookups (#709 decision 1): a tick's
 * px at the table's scale, the ruler's labels, and one tone, summary and
 * cycle length per kind the engine declares.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
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
import { snapTick, splitRegion } from './regionModel';
import {
  CYCLE_TICKS,
  LANE_TONE,
  REGION_SUMMARY,
  MIN_BLOCK_PX,
  NARROW_BLOCK_PX,
  REGION_EDGE_PX,
  SONG_VIEW,
  beatTickPx,
  blockBox,
  blockHitAt,
  boxTick,
  edgeBandPx,
  forKind,
  hitBlocks,
  isNarrowBlock,
  mixerColumnPx,
  pxToTick,
  rulerLabelEvery,
  rulerLabels,
  tickToPx,
  timelineLeftCss,
} from './songViewTables';
import { knobGeometry } from './knob';

describe('the ruler scale', () => {
  it('puts the playhead at 0, 96 and 216 px for ticks 0, 96 and 216 at 96 px per bar', () => {
    const PX = 96;
    expect(tickToPx(0, PX)).toBe(0);
    expect(tickToPx(TICKS_PER_BAR, PX)).toBe(PX);
    expect(tickToPx(2.25 * TICKS_PER_BAR, PX)).toBe(2.25 * PX);
    expect(pxToTick(tickToPx(TICKS_PER_BAR + PPQ, PX), PX)).toBe(TICKS_PER_BAR + PPQ);
  });

  it('labels the bars 1..n and ticks the beats inside a bar', () => {
    expect(rulerLabels(4)).toEqual(['1', '2', '3', '4']);
    expect(rulerLabels(0)).toEqual([]);
    expect(beatTickPx(SONG_VIEW.pxPerBar)).toEqual(
      [1, 2, 3].map((b) => tickToPx(b * PPQ, SONG_VIEW.pxPerBar)),
    );
  });

  it('keeps a tick and its px paired at every zoom', () => {
    for (const px of [SONG_VIEW.minPxPerBar, SONG_VIEW.pxPerBar, SONG_VIEW.maxPxPerBar]) {
      expect(tickToPx(TICKS_PER_BAR, px)).toBe(px);
      expect(pxToTick(tickToPx(TICKS_PER_BAR + PPQ, px), px)).toBeCloseTo(TICKS_PER_BAR + PPQ);
    }
  });

  it('thins the bar labels by powers of two as the zoom narrows the bars', () => {
    expect(rulerLabelEvery(SONG_VIEW.pxPerBar)).toBe(1);
    expect(rulerLabelEvery(SONG_VIEW.maxPxPerBar)).toBe(1);
    const every = rulerLabelEvery(SONG_VIEW.minPxPerBar);
    expect(every * SONG_VIEW.minPxPerBar).toBeGreaterThanOrEqual(SONG_VIEW.minLabelPx);
    expect((every / 2) * SONG_VIEW.minPxPerBar).toBeLessThan(SONG_VIEW.minLabelPx);
    expect(rulerLabelEvery(0)).toBe(1);
  });
});

describe('a block at the widest zoom-out (minPxPerBar)', () => {
  const MIN = SONG_VIEW.minPxPerBar;

  it('keeps a one-beat event visible and hittable', () => {
    const beat = blockBox(3 * TICKS_PER_BAR, PPQ, MIN);
    expect(beat.widthPx).toBe(MIN_BLOCK_PX);
    expect(beat.leftPx).toBe(3 * MIN);
    expect(blockHitAt(beat, beat.leftPx + beat.widthPx / 2)).toBe('body');
    expect(blockHitAt(beat, beat.leftPx)).toBe('start');
    expect(blockHitAt(beat, beat.leftPx + beat.widthPx)).toBe('end');
  });

  it('gives a one-bar region a movable centre between its two edge bands', () => {
    const bar = blockBox(TICKS_PER_BAR, TICKS_PER_BAR, MIN);
    const { leftPx, widthPx } = bar;
    expect(edgeBandPx(widthPx)).toBeLessThan(widthPx / 2);
    expect(blockHitAt(bar, leftPx)).toBe('start');
    expect(blockHitAt(bar, leftPx + widthPx / 2)).toBe('body');
    expect(blockHitAt(bar, leftPx + widthPx)).toBe('end');
    expect(blockHitAt(bar, leftPx - 1)).toBeNull();
    expect(blockHitAt(bar, leftPx + widthPx + 1)).toBeNull();
  });

  it('picks the block drawn on top where a widened block overlaps the next', () => {
    const boxes = [blockBox(0, PPQ, MIN), blockBox(PPQ, PPQ, MIN)];
    const second = boxes[1];
    expect(second).toBeDefined();
    expect(hitBlocks(boxes, (second?.leftPx ?? 0) + 1)?.index).toBe(1);
    expect(hitBlocks(boxes, 0.5)?.index).toBe(0);
    expect(hitBlocks(boxes, 100)).toBeNull();
  });

  it('hits a one-beat region and a one-beat harmony block at their drawn right edge, for resize', () => {
    // Both lanes draw through blockBox; a narrow block drops its padding, so it is drawn exactly this wide.
    const region = blockBox(2 * TICKS_PER_BAR, PPQ, MIN);
    const chord = blockBox(5 * TICKS_PER_BAR + PPQ, PPQ, MIN);
    for (const box of [region, chord]) {
      expect(isNarrowBlock(box.widthPx)).toBe(true);
      const right = box.leftPx + box.widthPx;
      expect(blockHitAt(box, right)).toBe('end');
      expect(blockHitAt(box, right - 0.5)).toBe('end');
      expect(hitBlocks([box], right)).toEqual({ index: 0, hit: 'end' });
    }
  });

  it('draws a narrow block without the padding the CSS gives a full one', () => {
    const css = readFileSync(new URL('./console.css', import.meta.url), 'utf8');
    const rule = (selector: string): string =>
      new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const values = (body: string, prop: string): string[] =>
      (new RegExp(`\\n\\s*${prop}: ([^;]*);`).exec(body)?.[1] ?? '').split(/\s+/);
    for (const block of ['.reg', '.hblk']) {
      const full = rule(block);
      // `padding: <vertical> <horizontal>`, `border: <width> solid <colour>`.
      const padding = parseFloat(values(full, 'padding')[1] ?? '');
      const border = parseFloat(values(full, 'border')[0] ?? '');
      expect(2 * padding + 2 * border, block).toBe(NARROW_BLOCK_PX);
      expect(rule(`${block}.narrow`), block).toMatch(/padding: 0;/);
    }
    expect(MIN_BLOCK_PX).toBeLessThan(NARROW_BLOCK_PX);
    expect(isNarrowBlock(blockBox(0, TICKS_PER_BAR, SONG_VIEW.pxPerBar).widthPx)).toBe(false);
  });

  it('keeps the full edge band on a wide block at the default zoom', () => {
    const bar = blockBox(0, TICKS_PER_BAR, SONG_VIEW.pxPerBar);
    expect(edgeBandPx(bar.widthPx)).toBe(REGION_EDGE_PX);
    expect(blockHitAt(bar, REGION_EDGE_PX - 1)).toBe('start');
    expect(blockHitAt(bar, REGION_EDGE_PX + 1)).toBe('body');
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

describe('the tick under a drawn block (windsor#21)', () => {
  const MIN = SONG_VIEW.minPxPerBar;

  it('is the plain conversion on a block no wider than its span', () => {
    const px = SONG_VIEW.pxPerBar;
    const span = { startTick: TICKS_PER_BAR, durationTicks: 2 * TICKS_PER_BAR };
    const box = blockBox(span.startTick, span.durationTicks, px);
    for (const at of [box.leftPx, box.leftPx + 30, box.leftPx + box.widthPx]) {
      expect(boxTick(box, at, span, px)).toBeCloseTo(pxToTick(at, px));
    }
  });

  it('keeps every px of a widened block inside its own span', () => {
    const span = { startTick: 3 * TICKS_PER_BAR, durationTicks: PPQ };
    const box = blockBox(span.startTick, span.durationTicks, MIN);
    expect(box.widthPx).toBeGreaterThan(tickToPx(PPQ, MIN));
    expect(boxTick(box, box.leftPx, span, MIN)).toBe(span.startTick);
    expect(boxTick(box, box.leftPx + box.widthPx / 2, span, MIN)).toBe(span.startTick + PPQ / 2);
    expect(boxTick(box, box.leftPx + box.widthPx, span, MIN)).toBe(span.startTick + PPQ);
    expect(boxTick(box, box.leftPx + 99, span, MIN)).toBe(span.startTick + PPQ);
  });

  it('lets an alt-click anywhere on a widened region split that region', () => {
    const regions = [
      { start: 0, duration: TICKS_PER_BAR },
      { start: 2 * TICKS_PER_BAR, duration: PPQ },
    ];
    const boxes = regions.map((r) => blockBox(r.start, r.duration, MIN));
    const box = boxes[1];
    const grain = PPQ / 4;
    expect(box).toBeDefined();
    if (!box) return;
    // Off the region's own span (past `tickToPx(PPQ)`) but on its drawn box.
    const px = box.leftPx + box.widthPx * 0.6;
    expect(px - box.leftPx).toBeGreaterThan(tickToPx(PPQ, MIN) * 0.5);
    const found = hitBlocks(boxes, px);
    expect(found?.index).toBe(1);
    const span = { startTick: 2 * TICKS_PER_BAR, durationTicks: PPQ };
    const cut = snapTick(boxTick(box, px, span, MIN), grain);
    const split = splitRegion(regions, 1, cut, grain);
    expect(split).toHaveLength(3);
    expect(split[1]?.start).toBe(2 * TICKS_PER_BAR);
    expect((split[2]?.start ?? 0) + (split[2]?.duration ?? 0)).toBe(2 * TICKS_PER_BAR + PPQ);
  });
});

describe('the mixer column (windsor#157)', () => {
  const css = readFileSync(new URL('./console.css', import.meta.url), 'utf8');
  const rule = (selector: string): string =>
    new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('puts the timeline past the names, the mixer and the gap after each', () => {
    expect(timelineLeftCss(2.5)).toBe(
      'calc(var(--names) + var(--mixer) + 2 * var(--gap) + var(--bar) * 2.5)',
    );
    expect(rule('.lanes')).toMatch(
      /grid-template-columns: var\(--names\) var\(--mixer\) calc\(var\(--bars\) \* var\(--bar\)\);/,
    );
  });

  it('makes the part rows 40 px, leaves the Harmony lane at 40 px, and fits the compact knob', () => {
    const height = (selector: string): number =>
      parseFloat(/\n\s*height: ([^;]*);/.exec(rule(selector))?.[1] ?? '');
    expect(height('.lane')).toBe(40);
    expect(height('.lane.lane-harm')).toBe(40);
    expect(knobGeometry({ compact: true }).size).toBeLessThan(height('.lane'));
  });

  it('widens the column when expanded, by one column a knob (windsor#158)', () => {
    expect(mixerColumnPx(false, 5)).toBe(SONG_VIEW.mixerWidthPx);
    expect(mixerColumnPx(true, 5)).toBe(
      SONG_VIEW.mixerExpandedBasePx + 5 * SONG_VIEW.mixerKnobColumnPx,
    );
    expect(mixerColumnPx(true, 6) - mixerColumnPx(true, 5)).toBe(SONG_VIEW.mixerKnobColumnPx);
    expect(mixerColumnPx(true, 5)).toBeGreaterThan(mixerColumnPx(false, 5));
  });

  it('sizes the expanded base as the CSS grid does: its fixed tracks, the gaps between them and the padding', () => {
    const expanded = rule('.mix-cell.expanded');
    const template = /grid-template-columns: ([^;]*);/.exec(expanded)?.[1] ?? '';
    // The px tracks: the gutter, Output, M, S and the lights; the knobs' are
    // fractions, and each knob column carries its own gap (mixerKnobColumnPx),
    // so the base holds one gap fewer than it has fixed tracks.
    const tracks = [...template.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    const fixed = tracks.reduce((a, b) => a + b, 0);
    const gaps = tracks.length - 1;
    const gap = parseFloat(/column-gap: ([^;]*);/.exec(expanded)?.[1] ?? '');
    const padX = parseFloat(/padding: 0 ([^;]*);/.exec(rule('.mix-cell'))?.[1] ?? '');
    expect(fixed + gaps * gap + 2 * padX).toBe(SONG_VIEW.mixerExpandedBasePx);
  });
});

describe('the automation lanes (windsor#348)', () => {
  it('are one fixed height, 56 px (decision 2)', () => {
    expect(SONG_VIEW.automationLanePx).toBe(56);
  });
});
