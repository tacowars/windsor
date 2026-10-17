/**
 * Spectre's Shape generators (record `2026-10-17-spectre-drawn-cells`
 * decision 10): the waves run from base to base + amount with a period in
 * octaves; random repeats for a seed; Harmonics and Key mark the cells their
 * notes fall in; a shape writes only where its mask lets it.
 */
import { SPECTRE_AXIS_OCTAVES, SPECTRE_CELLS } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  cellMidi,
  cellOfMidi,
  generate,
  generatedInto,
  harmonicCells,
  keyCells,
  midiHz,
} from './spectreGenerators';
import type { SpectreShapeSettings } from './spectreGenerators';

const S: SpectreShapeSettings = {
  amount: 0.5,
  base: 0.2,
  period: 1,
  phase: 0,
  root: 36,
  count: 4,
  width: 1,
  seed: 3,
};
const C_MAJOR = { root: 0, offsets: [0, 2, 4, 5, 7, 9, 11] };
const perOctave = SPECTRE_CELLS / SPECTRE_AXIS_OCTAVES;

describe('the Shape generators', () => {
  it('runs each wave between base and base + amount, one cycle an octave', () => {
    for (const shape of ['sine', 'triangle', 'square', 'sawUp', 'sawDown'] as const) {
      const cells = generate(shape, S, C_MAJOR);
      expect(Math.min(...cells), shape).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(Math.max(...cells), shape).toBeLessThanOrEqual(0.7 + 1e-9);
    }
    const square = generate('square', S, C_MAJOR);
    expect(square[0]).toBe(0.7);
    expect(square[Math.round(0.75 * perOctave)]).toBe(0.2);
  });

  it('draws the same random cells for the same seed, and others for another', () => {
    expect(generate('random', S, C_MAJOR)).toEqual(generate('random', S, C_MAJOR));
    expect(generate('random', S, C_MAJOR)).not.toEqual(
      generate('random', { ...S, seed: 4 }, C_MAJOR),
    );
  });

  it('marks the harmonics of the root, and every note of the key', () => {
    const cells = harmonicCells(36, 4);
    expect(cells[0]).toBe(cellOfMidi(36));
    expect(cells[1]).toBe(cellOfMidi(48));
    const harmonics = generate('harmonics', S, C_MAJOR);
    expect(harmonics[cellOfMidi(36)]).toBe(0.7);
    expect(harmonics.filter((v) => v === 0.7).length).toBe(4);
    const key = new Set(keyCells(C_MAJOR));
    expect(key.has(cellOfMidi(60))).toBe(true);
    expect(key.has(cellOfMidi(61))).toBe(false);
  });

  it('places a note in the cell its frequency falls in', () => {
    const a4 = cellOfMidi(69);
    expect(Math.abs(cellMidi(a4) - 69)).toBeLessThan(0.5);
    expect(midiHz(69)).toBe(440);
  });

  it('writes a shape only where the mask lets it', () => {
    const mask = Array.from({ length: SPECTRE_CELLS }, (_, i) => i < 10);
    const out = generatedInto(
      new Array<number>(SPECTRE_CELLS).fill(0),
      new Array(SPECTRE_CELLS).fill(1),
      mask,
    );
    expect(out.slice(8, 12)).toEqual([1, 1, 0, 0]);
  });
});
