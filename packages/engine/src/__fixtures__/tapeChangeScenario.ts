/**
 * Tape's run for `workletAllocationProbe.ts` (windsor#228): a cycle of steps,
 * each a whole setting applied at its first quantum and then held while the
 * controls glide and settle, with a short silence at its end. The steps
 * switch the magnetic core between 2x and 4x, change the model, Bias, Drive,
 * the Wear macro and the split dials, the rates, hiss, trim and the seed, and
 * take Mix down to dry and the insert off and on, and set, sweep and clear the
 * song's core controls (windsor#291). Each step also names its
 * input, as the node's input arrives in Chrome: stereo, mono (the right
 * channel follows the left) or none (an inactive source has no channels).
 * The warm-up plays the cycle whole several times, the load meter on for its
 * first cycle, and the measured run plays it once more, so it measures code
 * already hot. The probe imports this by path in its child Node, which runs
 * it directly (its types are stripped), so it imports nothing at run time but
 * Node's own `node:v8`.
 *
 * The warm-up ends by reading the heap as the probe's measured run does, so
 * V8 compiles that reading's own code before the measurement rather than
 * inside it (as `phaserChangeScenario.ts`).
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

/** What a step feeds the node's one input. */
export type TapeInput = 'stereo' | 'mono' | 'none';

export interface TapeChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
  input: TapeInput;
  /**
   * Parameters this step then moves a quantum at a time (windsor#291's knob sweeps): from their
   * value in `values` to `to`, index for index, linearly over the step's quanta before its silence.
   */
  sweep?: { names: string[]; to: number[] };
}

export interface TapeChangeConfig {
  steps: TapeChangeStep[];
  /** Quanta each step plays: long enough for every control to settle. */
  period: number;
  /** Quanta of silence at the end of each step. */
  quiet: number;
}

/** Each input kind's buffers, built once from the rig's noise: nothing here allocates while it runs. */
function inputs(probe: ProbeRig): Record<TapeInput | 'quiet', Float32Array[][]> {
  const [program] = probe.sound;
  const [silent] = probe.quiet;
  return {
    stereo: [program!],
    mono: [[program![0]!]],
    none: [[]],
    quiet: [silent!],
  };
}

export default function tapeChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as TapeChangeConfig;
  const { params } = probe;
  const { period, steps } = config;
  const feeds = inputs(probe);
  // Preallocated: each change's parameter arrays and values, and its input.
  const arrays = steps.map((step) =>
    step.names.map((name) => {
      const array = params[name];
      if (!array) throw new Error(`tape has no parameter ${name}`);
      return array;
    }),
  );
  const values = steps.map((step) => Float32Array.from(step.values));
  const feed = steps.map((step) => feeds[step.input]);
  const cycle = steps.length * period;
  // A sweep's parameter arrays, and its start and end values, as doubles.
  const sweepArrays = steps.map((step) => (step.sweep?.names ?? []).map((name) => params[name]!));
  const sweepFrom = steps.map((step) =>
    Float64Array.from(step.sweep?.names ?? [], (name) => step.values[step.names.indexOf(name)]!),
  );
  const sweepTo = steps.map((step) => Float64Array.from(step.sweep?.to ?? []));
  const moving = period - config.quiet;
  // Integer arithmetic only, and no double but a sweep's value, which goes straight to its
  // parameter: the probe measures this code's heap along with the processor's.
  const apply = (q: number): void => {
    const k = q % period,
      step = ((q - k) / period) % steps.length;
    if (k === 0) {
      const at = arrays[step]!,
        to = values[step]!;
      for (let i = 0; i < at.length; i++) at[i]![0] = to[i]!;
    }
    const sweep = sweepArrays[step]!;
    if (sweep.length === 0 || k >= moving) return;
    const from = sweepFrom[step]!,
      to = sweepTo[step]!;
    for (let i = 0; i < sweep.length; i++)
      sweep[i]![0] = from[i]! + ((to[i]! - from[i]!) * k) / (moving - 1);
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
