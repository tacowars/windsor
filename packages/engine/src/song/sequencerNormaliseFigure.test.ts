/**
 * The Figure kind through `normaliseSequencer` (windsor#484): its numbers
 * clamped with a report each, no default exported on a cell, and its cells
 * repaired by the Grid's list rules.
 */
import { describe, expect, it } from 'vitest';

import { GRID_STEPS_MAX } from '../audioConstants';
import { figureNoteCell } from '../sequencing/figureSequencer';
import type { FigureSpec } from './arrangement';
import { FieldNormaliser } from './arrangementFields';
import { normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';

function figure(raw: Record<string, unknown>): { spec: FigureSpec; corrections: string[] } {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'figure', seed: 0, ...raw }, PATH, n) as FigureSpec;
  return { spec, corrections: n.corrections };
}

const notes = (count: number): object[] => Array.from({ length: count }, () => figureNoteCell());

describe('figure normalisation (windsor#484)', () => {
  it('clamps each number with a report, and exports no velocity or ratchet of 1', () => {
    const { spec, corrections } = figure({
      cells: [
        { kind: 'note', tone: 9, octave: 5, velocity: 1.5 },
        { kind: 'note', velocity: 1, ratchet: 1 },
      ],
      drift: { steps: 5, everyBars: 2 },
      schedule: [{ length: 2, bars: 0 }],
    });
    expect(spec.cells).toEqual([figureNoteCell(8, { octave: 2 }), figureNoteCell()]);
    expect(spec.drift).toEqual({ steps: 4, everyBars: 2 });
    expect(spec.schedule).toEqual([{ length: 2, bars: 1 }]);
    expect(corrections).toHaveLength(5);
    for (const at of ['[0].tone', '[0].octave', '[0].velocity']) {
      expect(corrections.join('\n')).toContain(`${PATH}.cells${at}`);
    }
    expect(corrections.join('\n')).toContain(`${PATH}.drift.steps`);
    expect(corrections.join('\n')).toContain(`${PATH}.schedule[0].bars`);
  });

  it('drops a stage past the cells with a report, and an empty schedule silently', () => {
    const past = figure({ cells: notes(4), schedule: [{ length: 5, bars: 1 }] });
    expect(past.spec).not.toHaveProperty('schedule');
    expect(past.corrections).toEqual([
      `${PATH}.schedule[0].length: 5 is past the 4 cells — stage dropped`,
    ]);
    const empty = figure({ cells: notes(4), schedule: [] });
    expect(empty.spec).not.toHaveProperty('schedule');
    expect(empty.corrections).toEqual([]);
  });

  it('repairs no cells, too many and a length past them as the Grid does', () => {
    const none = figure({ cells: [] });
    expect(none.spec.cells).toHaveLength(16);
    expect(none.corrections).toEqual([
      `${PATH}.cells: [] is not a list of cells — using the default bar`,
    ]);
    expect(figure({ cells: notes(GRID_STEPS_MAX) }).corrections).toEqual([]);
    const long = figure({ cells: notes(GRID_STEPS_MAX + 8) });
    expect(long.spec.cells).toHaveLength(GRID_STEPS_MAX);
    expect(long.corrections).toEqual([`${PATH}.cells: 40 cells capped to ${GRID_STEPS_MAX}`]);
    const short = figure({ cells: notes(4), length: 9 });
    expect(short.spec.length).toBe(4);
    expect(short.corrections).toEqual([`${PATH}.length: clamped 9 to 4`]);
  });
});
