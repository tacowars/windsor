/**
 * The Figure's defaults (windsor#484), and the performer at the generator
 * (windsor#485): a tick with no chord plays nothing, and `stepAt` is the cell
 * sounding, through a live `length` edit; a backward drift (windsor#486).
 * Through the player: `song/arrangementPlayerFigure.test.ts` and, for the
 * schedule and the drift, `song/arrangementPlayerFigureProcess.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import { chordAt, type HarmonyChord } from '../harmony/harmonyTimeline';
import type { FigureSpec } from '../song/arrangement';
import { makeArrangement } from '../song/arrangementDocument';
import { liveReconfiguration } from '../song/partGenerators';
import {
  DEFAULT_FIGURE_CONFIG,
  FigureSequencer,
  assertFigureConfig,
  defaultFigureCells,
  figureNoteCell,
} from './figureSequencer';
import type { PartTickEvent } from './regionGate';
import { ScaleSampler } from './scaleSampler';
import { TICKS_PER_BAR } from './scheduler';

const { document } = makeArrangement(currentDocument('figure-listen'));
const SPEC = document.parts[0]?.sequencer as FigureSpec;
const SAMPLER = new ScaleSampler(document.harmony);
const C_MAJOR = chordAt(document.harmony, document.transport.bars * TICKS_PER_BAR, 0);

const tick = (t: number, chord: HarmonyChord | null): PartTickEvent => ({
  tick: t,
  step: t,
  bar: 0,
  tickInBar: t,
  seconds: 0,
  secondsPerTick: 0,
  time: t,
  chord,
  regionIndex: 0,
});

describe('the default Figure (windsor#484)', () => {
  it('is one bar of sixteenths in the meter, tones 0, 1, 2, 1', () => {
    expect(defaultFigureCells('7/8')).toHaveLength(14);
    expect(defaultFigureCells('12/8')).toHaveLength(24);
    const tones = DEFAULT_FIGURE_CONFIG.cells.map((cell) =>
      cell.kind === 'note' ? cell.tone : -1,
    );
    expect(tones.slice(0, 5)).toEqual([0, 1, 2, 1, 0]);
    expect(() => assertFigureConfig(DEFAULT_FIGURE_CONFIG)).not.toThrow();
  });
});

describe('the Figure performer (windsor#485)', () => {
  it('plays nothing and releases nothing on a tick with no chord; the first cell after one arrives plays it', () => {
    const figure = new FigureSequencer(SAMPLER, { ...SPEC, gate: 0.5 });
    expect(figure.handleTick(tick(0, C_MAJOR)).map((e) => e.kind)).toEqual(['noteOn']);
    expect(figure.handleTick(tick(SPEC.divisor / 2, null))).toEqual([]); // the gate's due tick
    expect(figure.handleTick(tick(SPEC.divisor, null))).toEqual([]);
    expect(figure.heldNote).toBe(48);
    const next = figure.handleTick(tick(2 * SPEC.divisor, C_MAJOR));
    expect(next.map((e) => [e.kind, e.note])).toEqual([
      ['noteOff', 48],
      ['noteOn', 55],
    ]);
  });

  it('lights the cell sounding at 1, 7 and 32 cells, and after a live length edit', () => {
    const line = Array.from({ length: 32 }, () => figureNoteCell());
    const at = (figure: FigureSequencer): number[] =>
      [0, 6, 7, 31, 32].map((s) => figure.stepAt(s));
    const figure = new FigureSequencer(SAMPLER, { ...SPEC, cells: line, length: 32 });
    expect(at(figure)).toEqual([0, 6, 7, 31, 0]);
    expect(at(new FigureSequencer(SAMPLER, { ...SPEC, cells: line, length: 7 }))).toEqual([
      0, 6, 0, 3, 4,
    ]);
    expect(at(new FigureSequencer(SAMPLER, { ...SPEC, cells: line, length: 1 }))).toEqual([
      0, 0, 0, 0, 0,
    ]);
    liveReconfiguration(figure, { ...SPEC, cells: line, length: 7 }, SAMPLER)?.();
    expect(at(figure)).toEqual([0, 6, 0, 3, 4]);
  });
});

describe('a backward drift (windsor#486)', () => {
  it('slips back a cell every bar, and the cell index never goes negative', () => {
    const eighths = { ...SPEC, divisor: 12, drift: { steps: -1, everyBars: 1 } };
    const firstOfBars = (figure: FigureSequencer): number[] =>
      [0, 1, 2, 3].map((bar) => figure.stepAt(bar * 8));
    const line = Array.from({ length: 12 }, () => figureNoteCell());
    expect(
      firstOfBars(new FigureSequencer(SAMPLER, { ...eighths, cells: line, length: 12 })),
    ).toEqual([0, 7, 2, 9]);
    // A stage restarting at cell 0 on every bar line puts step − bar below 0: it wraps.
    const restarting = { ...eighths, schedule: [{ length: 4, bars: 1 }] };
    expect(firstOfBars(new FigureSequencer(SAMPLER, restarting))).toEqual([0, 3, 2, 1]);
  });

  it('takes an edit after a live meter change at the next bar line in the new meter', () => {
    const line = Array.from({ length: 32 }, () => figureNoteCell());
    const figure = new FigureSequencer(SAMPLER, { ...SPEC, divisor: 6, cells: line, length: 32 });
    figure.handleTick(tick(90, C_MAJOR)); // bar 0 of 4/4, bar 1 of 7/8
    figure.setBarTicks(84);
    liveReconfiguration(
      figure,
      { ...SPEC, divisor: 6, cells: line, length: 32, schedule: [{ length: 4, bars: 1 }] },
      SAMPLER,
    )?.();
    expect(figure.stepAt(16)).toBe(16); // tick 96, inside the 84–167 bar: unedited
    expect(figure.stepAt(28)).toBeLessThan(4); // tick 168: the 4-cell stage
  });

  it('keeps the original process for the heard bar across edits in consecutive scheduler bars', () => {
    const line = Array.from({ length: 32 }, () => figureNoteCell());
    const config = { ...SPEC, divisor: 12, cells: line, length: 32 };
    const figure = new FigureSequencer(SAMPLER, config);
    const edit = (length: number): void =>
      liveReconfiguration(figure, { ...config, schedule: [{ length, bars: 1 }] }, SAMPLER)?.();
    figure.handleTick(tick(0, C_MAJOR));
    edit(4); // from bar 1
    figure.handleTick(tick(TICKS_PER_BAR, C_MAJOR)); // the scheduler in bar 1, the audible clock in bar 0
    edit(3); // from bar 2
    expect([5, 9, 17].map((step) => figure.stepAt(step))).toEqual([5, 1, 1]);
  });
});
