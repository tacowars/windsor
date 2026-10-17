/**
 * Spectre's log-frequency axis (record `2026-10-16-spectre-insert`), for the
 * card's drawing and the tests: where a frequency sits on it, the frequency
 * at a point, and what a gain value means. A curve's read is
 * `spectreCells.ts`'s `spectreCellRead`.
 */
import { SPECTRE_DSP } from './spectreConstants';

/** The axis's span in octaves. */
export const SPECTRE_AXIS_OCTAVES = Math.log2(SPECTRE_DSP.axisHighHz / SPECTRE_DSP.axisLowHz);

/** Where `hz` sits on the axis, 0..1. */
export function spectreAxisAt(hz: number): number {
  if (hz <= SPECTRE_DSP.axisLowHz) return 0;
  return Math.min(1, Math.log2(hz / SPECTRE_DSP.axisLowHz) / SPECTRE_AXIS_OCTAVES);
}

/** The frequency at axis position `x`. */
export const spectreAxisHz = (x: number): number =>
  SPECTRE_DSP.axisLowHz * 2 ** (x * SPECTRE_AXIS_OCTAVES);

/** A gain curve value as dB: 0 dB at 1, `−gainRangeDb` just above 0, silence (−∞) at 0. */
export const spectreGainDb = (value: number): number =>
  value <= 0 ? -Infinity : (value - 1) * SPECTRE_DSP.gainRangeDb;
