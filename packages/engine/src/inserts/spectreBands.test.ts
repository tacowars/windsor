/**
 * Spectre's curves read band by band (records `2026-10-16-spectre-insert`
 * and `2026-10-17-spectre-drawn-cells`), on the shipped bundle: each band's
 * delay is the main thread's `spectreCellRead` at the band's place on the
 * axis, smooth or stepped, slid by the shift and Spread, moved by the offset
 * and, on the selected cells, by the select, in frames of the full scale;
 * each channel reads its own cells once unlinked; a followed chord selects
 * the cells near its notes within what is drawn; the LFO's slots push their
 * destinations; the grid snaps every band to its multiples; Scatter adds at
 * most its share; the gain curve's 0 is silence and the feedback is the
 * value itself.
 */
import { describe, expect, it } from 'vitest';
import {
  loadSpectre,
  runSpectre,
  spectreFlat,
  spectreParams,
  spectreSignal,
} from '../__fixtures__/spectreHarness';
import type { SpectreProcessorLike } from '../__fixtures__/spectreHarness';
import { spectreCellRead, spectreSelectionMask } from './spectreCells';
import type { SpectreCellCurves, SpectreSelection } from './spectreCells';
import { SPECTRE_AXIS_OCTAVES, spectreAxisAt } from './spectreCurves';
import { SPECTRE_CELLS, SPECTRE_DSP } from './spectreConstants';
import type { SpectreSpec } from './spectreSpec';

const RATE = 48000;

interface BandMap {
  gain: Float64Array;
  delay: Int32Array;
  feedback: Float64Array;
  selected: Float64Array;
  delayShift: number;
  gainOffset: number;
}
type Inside = SpectreProcessorLike & {
  dsp: {
    leftChannel: { map: BandMap };
    rightChannel: { map: BandMap };
    size: number;
    hop: number;
    lfo: { value: number };
  };
};

/** A processor run long enough for its controls to land, and its two maps; `pitches` the stage's. */
function settled(spec: Partial<SpectreSpec>, pitches?: number): Inside {
  const params = spectreParams({ grid: 'off', sync: false, timeMs: 2000, ...spec });
  if (pitches !== undefined) params.pitches![0] = pitches;
  const processor = loadSpectre(RATE, params) as Inside;
  runSpectre(
    processor,
    spectreSignal(RATE / 2, () => 0.1),
    params,
  );
  return processor;
}

/** A shape with corners, steps and a slope, so every read is tested away from flat. */
const shaped = (seed: number): number[] =>
  Array.from({ length: SPECTRE_CELLS }, (_, i) => {
    const step = Math.floor(i / 12) % 3 === seed % 3 ? 0.6 : 0.2;
    return Math.round((step + (0.3 * i) / SPECTRE_CELLS) * 1000) / 1000;
  });

const curves = (steps: boolean, right?: number[]): SpectreCellCurves => ({
  gain: {
    left: Array.from({ length: SPECTRE_CELLS }, (_, i) => (i < 20 ? 0 : 1)),
    link: true,
    steps: true,
  },
  delay: right
    ? { left: shaped(1), right, link: false, steps }
    : { left: shaped(1), link: true, steps },
  feedback: { left: shaped(2), link: true, steps: false },
});

/** Each map's delay against the main thread's read of `cells` for that channel. */
function expectDelays(
  processor: Inside,
  cells: readonly (readonly number[])[],
  steps: boolean,
  shift: (side: number) => number,
  add: (i: number) => number,
): void {
  const { size, hop } = processor.dsp;
  const full = (2 * RATE) / hop;
  [processor.dsp.leftChannel.map, processor.dsp.rightChannel.map].forEach((map, ch) => {
    const side = ch === 0 ? -0.5 : 0.5;
    for (let k = 0; k <= size / 2; k += 5) {
      const x = spectreAxisAt((k * RATE) / size);
      const value = spectreCellRead(cells[ch]!, x, {
        steps,
        shiftOctaves: shift(side),
        octaves: SPECTRE_AXIS_OCTAVES,
        add,
      });
      expect(Math.abs(map.delay[k]! - value * full), `ch ${ch} band ${k}`).toBeLessThanOrEqual(
        0.5 + 1e-6,
      );
    }
  });
}

