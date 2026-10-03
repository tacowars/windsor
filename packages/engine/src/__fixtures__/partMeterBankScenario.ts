/**
 * The part meter bank's run for `workletAllocationProbe.ts` (windsor#540): a
 * cycle of steps, each feeding the sixteen inputs one way for `period`
 * quanta (every part stereo, mono, without channels, silent, or a mix of
 * the four), with a latch reset on one slot and a clear on another at each
 * step's first quantum, as the main thread posts them. Every buffer and
 * message is built here before the run, so whatever the heap gains is the
 * processor's. The bank's report goes to the probe's port, which keeps
 * nothing; in the browser the port's clone is the post's own allocation.
 * The probe imports this by path in its child Node, which runs it directly
 * (its types are stripped), so it imports nothing at run time but `node:v8`.
 */
import v8 from 'node:v8';
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

/** Heap reads at the end of the warm-up: enough for V8 to compile the reading. */
const WARM_READS = 64;

/** What a step feeds each part's input. */
export type BankFeed = 'stereo' | 'mono' | 'none' | 'quiet' | 'mixed';

export interface BankChangeConfig {
  parts: number;
  feeds: BankFeed[];
  /** Quanta each step plays. */
  period: number;
}

const EACH: readonly Exclude<BankFeed, 'mixed'>[] = ['stereo', 'mono', 'none', 'quiet'];

/** One quantum's inputs for every part, built once per feed. */
function inputs(probe: ProbeRig, parts: number, feed: BankFeed): Float32Array[][] {
  const [program] = probe.sound;
  const [quiet] = probe.quiet;
  const one = (kind: Exclude<BankFeed, 'mixed'>): Float32Array[] =>
    kind === 'stereo'
      ? [program![0]!, program![1]!]
      : kind === 'mono'
        ? [program![0]!]
        : kind === 'none'
          ? []
          : [quiet![0]!, quiet![1]!];
  return Array.from({ length: parts }, (_, k) =>
    one(feed === 'mixed' ? EACH[k % EACH.length]! : feed),
  );
}

export default function partMeterBankScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as BankChangeConfig;
  const { period, feeds, parts } = config;
  const steps = feeds.map((feed) => inputs(probe, parts, feed));
  // Preallocated: each step's two messages, as the main thread would post them.
  const resets = feeds.map((_, i) => ({ data: { type: 'reset', slot: (i * 3) % parts, seq: 0 } }));
  const clears = feeds.map((_, i) => ({ data: { type: 'clear', slot: (i * 5) % parts, seq: 0 } }));
  const port = probe.processor.port;
  let seq = 0;
  const cycle = feeds.length * period;
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      const step = Math.floor(q / period) % feeds.length;
      if (q % period === 0) {
        resets[step]!.data.seq = ++seq;
        port.onmessage!(resets[step]!);
        clears[step]!.data.seq = ++seq;
        port.onmessage!(clears[step]!);
      }
      probe.render(q, steps[step]!);
    }
  };
  const { warmup } = probe.config;
  return {
    warm: () => {
      if (warmup % cycle !== 0)
        throw new Error(`warm-up ${warmup} is not whole cycles of ${cycle}`);
      // In chunks of a step, so `drive` itself is optimised whole, as the measured run calls it.
      for (let q = 0; q < warmup; q += period) drive(q, q + period);
      for (let r = 0; r < WARM_READS; r++) v8.getHeapStatistics();
    },
    drive,
  };
}
