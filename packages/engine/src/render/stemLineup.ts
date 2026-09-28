/**
 * Whether two stem passes line up (windsor#41): every pass renders the
 * master on channels 0–1, so a later pass's master is compared with the
 * first's, sample by sample.
 *
 * Not bit for bit. The stems themselves come out bit-identical from pass to
 * pass in Chrome, but the master does not: Chrome sums a node's inputs in an
 * order it does not fix, and the master's input sums three or more sources
 * (the dry bus and each return), so float rounding differs from render to
 * render — by up to 1.0e-6 between two renders of the same song
 * (docs/research/2026-09-29-stem-render-accuracy). So the check is the
 * largest absolute difference at any one frame, against
 * `RENDER_STEM_LINEUP_TOLERANCE`. A pass that drifted, by a whole quantum or
 * a single frame, moves real audio against itself, and the difference at the
 * moved samples is of the order of the audio, not of rounding.
 */
import { RENDER_STEM_LINEUP_TOLERANCE } from './renderConstants';

/**
 * The largest |a − b| over every frame of every channel; `Infinity` when the
 * two differ in channel count or length, which no lined-up pass can.
 */
export function masterDrift(a: readonly Float32Array[], b: readonly Float32Array[]): number {
  if (a.length !== b.length) return Infinity;
  let drift = 0;
  for (let c = 0; c < a.length; c++) {
    const x = a[c]!;
    const y = b[c]!;
    if (x.length !== y.length) return Infinity;
    for (let i = 0; i < x.length; i++) drift = Math.max(drift, Math.abs(x[i]! - y[i]!));
  }
  return drift;
}

/** Whether `master` is `reference` to within `tolerance` at every frame. */
export function linesUp(
  reference: readonly Float32Array[],
  master: readonly Float32Array[],
  tolerance: number = RENDER_STEM_LINEUP_TOLERANCE,
): boolean {
  return masterDrift(reference, master) <= tolerance;
}
