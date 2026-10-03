/**
 * The Figure device's Process page (windsor#490): the stage list's add,
 * move, remove and edit, the drift's and source's writes into the region's
 * pattern, the Source picker's options, and the readouts and summary.
 */
import { describe, expect, it } from 'vitest';

import type { FigureStage } from '@windsor/engine';
import { TICKS_PER_BAR, partAt } from '@windsor/engine';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import {
  addStage,
  driftChange,
  driftReadout,
  figureSummary,
  moveStage,
  removeStage,
  scheduleReadout,
  setStage,
  sourceChoice,
  sourceOptions,
  withoutSource,
} from './figureProcessModel';
import { addPartChange, patternCopy, regionPatternChange, sequencerKindChange } from './partEdits';
import { newSong } from './songParts';

const GLASS: FigureStage[] = [
  { length: 4, bars: 2 },
  { length: 5, bars: 2 },
  { length: 6, bars: 2 },
];

describe('the schedule', () => {
  it('adds a stage one cell longer than the last, the first at four cells, never past the line', () => {
    expect(addStage([], 8)).toEqual([{ length: 4, bars: 2 }]);
    expect(addStage(GLASS, 8).at(-1)).toEqual({ length: 7, bars: 2 });
    expect(addStage([{ length: 8, bars: 4 }], 8).at(-1)).toEqual({ length: 8, bars: 4 });
  });

  it('moves, removes and edits a stage, clamped to the line and to 64 bars', () => {
    expect(moveStage(GLASS, 0, 2).map((s) => s.length)).toEqual([5, 6, 4]);
    expect(moveStage(GLASS, 2, 0).map((s) => s.length)).toEqual([6, 4, 5]);
    expect(removeStage(GLASS, 1).map((s) => s.length)).toEqual([4, 6]);
    expect(setStage(GLASS, 0, 'length', 12, 8)[0]).toEqual({ length: 8, bars: 2 });
    expect(setStage(GLASS, 1, 'bars', 99, 8)[1]).toEqual({ length: 5, bars: 64 });
  });

  it('reads the cycle', () => {
    expect(scheduleReadout(GLASS, 8)).toBe('cycle 6 bars · 3 stages · restarts at cell 1');
    expect(scheduleReadout(undefined, 8)).toBe('no schedule · all 8 cells');
  });
});

describe('the drift', () => {
  it('keeps the other field, starting Every at its default, and clamps', () => {
    expect(driftChange(undefined, 'steps', 1)).toEqual({ steps: 1, everyBars: 4 });
    expect(driftChange({ steps: 1, everyBars: 4 }, 'everyBars', 12)).toEqual({
      steps: 1,
      everyBars: 12,
    });
    expect(driftChange(undefined, 'steps', -9)).toEqual({ steps: -4, everyBars: 4 });
  });

  it('reads when the line comes back round', () => {
    expect(driftReadout({ steps: 1, everyBars: 12 }, 12)).toBe(
      '+1 step / 12 bars · back in 144 bars',
    );
    expect(driftReadout({ steps: -2, everyBars: 4 }, 8)).toBe(
      '-2 steps / 4 bars · back in 16 bars',
    );
    expect(driftReadout({ steps: 0, everyBars: 4 }, 8)).toBe('no drift');
  });
});

/** A song of three parts: a Figure leader, a Grid, and a Figure on slot 2, each with two regions. */
function song(): DocumentModel {
  const model = new DocumentModel(newSong());
  for (let i = 0; i < 2; i++) {
    const added = addPartChange(model.doc, (raw) => model.preview(raw));
    if (added) model.merge(added.partial);
  }
  for (const [slot, kind] of [
    [0, 'figure'],
    [1, 'grid'],
    [2, 'figure'],
  ] as const) {
    const partial = sequencerKindChange(model.doc, slot, kind, (raw) => model.preview(raw));
    if (partial) model.merge(partial);
    const regions = [
      { start: 0, duration: TICKS_PER_BAR },
      { start: TICKS_PER_BAR, duration: TICKS_PER_BAR },
    ];
    model.merge({ parts: { [slot]: { regions } } });
  }
  return model;
}

function write(model: DocumentModel, fields: Record<string, unknown>): void {
  const partial = regionPatternChange(model.doc, 2, 1, fields);
  if (!partial) throw new Error('the edit was refused');
  model.merge(partial);
}

const pattern = (model: DocumentModel) => partAt(model.doc, 2)?.regions[1]?.pattern;

describe('the processes write the region pattern', () => {
  it('writes a schedule and a drift into the region, and an empty schedule as none', () => {
    const model = song();
    write(model, { schedule: GLASS, drift: { steps: 1, everyBars: 12 } });
    expect(pattern(model)).toMatchObject({ schedule: GLASS, drift: { steps: 1, everyBars: 12 } });
    expect(partAt(model.doc, 2)?.regions[0]?.pattern).toBeUndefined();
    write(model, { schedule: [] });
    expect(pattern(model)).not.toHaveProperty('schedule');
  });

  it('offers Own cells and the other Figure parts by name, never the part itself or another kind', () => {
    const model = song();
    const names = model.doc.parts.map((p) => p.name);
    expect(sourceOptions(model.doc, 2)).toEqual([
      { value: '', label: 'Own cells' },
      { value: '0', label: names[0] },
    ]);
  });

  it('writes a source keeping its offset and transpose, and Own cells drops it whole', () => {
    const model = song();
    const choice = sourceChoice('0', { slot: 9, offset: 3, transpose: 12 });
    expect(choice).toEqual({ slot: 0, offset: 3, transpose: 12 });
    write(model, { source: choice });
    expect(pattern(model)).toMatchObject({ source: { slot: 0, offset: 3, transpose: 12 } });
    expect(sourceChoice('', choice ?? undefined)).toBeNull();
    const part = partAt(model.doc, 2);
    if (!part) throw new Error('part 2 is gone');
    const own = withoutSource(patternCopy(part, 1));
    const regions = part.regions.map((r, i) => (i === 1 ? { ...r, pattern: own } : r));
    model.merge(partChange(2, { regions }));
    expect(pattern(model)).not.toHaveProperty('source');
  });

  it('shows Own cells again once the leader stops being a Figure', () => {
    const model = song();
    write(model, { source: { slot: 0, offset: 0, transpose: 0 } });
    const partial = sequencerKindChange(model.doc, 0, 'grid', (raw) => model.preview(raw));
    if (partial) model.merge(partial);
    expect(pattern(model)).not.toHaveProperty('source');
  });
});

describe('the summary', () => {
  it('names the cells, the chord, the stage, the rotation and the leader', () => {
    expect(
      figureSummary({
        cells: 8,
        chord: 'A min',
        stages: GLASS,
        stage: 1,
        drift: { steps: 1, everyBars: 4 },
        rotation: 2,
        source: { slot: 0, offset: 4, transpose: 0 },
        leader: 'Mallets I',
      }),
    ).toBe('8 cells · A min · stage 2/3 · 5 cells · rot +2 · from Mallets I +4');
    const bare = { cells: 1, chord: null, stages: undefined, stage: -1, drift: undefined };
    expect(figureSummary({ ...bare, rotation: 0, source: undefined, leader: null })).toBe('1 cell');
  });
});
