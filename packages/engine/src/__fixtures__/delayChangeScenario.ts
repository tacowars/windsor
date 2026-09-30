/**
 * The Dub delay's run for `workletAllocationProbe.ts` (windsor#232): a cycle
 * of steps, each a set of parameter changes applied at its first quantum and
 * then held while the controls glide, with a short silence at its end so the
 * repeats ring on alone. The test builds the steps (every mode, the insert
 * switched off and on, feedback past unity, the filters and drive at their
 * bounds, and song tempo changes, which reach the processor as new `leftMs`
 * and `rightMs` through `tempoInsertRegistry.ts`). Each step also names its
 * input: stereo, mono (the processor reads the one channel on both sides) or
 * none (an inactive source has no channels). The warm-up plays the cycle
 * whole several times, the load meter on for its first cycle, and the
 * measured run plays it once more, so it measures code already hot. The probe
 * imports this by path in its child Node, which runs it directly (its types
 * are stripped), so it imports nothing at run time but Node's own `node:v8`.
 *
 * The warm-up ends by reading the heap as the probe's measured run does, so
 * V8 compiles that reading's own code before the measurement rather than in
 * it (found on the Compressor, windsor#229).
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

/** What a step feeds the processor's one input. */
export type DelayInput = 'stereo' | 'mono' | 'none';

export interface DelayChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
  input: DelayInput;
}

export interface DelayChangeConfig {
  steps: DelayChangeStep[];
  /** Quanta each step plays. */
  period: number;
  /** Quanta of silence at the end of each step (the repeats alone). */
  quiet: number;
}

/** Each input kind's buffers, built once from the rig's noise: nothing here allocates while it runs. */
function inputs(probe: ProbeRig): Record<DelayInput | 'quiet', Float32Array[][]> {
  const [program] = probe.sound;
  return {
    stereo: [program!],
    mono: [[program![0]!]],
    none: [[]],
    quiet: probe.quiet,
  };
}

export default function delayChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as DelayChangeConfig;
  const { params } = probe;
  const { period, steps } = config;
  const feeds = inputs(probe);
  // Preallocated: each change's parameter array and value, and its input.
  const arrays = steps.map((step) => step.names.map((name) => params[name]!));
  const values = steps.map((step) => Float32Array.from(step.values));
  const feed = steps.map((step) => feeds[step.input]);
  const cycle = steps.length * period;
  const apply = (q: number): void => {
    if (q % period !== 0) return;
    const step = (q / period) % steps.length;
    const at = arrays[step]!,
      to = values[step]!;
    for (let i = 0; i < at.length; i++) at[i]![0] = to[i]!;
  };
  // Quanta [from, to). The warm-up and the measured run call this same function.
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      apply(q);
      const quiet = q % period >= period - config.quiet;
      probe.render(q, quiet ? feeds.quiet : feed[Math.floor(q / period) % steps.length]!);
    }
  };
  const { warmup } = probe.config;
  return {
    warm: () => {
      if (warmup % cycle !== 0)
        throw new Error(`warm-up ${warmup} is not whole cycles of ${cycle}`);
      // The load meter on for the first cycle, so its path is hot, then the measured cadence.
      probe.report(64);
      // In chunks of a step, so `drive` itself is optimised whole and not only
      // mid-loop (on-stack replacement), as the measured run calls it.
      for (let q = 0; q < warmup; q += period) {
        if (q === cycle) probe.report(probe.config.loadQuanta);
        drive(q, q + period);
      }
      for (let r = 0; r < WARM_READS; r++) v8.getHeapStatistics();
    },
    drive,
  };
}
