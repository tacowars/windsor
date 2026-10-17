/**
 * Spectre's run for `workletAllocationProbe.ts` (records
 * `2026-10-16-spectre-insert` and `2026-10-17-spectre-drawn-cells`), on the
 * Pump's pattern: a cycle of steps, each a whole setting (the analysis's
 * choices, every algorithm, the curves' moves, the LFO's slots, Freeze in
 * both modes, the switch) applied at its first quantum and then held, with a
 * short silence at its end. A step may also post messages at its start, as
 * the main thread does: a new cell payload, the scope, Listen. Each step
 * names its input as the node's one input arrives in Chrome: stereo, mono or
 * none (an inactive source has no channels). The warm-up plays the
 * cycle whole several times, the load meter on for its first cycle, and the
 * measured run plays it once more, so it measures code already hot. The
 * probe imports this by path in its child Node, which runs it directly (its
 * types are stripped), so it imports nothing at run time but Node's own
 * `node:v8`.
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

export type SpectreInput = 'stereo' | 'mono' | 'none';

export interface SpectreChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
  input: SpectreInput;
  /** Posted at the step's first quantum, in order; a `cells` payload as plain numbers. */
  messages?: { type: string; enabled?: boolean; cells?: number[] }[];
}

export interface SpectreChangeConfig {
  steps: SpectreChangeStep[];
  /** Quanta each step plays: long enough for a choice's rebuild and several frames. */
  period: number;
  /** Quanta of silence at the end of each step. */
  quiet: number;
}

export default function spectreChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as SpectreChangeConfig;
  const { params } = probe;
  const { period, steps } = config;
  const [program] = probe.sound;
  const [silent] = probe.quiet;
  const feeds: Record<SpectreInput | 'quiet', Float32Array[][]> = {
    stereo: [program!],
    mono: [[program![0]!]],
    none: [[]],
    quiet: [silent!],
  };
  // Preallocated: each change's parameter arrays and values, and its input.
  const arrays = steps.map((step) => step.names.map((name) => params[name]!));
  const values = steps.map((step) => Float32Array.from(step.values));
  const feed = steps.map((step) => feeds[step.input]);
  const posts = steps.map((step) =>
    (step.messages ?? []).map((m) => ({
      data: m.cells ? { type: m.type, cells: Float32Array.from(m.cells) } : m,
    })),
  );
  const cycle = steps.length * period;
  const apply = (q: number): void => {
    if (q % period !== 0) return;
    const step = (q / period) % steps.length;
    const at = arrays[step]!,
      to = values[step]!;
    for (let i = 0; i < at.length; i++) at[i]![0] = to[i]!;
    for (const post of posts[step]!) probe.processor.port.onmessage!(post);
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
      probe.report(64);
      for (let q = 0; q < warmup; q += period) {
        if (q === cycle) probe.report(probe.config.loadQuanta);
        drive(q, q + period);
      }
      for (let r = 0; r < WARM_READS; r++) v8.getHeapStatistics();
    },
    drive,
  };
}
