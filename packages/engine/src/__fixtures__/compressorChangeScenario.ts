/**
 * The Compressor's run for `workletAllocationProbe.ts` (windsor#229): a cycle
 * of steps, each a whole setting (every attack, release and ratio, the
 * detector highpass off and on, range, makeup, dry/wet, bypass, the external
 * key) applied at its first quantum and then held while the controls glide
 * and settle, with a short silence at its end. Each step also names its
 * input, as the node's two inputs arrive in Chrome: stereo, mono, none (an
 * inactive source has no channels) or stereo with a stereo key on the second
 * input, and whether the gain-reduction meter is on. The warm-up plays the
 * cycle whole several times, the load meter on for its first cycle, and the
 * measured run plays it once more, so it measures code already hot. The probe
 * imports this by path in its child Node, which runs it directly (its types
 * are stripped), so it imports nothing at run time but Node's own `node:v8`.
 *
 * The warm-up ends by reading the heap as the probe's measured run does. In
 * this run, without it, V8 compiled that reading's own code to its baseline
 * tier during the measured run's eighth window, about 7 KB of code in every
 * run on the M1, which is the probe's, not the processor's: with
 * `--no-sparkplug`, or with these reads, the run reads only the readings'
 * result objects.
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

/** What a step feeds the node's two inputs: the program, and the key when there is one. */
export type CompressorInput = 'stereo' | 'mono' | 'none' | 'keyed';

export interface CompressorChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
  input: CompressorInput;
  /** The gain-reduction meter (the card's `meter` message) on for this step. */
  meter: boolean;
}

export interface CompressorChangeConfig {
  steps: CompressorChangeStep[];
  /** Quanta each step plays: long enough for every control to settle. */
  period: number;
  /** Quanta of silence at the end of each step (the release, silent input). */
  quiet: number;
}

/** Each input kind's buffers, built once from the rig's noise: nothing here allocates while it runs. */
function inputs(probe: ProbeRig): Record<CompressorInput | 'quiet', Float32Array[][]> {
  const [program] = probe.sound;
  const [silent] = probe.quiet;
  // The key: the program's noise reversed and 6 dB louder, so it differs from what it keys.
  const key = program!.map((channel) =>
    channel.map((_, i) => 2 * channel[channel.length - 1 - i]!),
  );
  return {
    stereo: [program!, []],
    mono: [[program![0]!], []],
    none: [[], []],
    keyed: [program!, key],
    quiet: [silent!, []],
  };
}

export default function compressorChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as CompressorChangeConfig;
  const { params } = probe;
  const { period, steps } = config;
  const feeds = inputs(probe);
  // Preallocated: each change's parameter array and value, its input and its meter message.
  const arrays = steps.map((step) => step.names.map((name) => params[name]!));
  const values = steps.map((step) => Float32Array.from(step.values));
  const feed = steps.map((step) => feeds[step.input]);
  const meters = steps.map((step) => ({ data: { type: 'meter', enabled: step.meter } }));
  const cycle = steps.length * period;
  const apply = (q: number): void => {
    if (q % period !== 0) return;
    const step = (q / period) % steps.length;
    const at = arrays[step]!,
      to = values[step]!;
    for (let i = 0; i < at.length; i++) at[i]![0] = to[i]!;
    probe.processor.port.onmessage!(meters[step]!);
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
