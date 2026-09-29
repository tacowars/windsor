/**
 * The pattern a card edits (windsor#75, epic windsor#70; record
 * `2026-09-29-each-region-plays-its-own-pattern`): an edit writes a full copy
 * into the selected region's pattern and nowhere else, the seed stays the
 * part's, a drawn region copies its neighbour, a split gives both halves a
 * copy, a kind change clears every region, and each region's performance
 * survives export → import. Pat's report is the fixture: one chord part, two
 * regions, one hit at octave 3 in the first and four hits at inversion 2 in
 * the second.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, ChordStep, MusicPart, SequencerKind } from '@windsor/engine';
import { DIVISORS, TICKS_PER_BAR, partAt, regionPattern } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import {
  drawRegionChange,
  editedRegion,
  patternOf,
  regionGrain,
  regionPatternChange,
  sequencerKindChange,
  splitFill,
  splitPartRegion,
} from './partEdits';
import { moveRegion, resizeRegionEnd, splitRegion } from './regionModel';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;

const hit = (inversion: number, octave: number): ChordStep => ({
  kind: 'hit',
  inversion,
  octave,
  duration: 1,
  repeat: 1,
});

/** A new song whose part 0 is a `kind` part with `regions`. */
function songWith(
  kind: SequencerKind,
  regions: ReadonlyArray<{ start: number; duration: number }>,
): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, kind, (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({ parts: { 0: { regions } } });
  return model;
}

const part0 = (doc: ArrangementDocument): MusicPart => {
  const part = partAt(doc, 0);
  if (!part) throw new Error('part 0 is gone');
  return part;
};

/** Apply one card edit to region `region` of part 0. */
function edit(model: DocumentModel, region: number | undefined, fields: Record<string, unknown>) {
  const partial = regionPatternChange(model.doc, 0, region, fields);
  if (!partial) throw new Error('the edit was refused');
  model.merge(partial);
}

const TWO_REGIONS = [
  { start: 0, duration: 2 * BAR },
  { start: 2 * BAR, duration: 2 * BAR },
];

describe('a card edit writes the selected region only', () => {
  it("gives the edited region a full copy and leaves the other region and the part's sequencer as they were", () => {
    const model = songWith('chord', TWO_REGIONS);
    const before = part0(model.doc).sequencer;
    edit(model, 1, { steps: [hit(2, 0)] });
    const part = part0(model.doc);
    expect(part.sequencer).toEqual(before);
    expect(part.regions[0]?.pattern).toBeUndefined();
    expect(regionPattern(part, 0)).toEqual(before);
    // The copy is whole: every field of the kind, with the edit.
    expect(part.regions[1]?.pattern).toEqual({ ...before, steps: [hit(2, 0)] });
  });

  it("keeps Pat's two performances apart through selecting back and forth and export → import", () => {
    const model = songWith('chord', TWO_REGIONS);
    edit(model, 0, { steps: [hit(0, 0)] });
    edit(model, 0, { register: { octave: 5 } });
    edit(model, 1, { steps: [hit(2, 0), hit(2, 0), hit(2, 0), hit(2, 0)] });
    edit(model, 1, { gate: 0.5, voicing: 'drop2', divisor: DIVISORS.quarter });
    const check = (doc: ArrangementDocument): void => {
      const first = patternOf(doc, 0, 0);
      const second = patternOf(doc, 0, 1);
      if (first?.kind !== 'chord' || second?.kind !== 'chord') throw new Error('not chord');
      expect(first.steps).toEqual([hit(0, 0)]);
      expect(first.register.octave).toBe(5);
      expect(second.steps).toHaveLength(4);
      expect(second.steps[0]).toMatchObject({ inversion: 2 });
      expect(second.register.octave).not.toBe(5);
      expect([second.gate, second.voicing, second.divisor]).toEqual([
        0.5,
        'drop2',
        DIVISORS.quarter,
      ]);
      expect(first.divisor).not.toBe(DIVISORS.quarter);
    };
    check(model.doc);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    check(reopened.doc);
    expect(reopened.toJson()).toBe(model.toJson());
  });

  it('merges a nested field into the copy and replaces an array whole', () => {
    const model = songWith('euclidean', TWO_REGIONS);
    edit(model, 1, { density: { kind: 'lfoBars', bars: 4 } });
    const pattern = part0(model.doc).regions[1]?.pattern;
    const base = part0(model.doc).sequencer;
    if (pattern?.kind !== 'euclidean' || base.kind !== 'euclidean') throw new Error('not euclid');
    expect(pattern.density).toEqual({ ...base.density, bars: 4 });
    const figure = Array.from({ length: base.steps }, (_, i) => i % 4 === 0);
    edit(model, 1, { pattern: figure });
    expect(patternOf(model.doc, 0, 1)).toMatchObject({ pattern: figure, density: { bars: 4 } });
    edit(model, 1, { pattern: null });
    expect(patternOf(model.doc, 0, 1)).toMatchObject({ pattern: null });
    expect(part0(model.doc).regions[0]?.pattern).toBeUndefined();
  });

  it("sends a seed to the part, never into a region's pattern", () => {
    const model = songWith('arp', TWO_REGIONS);
    edit(model, 1, { seed: 77, style: 'down' });
    const part = part0(model.doc);
    expect(part.sequencer).toMatchObject({ seed: 77 });
    expect(part.regions[1]?.pattern).toMatchObject({ style: 'down' });
    expect(part.regions[1]?.pattern).not.toHaveProperty('seed');
    // Both regions play the part's seed; only the edited one changed style.
    expect(regionPattern(part, 1)).toMatchObject({ seed: 77, style: 'down' });
    expect(regionPattern(part, 0)).toMatchObject({ seed: 77 });
    expect(regionPattern(part, 0)).not.toMatchObject({ style: 'down' });
    const seedOnly = regionPatternChange(model.doc, 0, 0, { seed: 5 });
    expect(seedOnly).toEqual({ parts: { 0: { sequencer: { seed: 5 } } } });
  });

  it("edits the part's sequencer when no region is named, and refuses a region that is gone", () => {
    const model = songWith('grid', TWO_REGIONS);
    expect(regionPatternChange(model.doc, 0, undefined, { divisor: 60 })).toEqual({
      parts: { 0: { sequencer: { divisor: 60 } } },
    });
    expect(regionPatternChange(model.doc, 0, 2, { divisor: 60 })).toBeNull();
    expect(regionPatternChange(model.doc, 5, 0, { divisor: 60 })).toBeNull();
  });

  it('gives an old song its first copy on the first edit, the other regions playing as before', () => {
    // A song saved before region patterns: its regions carry none.
    const model = songWith('bass', [
      { start: 0, duration: BAR },
      { start: BAR, duration: BAR },
      { start: 2 * BAR, duration: 2 * BAR },
    ]);
    const before = part0(model.doc).sequencer;
    edit(model, 2, { register: { octave: 1 } });
    const part = part0(model.doc);
    expect(part.regions.map((r) => r.pattern === undefined)).toEqual([true, true, false]);
    expect(regionPattern(part, 0)).toBe(part.sequencer);
    expect(part.sequencer).toEqual(before);
    expect(regionPattern(part, 2)).toMatchObject({ register: { octave: 1 } });
  });
});

