/**
 * The Figure device's cell rules (windsor#490): what a tone reads over a
 * chord (windsor#489: chord degrees), and that each cell edit, Length,
 * Rotate and Randomize write the selected region's pattern and nothing
 * else, through the normaliser the document runs.
 */
import { describe, expect, it } from 'vitest';

import type { FigureCell, FigureSpec } from '@windsor/engine';
import { DEFAULT_FIGURE_CONFIG, TICKS_PER_BAR, figureNoteCell, partAt } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import {
  cellLabel,
  cellsForLength,
  dragVelocity,
  lineSummary,
  nextFigureKind,
  randomFigureCells,
  reverseFigure,
  rotateFigure,
  setTone,
  setVelocity,
  toneLabel,
  velocityLabel,
} from './figureModel';
import { cycleOctave, toggleFlag, withStep } from './gridModel';
import { regionPatternChange, sequencerKindChange } from './partEdits';
import { cycleStepRatchet } from './ratchetModel';
import { newSong } from './songParts';

const labels = (stack: readonly number[], tones: readonly number[]): string =>
  tones.map((t) => toneLabel(stack, t)).join(' ');

describe('a tone reads as a chord degree over the chord under the playhead', () => {
  it('reads R 3 5 on a triad and R 3 5 7 on a seventh, a prime per octave up', () => {
    expect(labels([0, 4, 7], [0, 1, 2, 3, 6])).toBe("R 3 5 R' R''");
    expect(labels([9, 12, 16, 19], [0, 1, 2, 3, 4])).toBe("R 3 5 7 R'");
  });

  it('reads a minus per octave down', () => {
    expect(labels([0, 4, 7], [-1, -3, -4])).toBe('−5 −R −−5');
  });

  it('names the interval, so a sus chord reads R 4 5 and a diminished fifth 5', () => {
    expect(labels([5, 10, 12], [0, 1, 2])).toBe('R 4 5');
    expect(labels([11, 14, 17], [0, 1, 2])).toBe('R 3 5');
  });

  it('draws a rest and a tie as the Grid does', () => {
    expect(cellLabel({ kind: 'rest' }, [0, 4, 7])).toBe('·');
    expect(cellLabel({ kind: 'tie' }, [0, 4, 7])).toBe('—');
    expect(lineSummary(DEFAULT_FIGURE_CONFIG.cells, DEFAULT_FIGURE_CONFIG.length)).toBe('R 3 5 3');
  });
});

/** A song whose part 0 is a Figure with two regions. */
function figureSong(): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, 'figure', (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({
    parts: {
      0: {
        regions: [
          { start: 0, duration: TICKS_PER_BAR },
          { start: TICKS_PER_BAR, duration: TICKS_PER_BAR },
        ],
      },
    },
  });
  return model;
}

const regionSpec = (model: DocumentModel, region: number): FigureSpec => {
  const pattern = partAt(model.doc, 0)?.regions[region]?.pattern;
  if (pattern?.kind !== 'figure') throw new Error(`region ${region} holds no Figure pattern`);
  return { ...pattern, seed: 0 };
};

/** Write cell 0 of region 1 edited by `edit`, as the strip does, and read it back. */
function editCell(model: DocumentModel, edit: (cell: FigureCell) => FigureCell): FigureCell {
  const now = regionSpec(model, 1).cells;
  const partial = regionPatternChange(model.doc, 0, 1, {
    cells: withStep(now, 0, edit(now[0] ?? figureNoteCell())),
  });
  if (!partial) throw new Error('the edit was refused');
  model.merge(partial);
  return regionSpec(model, 1).cells[0] ?? { kind: 'rest' };
}