describe('Spectre’s band map', () => {
  it.each([false, true])(
    'reads each band’s delay off its cells (steps %s), slid by the shift and Spread, moved by the offset',
    (steps) => {
      const shift = 1.25,
        spread = 0.5,
        offset = -0.1;
      const processor = settled({
        curves: curves(steps),
        delayShift: shift,
        spread,
        delayOffset: offset,
      });
      expectDelays(
        processor,
        [shaped(1), shaped(1)],
        steps,
        (side) => shift + side * spread,
        () => offset,
      );
    },
  );

  it('moves only the selected cells by the select, and marks their bands', () => {
    const selection: SpectreSelection = [
      [40, 70],
      [120, 130],
    ];
    const mask = spectreSelectionMask(selection);
    const processor = settled({ curves: curves(false), selection, delaySelect: 0.3 });
    expectDelays(
      processor,
      [shaped(1), shaped(1)],
      false,
      () => 0,
      (i) => 0.3 * mask[i]!,
    );
    const { size } = processor.dsp;
    const map = processor.dsp.leftChannel.map;
    for (let k = 1; k <= size / 2; k += 3) {
      const cell = Math.min(
        SPECTRE_CELLS - 1,
        Math.floor(spectreAxisAt((k * RATE) / size) * SPECTRE_CELLS),
      );
      expect(map.selected[k], `band ${k}`).toBe(mask[cell]);
    }
  });

  it('follows a chord: the cells within toneSemitones of its notes, inside the drawn selection', () => {
    const triad = 0b000010010001; // C, E, G
    const selection: SpectreSelection = [[60, 150]];
    const processor = settled({ curves: curves(false), follow: 'chord', selection }, triad);
    const { size } = processor.dsp;
    const map = processor.dsp.leftChannel.map;
    let marked = 0;
    for (let k = 1; k <= size / 2; k++) {
      const hz = (k * RATE) / size;
      const cell = Math.min(SPECTRE_CELLS - 1, Math.floor(spectreAxisAt(hz) * SPECTRE_CELLS));
      const centre =
        SPECTRE_DSP.axisLowHz * 2 ** (((cell + 0.5) / SPECTRE_CELLS) * SPECTRE_AXIS_OCTAVES);
      const midi = 69 + 12 * Math.log2(centre / 440);
      const note = Math.round(midi);
      const tone =
        Math.abs(midi - note) <= SPECTRE_DSP.toneSemitones &&
        ((triad >> (((note % 12) + 12) % 12)) & 1) === 1;
      const expected = tone && cell >= 60 && cell < 150 ? 1 : 0;
      expect(map.selected[k], `band ${k} (${hz.toFixed(0)} Hz)`).toBe(expected);
      marked += expected;
    }
    expect(marked).toBeGreaterThan(10);
  });

  it('reads each channel’s own cells once unlinked', () => {
    const right = shaped(0);
    const processor = settled({ curves: curves(true, right) });
    expectDelays(
      processor,
      [shaped(1), right],
      true,
      () => 0,
      () => 0,
    );
  });

  it('pushes each LFO slot’s destination by depth × level, a shift by lfoShiftOctaves', () => {
    const processor = settled({
      curves: curves(false),
      lfoShape: 'square',
      lfoHz: 0.02,
      lfoDest1: 'delayShift',
      lfoDepth1: 0.5,
      lfoDest2: 'gainOffset',
      lfoDepth2: -0.25,
      lfoDest3: 'gainOffset',
      lfoDepth3: 0.5,
    });
    const lfo = processor.dsp.lfo.value;
    const map = processor.dsp.leftChannel.map;
    expect(Math.abs(lfo)).toBe(1);
    expect(map.delayShift).toBeCloseTo(0.5 * lfo * SPECTRE_DSP.lfoShiftOctaves, 9);
    expect(map.gainOffset).toBeCloseTo(0.25 * lfo, 9);
  });

  it('silences a band at gain 0 and takes the feedback as it is drawn', () => {
    const processor = settled({ curves: curves(false) });
    const map = processor.dsp.leftChannel.map;
    // DC sits at the axis's foot, where the gain cells are drawn at 0.
    expect(map.gain[0]).toBe(0);
    const top = processor.dsp.size / 2;
    expect(map.gain[top]).toBe(1);
    expect(map.feedback[top]).toBeCloseTo(shaped(2)[SPECTRE_CELLS - 1]!, 6);
  });

  it('snaps every band to the grid and keeps Scatter within its share', () => {
    const delay = { gain: spectreFlat(1), delay: spectreFlat(0.4), feedback: spectreFlat(0) };
    const grid = settled({ curves: curves(false), sync: true, division: '1/1', grid: '1/16' });
    const { hop } = grid.dsp;
    const step = (0.125 * RATE) / hop;
    const bands = grid.dsp.size / 2 + 1;
    for (const d of grid.dsp.leftChannel.map.delay.subarray(0, bands)) {
      const multiple = Math.round(Math.round(d / step) * step);
      expect(Math.abs(d - multiple)).toBeLessThanOrEqual(1);
    }
    const plain = settled({ curves: delay }).dsp.leftChannel.map.delay;
    const scattered = settled({ curves: delay, scatter: 0.5 }).dsp.leftChannel.map.delay;
    const full = (2 * RATE) / hop;
    let moved = 0;
    for (let k = 0; k < bands; k++) {
      const by = scattered[k]! - plain[k]!;
      expect(by).toBeGreaterThanOrEqual(-1);
      expect(by).toBeLessThanOrEqual(0.5 * full + 1);
      if (by > 1) moved++;
    }
    expect(moved).toBeGreaterThan(bands / 4);
  });
});