describe('which region a card edits', () => {
  it('is the selected region, else the first; none on a part with no regions', () => {
    const regions = TWO_REGIONS;
    expect(editedRegion({ regions }, 1)).toBe(1);
    expect(editedRegion({ regions }, null)).toBe(0);
    expect(editedRegion({ regions }, 4)).toBe(0);
    expect(editedRegion({ regions: [] }, null)).toBeNull();
  });
});

describe('a split, a draw, a move and a kind change', () => {
  it('splits a region into two equal copies that then edit on their own', () => {
    const model = songWith('chord', [{ start: 0, duration: 4 * BAR }]);
    const part = part0(model.doc);
    model.merge({
      parts: { 0: { regions: splitRegion(part.regions, 0, 2 * BAR, BAR, splitFill(part)) } },
    });
    const halves = part0(model.doc).regions;
    expect(halves).toHaveLength(2);
    expect(halves[0]?.pattern).toBeDefined();
    expect(halves[1]?.pattern).toEqual(halves[0]?.pattern);
    edit(model, 1, { steps: [hit(1, 1)] });
    expect(patternOf(model.doc, 0, 0)).toMatchObject({ steps: [] });
    expect(patternOf(model.doc, 0, 1)).toMatchObject({ steps: [hit(1, 1)] });
  });

  it("gives a grid split no copy: the grid card edits the part's sequencer until windsor#76", () => {
    const model = songWith('grid', [{ start: 0, duration: 4 * BAR }]);
    const part = part0(model.doc);
    const split = splitRegion(part.regions, 0, 2 * BAR, BAR, splitFill(part));
    expect(split.map((r) => r.pattern)).toEqual([undefined, undefined]);
  });

  it("copies the left neighbour's pattern into a drawn region, else the right's", () => {
    const model = songWith('chord', [
      { start: BAR, duration: BAR },
      { start: 3 * BAR, duration: BAR },
    ]);
    edit(model, 0, { steps: [hit(1, 0)] });
    edit(model, 1, { steps: [hit(2, 0)] });
    const preview = (raw: unknown): ArrangementDocument => model.preview(raw);
    const between = drawRegionChange(model.doc, 0, 2 * BAR, preview);
    expect(between?.index).toBe(1);
    expect(between?.regions[1]?.pattern).toMatchObject({ steps: [hit(1, 0)] });
    const first = drawRegionChange(model.doc, 0, 0, preview);
    expect(first?.index).toBe(0);
    expect(first?.regions[0]?.pattern).toMatchObject({ steps: [hit(1, 0)] });
    expect(drawRegionChange(model.doc, 0, BAR, preview)).toBeNull();
  });

  it("starts a part's first region from the kind's default pattern", () => {
    const model = songWith('chord', []);
    // An old part.sequencer the drawn region does not take.
    model.merge({ parts: { 0: { sequencer: { steps: [hit(2, 1)] } } } });
    const drawn = drawRegionChange(model.doc, 0, 0, (raw) => model.preview(raw));
    // A chord pattern has no seed, so the default pattern is a fresh part's whole sequencer.
    expect(drawn?.regions[0]?.pattern).toEqual(part0(songWith('chord', []).doc).sequencer);
  });

  it('draws a bare region on a grid lane', () => {
    const model = songWith('grid', [{ start: 0, duration: BAR }]);
    const drawn = drawRegionChange(model.doc, 0, 2 * BAR, (raw) => model.preview(raw));
    expect(drawn?.regions[1]).toEqual({ start: 2 * BAR, duration: BAR });
  });

  it('keeps a pattern through a move, and a delete leaves the others as they were', () => {
    const model = songWith('chord', TWO_REGIONS);
    edit(model, 0, { steps: [hit(0, 1)] });
    edit(model, 1, { steps: [hit(2, 0)] });
    const regions = part0(model.doc).regions;
    const shortened = resizeRegionEnd(regions, 1, 3 * BAR, 4 * BAR);
    model.merge({ parts: { 0: { regions: moveRegion(shortened, 1, 3 * BAR, 4 * BAR) } } });
    expect(part0(model.doc).regions[1]).toMatchObject({ start: 3 * BAR });
    expect(patternOf(model.doc, 0, 1)).toMatchObject({ steps: [hit(2, 0)] });
    model.merge({ parts: { 0: { regions: part0(model.doc).regions.slice(1) } } });
    expect(patternOf(model.doc, 0, 0)).toMatchObject({ steps: [hit(2, 0)] });
  });

  it("clears every region's pattern on a kind change", () => {
    const model = songWith('chord', TWO_REGIONS);
    edit(model, 1, { steps: [hit(2, 0)] });
    const partial = sequencerKindChange(model.doc, 0, 'arp', (raw) => model.preview(raw));
    expect(partial?.parts?.[0]).toMatchObject({ regions: TWO_REGIONS });
    if (partial) model.merge(partial);
    const part = part0(model.doc);
    expect(part.sequencer.kind).toBe('arp');
    expect(part.regions).toEqual(TWO_REGIONS);
  });
});

