/**
 * The Filter insert's run for `workletAllocationProbe.ts` (windsor#622), in
 * the Phaser's pattern (`phaserChangeScenario.ts`): a cycle of steps, each a
 * whole setting (every mode, both slopes, the mix's ends and between, the
 * insert switched off and on) applied at its first quantum and then held,
 * with a short silence at its end, so the filter rests and wakes. A step may
 * also sweep the cutoff, a new value every quantum, geometrically from one
 * end of its range to the other, so the glide runs its pow in every piece.
 * Each step names its input as it arrives in Chrome: stereo, mono (the right
 * channel follows the left) or none (an inactive source has no channels).
 * The warm-up plays the cycle whole several times, the load meter on for its
 * first cycle, and the measured run plays it once more. The probe imports
 * this by path in its child Node, which runs it directly (its types are
 * stripped), so it imports nothing at run time but Node's own `node:v8`.
 *
 * The warm-up ends by reading the heap as the probe's measured run does, so
 * V8 compiles that reading's own code before the measurement rather than
 * inside it.
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

/** What a step feeds the node's one input. */
export type FilterInput = 'stereo' | 'mono' | 'none';

export interface FilterChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
  input: FilterInput;
  /** A cutoff swept from the first value to the second over the step, a new value each quantum. */
  sweep?: [number, number];
}

export interface FilterChangeConfig {
  steps: FilterChangeStep[];
  /** Quanta each step plays. */
  period: number;
  /** Quanta of silence at the end of each step. */
  quiet: number;
}

/** Each input kind's buffers, built once from the rig's noise: nothing here allocates while it runs. */
function inputs(probe: ProbeRig): Record<FilterInput | 'quiet', Float32Array[][]> {
  const [program] = probe.sound;
  const [silent] = probe.quiet;
  return {
    stereo: [program!],
    mono: [[program![0]!]],
    none: [[]],
    quiet: [silent!],
  };
}

export default function filterChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as FilterChangeConfig;
  const { params } = probe;
  const { period, steps } = config;
  const feeds = inputs(probe);
  // Preallocated: each change's parameter arrays and values, its sweep and its input.
  const arrays = steps.map((step) => step.names.map((name) => params[name]!));
  const values = steps.map((step) => Float32Array.from(step.values));
  const sweepFrom = Float64Array.from(steps, (step) => step.sweep?.[0] ?? 0);
  const sweepRatio = Float64Array.from(steps, (step) =>
    step.sweep ? step.sweep[1] / step.sweep[0] : 0,
  );
  const cutoff = params.cutoff!;
  const feed = steps.map((step) => feeds[step.input]);
  const cycle = steps.length * period;
  const apply = (q: number): void => {
    const step = Math.floor(q / period) % steps.length;
    const at = q % period;
    if (sweepRatio[step]! > 0) cutoff[0] = sweepFrom[step]! * sweepRatio[step]! ** (at / period);
    if (at !== 0) return;
    const into = arrays[step]!,
      to = values[step]!;
    for (let i = 0; i < into.length; i++) into[i]![0] = to[i]!;
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
