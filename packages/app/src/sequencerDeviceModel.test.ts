/**
 * The sequencer device's rail (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decision 2): the region as `n/m`,
 * Split's two-bar floor, and the fold kept per part for the session. The
 * device's height and its step rows' height are the table's.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, MusicPart, SequencerKind } from '@windsor/engine';
import { DIVISORS, TICKS_PER_BAR, partAt, regionPattern } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { regionPatternChange, sequencerKindChange } from './partEdits';
import {
  DeviceFolds,
  canSplitRegion,
  regionBadge,
  removeRegionAt,
  splitRegionAtMiddle,
} from './sequencerDeviceModel';
import { newSong } from './songParts';
import {
  GRID_HEAD_ROWS_PX,
  SEQUENCER_DEVICE_PX,
  STRIP_ROW_GAP_PX,
  stripHeadPx,
} from './sequencerDeviceTables';

describe('the rail’s region (windsor#368)', () => {
  it('reads the selected region as n/m', () => {
    expect(regionBadge(2, 4)).toEqual({ text: '3/4', title: 'Region 3 of 4' });
  });

  it('reads the first, which the card edits, when nothing is selected', () => {
    expect(regionBadge(null, 3)?.text).toBe('1/3');
    expect(regionBadge(null, 3)?.title).toMatch(/click a region/);
    expect(regionBadge(7, 3)?.text).toBe('1/3');
  });

  it('shows none for a part without regions', () => {
    expect(regionBadge(null, 0)).toBeNull();
  });

  it('splits a region of two bars or more, as the pane’s Split did', () => {
    expect(canSplitRegion({ duration: 2 * TICKS_PER_BAR })).toBe(true);
    expect(canSplitRegion({ duration: 2 * TICKS_PER_BAR - 1 })).toBe(false);
    expect(canSplitRegion(null)).toBe(false);
    expect(canSplitRegion(undefined)).toBe(false);
  });
});

const BAR = TICKS_PER_BAR;
const THREE_REGIONS = [0, 1, 2].map((i) => ({ start: 2 * i * BAR, duration: 2 * BAR }));

/** A new song whose part 0 is a `kind` part with three two-bar regions over six bars, none with a pattern yet. */
function songWith(kind: SequencerKind): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, kind, (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({ transport: { bars: 6 }, parts: { 0: { regions: THREE_REGIONS } } });
  return model;
}

const part0 = (doc: ArrangementDocument): MusicPart => {
  const part = partAt(doc, 0);
  if (!part) throw new Error('part 0 is gone');
  return part;
};

/** What a card programs into a region of each kind: steps for the Grid and the Chord. */
function programmed(kind: SequencerKind, doc: ArrangementDocument): Record<string, unknown> {
  const spec = part0(doc).sequencer;
  switch (kind) {
    case 'grid': {
      if (spec.kind !== 'grid') throw new Error('not grid');
      const steps = spec.steps.map((step, i) =>
        i === 1 ? { kind: 'tie' } : i === 2 ? { kind: 'rest' } : step,
      );
      return {
        steps: [
          { kind: 'note', degree: 4, octave: 1, accent: true, slide: false },
          ...steps.slice(1),
        ],
      };
    }
    case 'chord': {
      const hit = (inversion: number) => ({
        kind: 'hit',
        inversion,
        octave: 1,
        duration: 1,
        repeat: 1,
      });
      return { steps: [hit(1), { kind: 'rest', duration: 1, repeat: 1 }, hit(2)] };
    }
    case 'arp':
      return { style: 'down', divisor: DIVISORS.eighth };
    case 'bass':
      return { divisor: DIVISORS.eighth };
    default: {
      if (spec.kind !== 'euclidean') throw new Error('not euclid');
      return { pattern: Array.from({ length: spec.steps }, (_, i) => i % 3 === 0) };
    }
  }
}

const KINDS: readonly SequencerKind[] = ['grid', 'chord', 'arp', 'bass', 'euclidean'];
const PLACES = [
  ['first', 0],
  ['middle', 1],
  ['last', 2],
] as const;