describe('a gesture snaps to the grain of the region it acts on (fix round 1)', () => {
  /** Two chord regions: the first at the part's one-bar step, the second edited to eighths. */
  function twoSteps(): DocumentModel {
    const model = songWith('chord', TWO_REGIONS);
    edit(model, 1, { divisor: DIVISORS.eighth, steps: [hit(0, 0)] });
    return model;
  }

  it("reads each region's own divisor under the modifier, a bar without it", () => {
    const part = part0(twoSteps().doc);
    expect(part.sequencer).toMatchObject({ divisor: DIVISORS.bar });
    expect(regionGrain(part, 0, true)).toBe(DIVISORS.bar);
    expect(regionGrain(part, 1, true)).toBe(DIVISORS.eighth);
    expect(regionGrain(part, 1, false)).toBe(BAR);
  });

  it("cuts a Shift+Alt split in the second region on its own eighth, not on the part's bar", () => {
    const part = part0(twoSteps().doc);
    const eighth = DIVISORS.eighth;
    const at = 2 * BAR + 3 * eighth;
    const split = splitPartRegion(part, 1, at + eighth / 4, true);
    expect(split?.map(({ start, duration }) => [start, duration])).toEqual([
      [0, 2 * BAR],
      [2 * BAR, 3 * eighth],
      [at, 4 * BAR - at],
    ]);
    // Both halves hold the second region's pattern, not the first's or the part's.
    expect(split?.[1]?.pattern).toMatchObject({ divisor: eighth, steps: [hit(0, 0)] });
    expect(split?.[2]?.pattern).toEqual(split?.[1]?.pattern);
    // At the part's one-bar step the same press snaps onto the region's start and is refused.
    expect(splitPartRegion(part, 1, at + eighth / 4, false)).toBeNull();
  });

  it("splits at the pane's Split button: the region's middle bar, both halves its own pattern", () => {
    const part = part0(twoSteps().doc);
    const target = part.regions[1];
    if (!target) throw new Error('no second region');
    const split = splitPartRegion(part, 1, target.start + target.duration / 2, false);
    expect(split?.map(({ start, duration }) => [start, duration])).toEqual([
      [0, 2 * BAR],
      [2 * BAR, BAR],
      [3 * BAR, BAR],
    ]);
    expect(split?.[1]?.pattern).toMatchObject({ divisor: DIVISORS.eighth });
    expect(split?.[2]?.pattern).toMatchObject({ divisor: DIVISORS.eighth });
    expect(split?.[0]?.pattern).toBeUndefined();
    expect(splitPartRegion(part, 5, BAR, false)).toBeNull();
  });
});
