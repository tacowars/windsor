/**
 * Spectre's Shape-row transforms (record `2026-10-17-spectre-drawn-cells`
 * decision 10), pure: each writes one lane of the channel being edited,
 * within the selection (or everywhere when nothing is selected), except the
 * two copies, which write a whole channel's curve onto the other while the
 * curve is unlinked (linked, the channels are one already). Quantize snaps the delay
 * lane to the grid and the others to Levels.
 */
import type { SpectreCurve, SpectreSpec } from '@windsor/engine';
import {
  editedCells,
  flipCells,
  invertCells,
  nudgeCells,
  quantizeCells,
  resetCells,
  smoothCells,
  transformMask,
  withCells,
} from './spectreCellEdits';
import type { SpectreChannel } from './spectreCellEdits';
import type { SpectreTransform } from './spectreBenchTables';

/** Levels' fallback step for Quantize when Levels is off: eighths. */
const QUANTIZE_LEVELS = 9;

/** Where a transform writes: the lane and channel, and the grid and Levels Quantize snaps to. */
export interface SpectreTransformTarget {
  readonly curve: SpectreCurve;
  readonly channel: SpectreChannel;
  /** The grid's step on the delay lane, a share of full scale; 0 off. */
  readonly grid: number;
  readonly levels: number;
}

/** `spec` with transform `id` applied to the target's lane and channel. */
export function applyTransform(
  spec: SpectreSpec,
  id: SpectreTransform,
  { curve, channel, grid, levels }: SpectreTransformTarget,
): SpectreSpec {
  if (id === 'copyLR' || id === 'copyRL') {
    const from = spec.curves[curve];
    if (from.link) return spec;
    const source = id === 'copyLR' ? from.left : (from.right ?? from.left);
    return withCells(spec, curve, id === 'copyLR' ? 1 : 0, source);
  }
  const cells = editedCells(spec, curve, channel);
  const mask = transformMask(spec);
  const next = (() => {
    switch (id) {
      case 'smooth':
        return smoothCells(cells, mask);
      case 'quantize': {
        const steps = levels >= 2 ? levels : QUANTIZE_LEVELS;
        return quantizeCells(cells, mask, curve === 'delay' && grid > 0 ? grid : 1 / (steps - 1));
      }
      case 'flip':
        return flipCells(cells, mask);
      case 'invert':
        return invertCells(cells, mask);
      case 'left':
        return nudgeCells(cells, mask, -1);
      case 'right':
        return nudgeCells(cells, mask, 1);
      default:
        return resetCells(cells, mask, curve);
    }
  })();
  return withCells(spec, curve, channel, next);
}