describe('Split on the rail keeps the programmed region (windsor#368 fix round 1)', () => {
  for (const kind of KINDS) {
    for (const [place, index] of PLACES) {
      it(`gives both halves of the ${place} ${kind} region the steps programmed since the pane drew it`, () => {
        const model = songWith(kind);
        // The part as the pane drew it, before the card's edit (which never redraws the pane).
        const painted = part0(model.doc);
        const partial = regionPatternChange(model.doc, 0, index, programmed(kind, model.doc));
        if (!partial) throw new Error('the edit was refused');
        model.merge(partial);
        expect(painted.regions[index]?.pattern).toBeUndefined();
        const edited = part0(model.doc).regions[index]?.pattern;
        expect(edited).toBeDefined();
        const split = splitRegionAtMiddle(model.doc, 0, index);
        expect(split?.map(({ start, duration }) => [start, duration])).toEqual(
          THREE_REGIONS.flatMap(({ start, duration }, i) =>
            i === index
              ? [
                  [start, BAR],
                  [start + BAR, BAR],
                ]
              : [[start, duration]],
          ),
        );
        expect(split?.[index]?.pattern).toEqual(edited);
        expect(split?.[index + 1]?.pattern).toEqual(edited);
        model.merge({ parts: { 0: { regions: split } } });
        const part = part0(model.doc);
        expect(regionPattern(part, index)).toEqual(regionPattern(part, index + 1));
        expect(regionPattern(part, index)).toMatchObject(programmed(kind, model.doc));
      });
    }
  }

  it('refuses a region shorter than two bars or one that is gone', () => {
    const model = songWith('grid');
    model.merge({ parts: { 0: { regions: [{ start: 0, duration: BAR }] } } });
    expect(splitRegionAtMiddle(model.doc, 0, 0)).toBeNull();
    expect(splitRegionAtMiddle(model.doc, 0, 3)).toBeNull();
    expect(splitRegionAtMiddle(model.doc, 9, 0)).toBeNull();
  });
});

describe('Delete on the rail (windsor#368)', () => {
  it('removes the region and keeps what the others were programmed with since the paint', () => {
    const model = songWith('chord');
    const partial = regionPatternChange(model.doc, 0, 0, programmed('chord', model.doc));
    if (!partial) throw new Error('the edit was refused');
    model.merge(partial);
    const regions = removeRegionAt(model.doc, 0, 1);
    expect(regions).toHaveLength(2);
    expect(regions?.[0]?.pattern).toEqual(part0(model.doc).regions[0]?.pattern);
    expect(regions?.[1]?.start).toBe(4 * BAR);
    expect(removeRegionAt(model.doc, 0, 5)).toBeNull();
  });
});

describe('the fold (windsor#368)', () => {
  it('folds and unfolds one part’s device, leaving the others', () => {
    const folds = new DeviceFolds();
    expect(folds.isFolded(1)).toBe(false);
    expect(folds.toggle(1)).toBe(true);
    expect(folds.isFolded(1)).toBe(true);
    expect(folds.isFolded(2)).toBe(false);
    expect(folds.toggle(1)).toBe(false);
    expect(folds.isFolded(1)).toBe(false);
  });
});

describe('the device’s sizes (windsor#368)', () => {
  it('is 244 px high, with 32 px steps and 42 px lanes', () => {
    expect(SEQUENCER_DEVICE_PX['--seq-h']).toBe(244);
    expect(SEQUENCER_DEVICE_PX['--step-w']).toBe(32);
    expect(SEQUENCER_DEVICE_PX['--lane-h']).toBe(42);
  });

  it('holds the step rows at their own height, so the names corner matches them', () => {
    const rows = GRID_HEAD_ROWS_PX.reduce((a, b) => a + b, 0);
    const gaps = STRIP_ROW_GAP_PX * (GRID_HEAD_ROWS_PX.length - 1);
    expect(stripHeadPx()).toBe(rows + gaps);
    expect(SEQUENCER_DEVICE_PX['--strip-head-h']).toBe(stripHeadPx());
  });
});
