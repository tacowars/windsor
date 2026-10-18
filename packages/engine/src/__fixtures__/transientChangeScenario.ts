/**
 * The Transient's run for `workletAllocationProbe.ts` (record
 * `2026-10-18-transient-insert`), on the compressor's pattern: a cycle of
 * steps, each a whole setting (Attack, Sustain, Output, Mix and the switch)
 * applied at its first quantum and then held while the controls glide and
 * settle, with a silence at its end long enough for the insert to sleep and
 * the next step to wake it; the measured run throws unless it took both.
 * Each step also names its input, as the node's input arrives in Chrome:
 * stereo, mono or none (an inactive source has no channels), and whether
 * the card's meter is on. The warm-up plays the cycle whole several times,
 * the load meter on for its first cycle, and the measured run plays it once
 * more, so it measures code already hot. The probe imports this by path in
 * its child Node, which runs it directly (its types are stripped), so it
 * imports nothing at run time but Node's own `node:v8`.
 *
 * The warm-up ends by reading the heap as the probe's measured run does, as
 * `compressorChangeScenario.ts` explains: without it, the reading's own code
 * reaches V8's baseline tier inside the measured run.
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

/** What a step feeds the node's input. */
export type TransientInput = 'stereo' | 'mono' | 'none';

export interface TransientChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
  input: TransientInput;
  /** The gain meter (the card's `meter` message) on for this step. */
  meter: boolean;
}

export interface TransientChangeConfig {
  steps: TransientChangeStep[];
  /** Quanta each step plays: long enough for every control to settle. */
  period: number;
  /** Quanta of silence at the end of each step: long enough to fall asleep. */
  quiet: number;
}

/** Each input kind's buffers, built once from the rig's noise: nothing here allocates while it runs. */
function inputs(probe: ProbeRig): Record<TransientInput | 'quiet', Float32Array[][]> {
  const [program] = probe.sound;
  const [silent] = probe.quiet;
  return {
    stereo: [program!],
    mono: [[program![0]!]],
    none: [[]],
    quiet: [silent!],
  };
}

export default function transientChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as TransientChangeConfig;
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
  const dsp = (probe.processor as unknown as { dsp: { asleep: boolean } }).dsp;
  const { warmup, measure } = probe.config;
  // Whether a quantum ended asleep, and whether one woke, since the warm-up.
  let slept = false,
    woke = false;
  // Quanta [from, to). The warm-up and the measured run call this same function.
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      apply(q);
      const quiet = q % period >= period - config.quiet;
      const was = dsp.asleep;
      probe.render(q, quiet ? feeds.quiet : feed[Math.floor(q / period) % steps.length]!);
      if (dsp.asleep) slept = true;
      else if (was) woke = true;
    }
    if (to === warmup + measure && !(slept && woke)) {
      throw new Error(`the measured run did not sleep and wake: ${slept} ${woke}`);
    }
  };
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
      slept = woke = false;
    },
    drive,
  };
}
