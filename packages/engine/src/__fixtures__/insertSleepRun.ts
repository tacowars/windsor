/**
 * The sleep tests' run (windsor#793): a shipped insert processor fed a block
 * at a time, its stereo output joined and whether its DSP slept after each
 * block. The retro reverb's, the phaser's, the delay's and the compressor's
 * `*Sleep.test.ts` drive their harness's processor through it, one with the
 * sleep and one built with `sleep: false`, and compare the two.
 */

export const QUANTUM = 128;

/** What the run reads: the shipped processor and its DSP's sleep flag. */
export interface SleepingProcessor {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
  dsp: { asleep: boolean };
}

export interface SleepRun {
  left: Float32Array;
  right: Float32Array;
  /** Whether the DSP was asleep after each block. */
  asleep: boolean[];
}

/** Seeded full-scale noise, stereo, `blocks` quanta long. */
export function noise(blocks: number, seed = 1): Float32Array[] {
  let state = seed;
  const channel = (): Float32Array =>
    Float32Array.from({ length: blocks * QUANTUM }, () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 31 - 1;
    });
  return [channel(), channel()];
}

/** Stereo silence, `blocks` quanta long. */
export function silence(blocks: number): Float32Array[] {
  return [new Float32Array(blocks * QUANTUM), new Float32Array(blocks * QUANTUM)];
}

/** Stereo pieces one after another. */
export function join(...pieces: Float32Array[][]): Float32Array[] {
  return [0, 1].map((c) => {
    const joined = new Float32Array(pieces.reduce((n, piece) => n + piece[c]!.length, 0));
    let at = 0;
    for (const piece of pieces) {
      joined.set(piece[c]!, at);
      at += piece[c]!.length;
    }
    return joined;
  });
}

/** `source` (zeros past its end) through `processor` for `blocks` quanta. */
export function runBlocks(
  processor: SleepingProcessor,
  params: Record<string, Float32Array>,
  source: Float32Array[],
  blocks: number,
): SleepRun {
  const run: SleepRun = {
    left: new Float32Array(blocks * QUANTUM),
    right: new Float32Array(blocks * QUANTUM),
    asleep: [],
  };
  for (let b = 0; b < blocks; b++) {
    const input = source.map((channel) => {
      const block = new Float32Array(QUANTUM);
      block.set(channel.subarray(b * QUANTUM, (b + 1) * QUANTUM));
      return block;
    });
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    processor.process([input], [out], params);
    run.left.set(out[0]!, b * QUANTUM);
    run.right.set(out[1]!, b * QUANTUM);
    run.asleep.push(processor.dsp.asleep);
  }
  return run;
}

/** The largest difference between two runs' samples from block `from` on. */
export function largestDifference(a: SleepRun, b: SleepRun, from = 0): number {
  let largest = 0;
  for (let i = from * QUANTUM; i < a.left.length; i++) {
    largest = Math.max(
      largest,
      Math.abs(a.left[i]! - b.left[i]!),
      Math.abs(a.right[i]! - b.right[i]!),
    );
  }
  return largest;
}

/** The largest sample of a run from block `from` on. */
export function peakFrom(run: SleepRun, from: number): number {
  let peak = 0;
  for (let i = from * QUANTUM; i < run.left.length; i++) {
    peak = Math.max(peak, Math.abs(run.left[i]!), Math.abs(run.right[i]!));
  }
  return peak;
}

/** One leg of `runLegs`: `source` through the processor for `blocks` quanta at `params`. */
export interface SleepLeg {
  params: Record<string, Float32Array>;
  source: Float32Array[];
  blocks: number;
}

/** `legs` through `processor` one after another, as one run: a control change between legs. */
export function runLegs(processor: SleepingProcessor, legs: SleepLeg[]): SleepRun {
  const runs = legs.map((leg) => runBlocks(processor, leg.params, leg.source, leg.blocks));
  const [left, right] = join(...runs.map((run) => [run.left, run.right]));
  return { left: left!, right: right!, asleep: runs.flatMap((run) => run.asleep) };
}
