/**
 * Spectre's cell edits (record `2026-10-17-spectre-drawn-cells` decision 10):
 * brushes write one channel's cells (both while linked); a Draw stroke leaves
 * no gap however fast it moves; Push and Smooth fade toward the brush's
 * edges; transforms keep to the selection; the copies, Link and Steps
 * switches and the selection gestures do what the workbench says they do.
 */
import { DEFAULT_SPECTRE, SPECTRE_CELLS, spectreFlatCells } from '@windsor/engine';
import type { SpectreSpec } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { applyTransform } from './spectreBenchTransforms';
import {
  brushSpan,
  drawStroke,
  editedCells,
  eraseAt,
  flipCells,
  levelled,
  nudgeCells,
  pushAt,
  selectCells,
  smoothAt,
  snappedTo,
  transformMask,
  withCells,
  withCurveSwitch,
} from './spectreCellEdits';

const flat = spectreFlatCells(0.5);
const ALL = new Array<boolean>(SPECTRE_CELLS).fill(true);

describe('the brushes', () => {
  it('spans `width` cells round the centre, held to the axis', () => {
    expect(brushSpan(10, 1)).toEqual([10, 10]);
    expect(brushSpan(10, 3)).toEqual([9, 11]);
    expect(brushSpan(10, 4)).toEqual([9, 12]);
    expect(brushSpan(0, 5)).toEqual([0, 2]);
    expect(brushSpan(SPECTRE_CELLS - 1, 5)).toEqual([SPECTRE_CELLS - 3, SPECTRE_CELLS - 1]);
  });

  it('draws every cell between two pointer positions, along the line between their values', () => {
    const out = drawStroke(flat, { cell: 10, value: 0 }, { cell: 20, value: 1 }, 1);
    for (let i = 10; i <= 20; i++) expect(out[i]).toBeCloseTo((i - 10) / 10, 9);
    expect(out[9]).toBe(0.5);
    expect(out[21]).toBe(0.5);
  });

  it('pushes and smooths most at the centre and not at all past the brush', () => {
    const pushed = pushAt(flat, 50, 5, 0.2);
    expect(pushed[50]).toBeCloseTo(0.7, 9);
    expect(pushed[48]! - 0.5).toBeGreaterThan(0);
    expect(pushed[48]! - 0.5).toBeLessThan(0.2);
    expect(pushed[44]).toBe(0.5);
    const spike = flat.map((v, i) => (i === 50 ? 1 : v));
    const smoothed = smoothAt(spike, 50, 3, 1);
    expect(smoothed[50]).toBeLessThan(1);
    expect(smoothed[40]).toBe(0.5);
  });

  it('erases to the lane’s rest', () => {
    expect(eraseAt(flat, 'gain', 5, 1)[5]).toBe(1);
    expect(eraseAt(flat, 'delay', 5, 1)[5]).toBe(0);
  });

  it('snaps to Levels and to the grid', () => {
    expect(levelled(0.4, 0)).toBe(0.4);
    expect(levelled(0.4, 2)).toBe(0);
    expect(levelled(0.4, 5)).toBe(0.5);
    expect(snappedTo(0.3, 0.125)).toBe(0.25);
    expect(snappedTo(0.3, 0)).toBe(0.3);
  });
});

describe('writing cells', () => {
  it('writes both channels while linked, one side once unlinked, stored to the song’s precision', () => {
    const cells = flat.map((v, i) => (i === 3 ? 0.12345 : v));
    const linked = withCells(DEFAULT_SPECTRE, 'delay', 1, cells);
    expect(linked.curves.delay.left[3]).toBe(0.123);
    expect(linked.curves.delay.right).toBeUndefined();
    const unlinked = withCurveSwitch(DEFAULT_SPECTRE, 'delay', 'link', false);
    expect(unlinked.curves.delay.right).toEqual(DEFAULT_SPECTRE.curves.delay.left);
    const right = withCells(unlinked, 'delay', 1, flat);
    expect(editedCells(right, 'delay', 1)).toEqual(flat);
    expect(editedCells(right, 'delay', 0)).toEqual(DEFAULT_SPECTRE.curves.delay.left);
    const relinked = withCurveSwitch(right, 'delay', 'link', true);
    expect(relinked.curves.delay).toEqual({
      left: DEFAULT_SPECTRE.curves.delay.left,
      link: true,
      steps: DEFAULT_SPECTRE.curves.delay.steps,
    });
  });
});

describe('the selection and the transforms', () => {
  const withSelection = (spec: SpectreSpec, from: number, to: number) =>
    selectCells(spec, from, to, 'replace');

  it('replaces, adds to and takes from the selection, in either direction', () => {
    const a = withSelection(DEFAULT_SPECTRE, 20, 10);
    expect(a.selection).toEqual([[10, 21]]);
    const b = selectCells(a, 40, 45, 'add');
    expect(b.selection).toEqual([
      [10, 21],
      [40, 46],
    ]);
    expect(selectCells(b, 12, 18, 'remove').selection).toEqual([
      [10, 12],
      [19, 21],
      [40, 46],
    ]);
  });

  it('acts on every cell with nothing selected, else on the selection only', () => {
    expect(transformMask(DEFAULT_SPECTRE)).toEqual(ALL);
    const spec = withSelection(
      {
        ...DEFAULT_SPECTRE,
        curves: { ...DEFAULT_SPECTRE.curves, gain: { left: flat, link: true, steps: false } },
      },
      5,
      9,
    );
    const out = applyTransform(spec, 'invert', { curve: 'gain', channel: 0, grid: 0, levels: 0 });
    expect(out.curves.gain.left[5]).toBe(0.5);
    const ramp = Array.from({ length: SPECTRE_CELLS }, (_, i) => i / SPECTRE_CELLS);
    const flipped = flipCells(ramp, transformMask(withSelection(DEFAULT_SPECTRE, 5, 9)));
    expect(flipped.slice(5, 10)).toEqual([9, 8, 7, 6, 5].map((i) => ramp[i]));
    expect(flipped[4]).toBe(ramp[4]);
    expect(nudgeCells(ramp, ALL, 1)[10]).toBe(ramp[9]);
  });

  it('quantizes the delay lane to the grid and the others to Levels', () => {
    const spec = withCells(
      DEFAULT_SPECTRE,
      'delay',
      0,
      flat.map(() => 0.3),
    );
    const delay = applyTransform(spec, 'quantize', {
      curve: 'delay',
      channel: 0,
      grid: 0.125,
      levels: 0,
    });
    expect(delay.curves.delay.left[0]).toBe(0.25);
    const gain = applyTransform(
      withCells(
        spec,
        'gain',
        0,
        flat.map(() => 0.3),
      ),
      'quantize',
      {
        curve: 'gain',
        channel: 0,
        grid: 0.125,
        levels: 3,
      },
    );
    expect(gain.curves.gain.left[0]).toBe(0.5);
  });

  it('copies one channel onto the other only while unlinked', () => {
    expect(
      applyTransform(DEFAULT_SPECTRE, 'copyLR', { curve: 'delay', channel: 0, grid: 0, levels: 0 }),
    ).toBe(DEFAULT_SPECTRE);
    const unlinked = withCells(
      withCurveSwitch(DEFAULT_SPECTRE, 'delay', 'link', false),
      'delay',
      1,
      flat,
    );
    const copied = applyTransform(unlinked, 'copyRL', {
      curve: 'delay',
      channel: 0,
      grid: 0,
      levels: 0,
    });
    expect(copied.curves.delay.left).toEqual(flat);
    expect(copied.curves.delay.right).toEqual(flat);
  });
});
