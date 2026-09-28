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
 *
 * A long song's master is tens of millions of samples, so the comparison
 * runs in chunks of `RENDER_STEM_LINEUP_CHUNK_FRAMES`, yielding to the event
 * loop and checking the signal between them, as the chunked WAV encoder
 * does: the progress keeps painting, and a Cancel lands mid-comparison.
 */
import { RENDER_STEM_LINEUP_CHUNK_FRAMES, RENDER_STEM_LINEUP_TOLERANCE } from './renderConstants';
import { throwIfAborted } from './renderPass';

export interface LineupOptions {
  /** Aborting rejects with the render's `AbortError` between chunks. */
  signal?: AbortSignal;
  /** Frames compared between yields; the shipped `RENDER_STEM_LINEUP_CHUNK_FRAMES` when absent. */
  chunkFrames?: number;
  /** How the comparison hands the event loop back between chunks; a macrotask when absent. */
  yieldToLoop?: () => Promise<void>;
}

/**
 * The largest |a − b| over every frame of every channel; `Infinity` when the
 * two differ in channel count or length, which no lined-up pass can.
 */
export async function masterDrift(
  a: readonly Float32Array[],
  b: readonly Float32Array[],
  options: LineupOptions = {},
): Promise<number> {
  const { signal, chunkFrames = RENDER_STEM_LINEUP_CHUNK_FRAMES, yieldToLoop = nextTask } = options;
  if (!Number.isInteger(chunkFrames) || chunkFrames <= 0) {
    throw new RangeError(`chunkFrames must be a positive integer, got ${chunkFrames}`);
  }
  if (a.length !== b.length) return Infinity;
  const frames = a[0]?.length ?? 0;
  if (a.some((x, c) => x.length !== frames || b[c]!.length !== frames)) return Infinity;
  let drift = 0;
  for (let from = 0; ; from += chunkFrames) {
    throwIfAborted(signal);
    if (from >= frames) return drift;
    const to = Math.min(frames, from + chunkFrames);
    for (let c = 0; c < a.length; c++) drift = Math.max(drift, driftIn(a[c]!, b[c]!, from, to));
    await yieldToLoop();
  }
}

/** Whether `master` is `reference` to within `tolerance` at every frame. */
export async function linesUp(
  reference: readonly Float32Array[],
  master: readonly Float32Array[],
  options: LineupOptions = {},
  tolerance: number = RENDER_STEM_LINEUP_TOLERANCE,
): Promise<boolean> {
  return (await masterDrift(reference, master, options)) <= tolerance;
}

function driftIn(x: Float32Array, y: Float32Array, from: number, to: number): number {
  let drift = 0;
  for (let i = from; i < to; i++) drift = Math.max(drift, Math.abs(x[i]! - y[i]!));
  return drift;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