describe("a cell edit writes the region's pattern", () => {
  it('cycles note → tie → rest → a root note', () => {
    const model = figureSong();
    // The first edit copies the part's line into region 1.
    model.merge(regionPatternChange(model.doc, 0, 1, { length: 16 }) ?? {});
    expect(editCell(model, nextFigureKind)).toEqual({ kind: 'tie' });
    expect(editCell(model, nextFigureKind)).toEqual({ kind: 'rest' });
    expect(editCell(model, nextFigureKind)).toEqual(figureNoteCell(0));
  });

  it('sets a tone within ±8, a velocity snapped to 0.05 (none stored at 1), the flags, octave and ratchet', () => {
    const model = figureSong();
    model.merge(regionPatternChange(model.doc, 0, 1, { length: 16 }) ?? {});
    expect(editCell(model, (c) => setTone(c, 3))).toMatchObject({ tone: 3 });
    expect(editCell(model, (c) => setTone(c, 12))).toMatchObject({ tone: 8 });
    expect(editCell(model, (c) => setVelocity(c, 0.62))).toMatchObject({ velocity: 0.6 });
    expect(editCell(model, (c) => setVelocity(c, 1))).not.toHaveProperty('velocity');
    expect(editCell(model, (c) => toggleFlag(c, 'accent'))).toMatchObject({ accent: true });
    expect(editCell(model, (c) => toggleFlag(c, 'slide'))).toMatchObject({ slide: true });
    expect(editCell(model, (c) => cycleOctave(c, -1))).toMatchObject({ octave: -1 });
    expect(editCell(model, cycleStepRatchet)).toMatchObject({ ratchet: 2 });
    // Region 0 keeps the part's line.
    expect(partAt(model.doc, 0)?.regions[0]?.pattern).toBeUndefined();
  });

  it('reads a Vel drag as a snapped value, up for louder, and labels it', () => {
    expect(dragVelocity(0.5, -40)).toBe(1);
    expect(dragVelocity(0.5, 20)).toBe(0.25);
    expect(dragVelocity(0.1, 200)).toBe(0);
    expect([1, 0.75, 0.8, 0].map(velocityLabel)).toEqual(['1', '.75', '.8', '0']);
  });
});

describe('Length, Rotate, Reverse and Randomize', () => {
  const line: FigureCell[] = [
    figureNoteCell(0, { velocity: 0.5 }),
    figureNoteCell(1, { ratchet: 3 }),
    { kind: 'rest' },
    figureNoteCell(2),
  ];

  it('grows the cells with root notes and never cuts them', () => {
    expect(cellsForLength(line, 6).slice(4)).toEqual([figureNoteCell(), figureNoteCell()]);
    expect(cellsForLength(line, 2)).toEqual(line);
  });

  it('turns whole cells over the line, velocities and ratchets with them, and the lanes with their cells', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.1, 0.2, 0.3, 0.4] }];
    const turned = rotateFigure({ cells: line, length: 3, lanes }, 1);
    expect(turned.cells).toEqual([line[2], line[0], line[1], line[3]]);
    expect(turned.lanes[0]?.values).toEqual([0.3, 0.1, 0.2, 0.4]);
  });

  it('mirrors whole cells over the line, lanes with them, and back again (windsor#548)', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.1, 0.2, 0.3, 0.4] }];
    const reversed = reverseFigure({ cells: line, length: 3, lanes });
    expect(reversed.cells).toEqual([line[2], line[1], line[0], line[3]]);
    expect(reversed.lanes[0]?.values).toEqual([0.3, 0.2, 0.1, 0.4]);
    expect(reverseFigure({ ...reversed, length: 3 })).toEqual({ cells: line, lanes });
  });

  it('rerolls the line over the chord tones and keeps the cells past it', () => {
    let n = 0;
    // Draws in order: kind (a note), tone, velocity, accent, slide, octave, down, roll, roll size.
    const script = [0.9, 0.99, 0.6, 0.1, 0.9, 0.9, 0, 0.9, 0];
    const draw = (): number => script[n++ % script.length] ?? 0;
    const rolled = randomFigureCells(line, 2, 4, draw);
    expect(rolled[0]).toEqual(figureNoteCell(4, { velocity: 0.8, accent: true }));
    expect(rolled.slice(2)).toEqual(line.slice(2));
  });
});
