/**
 * Spectre's workbench geometry and readouts (record
 * `2026-10-17-spectre-drawn-cells` decision 10): the lanes stack over the
 * ruler, a point maps to its cell and value and back, a readout speaks in
 * Hz, notes, dB, ms and beats and %, Follow marks the cells near the notes
 * handed in, the heard curve is the worklet's read, and the keys mean what
 * the workbench says.
 */
import { DEFAULT_SPECTRE, SPECTRE_CELLS, spectreFlatCells } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  activeCells,
  benchLayout,
  cellOfX,
  gridShare,
  heardCells,
  laneAt,
  noteName,
  readout,
  toneCells,
  valueOfY,
  xOfCell,
  yOfValue,
} from './spectreBenchModel';
import { benchKeyAction } from './spectreBenchKeys';
import { cellOfMidi } from './spectreGenerators';
import { SPECTRE_BENCH } from './spectreBenchTables';

describe('the workbench layout', () => {
  const layout = benchLayout(1000, 600);

  it('stacks three equal lanes over the ruler, the cells right of the gutter', () => {
    expect(layout.lanes.map((l) => l.curve)).toEqual(['gain', 'delay', 'feedback']);
    expect(layout.lanes[1]!.top).toBe(layout.lanes[0]!.height + SPECTRE_BENCH.laneGapPx);
    expect(layout.height).toBe(600);
    expect(layout.left).toBe(SPECTRE_BENCH.gutterPx);
  });

  it('maps a point to its cell and value and back', () => {
    for (const i of [0, 50, SPECTRE_CELLS - 1])
      expect(cellOfX(layout, xOfCell(layout, i) + 0.1)).toBe(i);
    const lane = layout.lanes[2]!;
    expect(valueOfY(lane, yOfValue(lane, 0.25))).toBeCloseTo(0.25, 2);
    expect(laneAt(layout, lane.top + 1)).toBe(lane);
    expect(laneAt(layout, layout.ruler + 1)).toBeUndefined();
  });
});

describe('the readout', () => {
  it('names a band’s span and note, and each lane’s value in its own units', () => {
    const spec = {
      ...DEFAULT_SPECTRE,
      sync: false,
      timeMs: 1000,
      curves: {
        gain: { left: spectreFlatCells(0.9), link: true, steps: false },
        delay: { left: spectreFlatCells(0.25), link: true, steps: false },
        feedback: { left: spectreFlatCells(0.45), link: true, steps: false },
      },
    };
    const cell = cellOfMidi(69);
    const r = readout(spec, cell, 0, 120);
    expect(r.note).toBe('A4');
    expect(r.span).toMatch(/^\d+–\d+ Hz$/);
    expect(r.gain).toBe('−6.0 dB');
    expect(r.delay).toBe('250 ms · 0.50 beat');
    expect(r.feedback).toBe('45%');
    expect(noteName(61)).toBe('C♯4');
  });

  it('gives the grid as a share of the delay’s full scale', () => {
    expect(gridShare({ ...DEFAULT_SPECTRE, division: '1/2', grid: '1/16' }, 120)).toBe(0.125);
    expect(gridShare({ ...DEFAULT_SPECTRE, grid: 'off' }, 120)).toBe(0);
  });
});

describe('Follow and the heard curve', () => {
  it('marks the cells near the notes handed in, within what is drawn', () => {
    const triad = 0b000010010001;
    const tones = toneCells(triad);
    expect(tones[cellOfMidi(60)]).toBe(true);
    expect(tones[cellOfMidi(61)]).toBe(false);
    const drawn = {
      ...DEFAULT_SPECTRE,
      follow: 'chord' as const,
      selection: [[0, 90]] as [number, number][],
    };
    const active = activeCells(drawn, triad);
    expect(active[cellOfMidi(36)]).toBe(true);
    expect(active.slice(90).some(Boolean)).toBe(false);
    expect(activeCells({ ...drawn, follow: 'off' }, triad).filter(Boolean)).toHaveLength(90);
  });

  it('hears a curve slid by its shift and moved by its offset and, where active, its select', () => {
    const spec = {
      ...DEFAULT_SPECTRE,
      curves: {
        ...DEFAULT_SPECTRE.curves,
        feedback: { left: spectreFlatCells(0.4), link: true, steps: false },
      },
      feedbackOffset: 0.1,
      feedbackSelect: 0.2,
    };
    const active = Array.from({ length: SPECTRE_CELLS }, (_, i) => i < 10);
    const heard = heardCells(spec, 'feedback', 0, active, 0);
    expect(heard[50]).toBeCloseTo(0.5, 9);
    expect(heard[3]).toBeCloseTo(0.7, 9);
  });
});

describe('the workbench keys', () => {
  const facts = (key: string, more = {}) => ({
    key,
    ctrl: false,
    meta: false,
    alt: false,
    editing: false,
    ...more,
  });
  it('picks tools, lanes and widths, nudges, applies and escapes; leaves the app’s and the fields’ keys', () => {
    expect(benchKeyAction(facts('d'))).toEqual({ kind: 'tool', tool: 'draw' });
    expect(benchKeyAction(facts('M'))).toEqual({ kind: 'tool', tool: 'select' });
    expect(benchKeyAction(facts('2'))).toEqual({ kind: 'lane', curve: 'delay' });
    expect(benchKeyAction(facts(']'))).toEqual({ kind: 'width', by: 1 });
    expect(benchKeyAction(facts('ArrowLeft'))).toEqual({ kind: 'nudge', by: -1 });
    expect(benchKeyAction(facts('Enter'))).toEqual({ kind: 'apply' });
    expect(benchKeyAction(facts('Escape', { editing: true }))).toEqual({ kind: 'escape' });
    expect(benchKeyAction(facts('z', { meta: true }))).toBeNull();
    expect(benchKeyAction(facts('d', { editing: true }))).toBeNull();
    expect(benchKeyAction(facts('q'))).toBeNull();
  });
});
