/**
 * The plate's run for `workletAllocationProbe.ts` (windsor#227): every path
 * its render takes, over and over. A cycle is noise in, with one parameter
 * changed every `period` quanta (a SIZE glide each way, HOLD on and off, the
 * decay, the filters, the modulation, the pre-delay, the diffusions, wet and
 * dry), then silence at a short decay until the plate falls asleep, `asleep`
 * quanta asleep, and the noise again, which wakes it. The probe imports it by
 * path in its child Node, which runs it directly (its types are stripped), so
 * it imports nothing at run time.
 *
 * The run follows the plate's own state, not a fixed schedule, so a retuned
 * sleep floor cannot starve it: the silence lasts until the plate sleeps. At
 * the end of the measured run it throws, failing the probe, unless that run
 * glided, settled, held, slept and woke, so the reading covers each.
 */
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

export interface ReverbChangeConfig {
  /** Quanta between parameter changes while the noise plays. */
  period: number;
  /** Quanta of noise, with changes, in each cycle. */
  loud: number;
  /** Quanta the plate stays asleep before the noise wakes it. */
  asleep: number;
  /** The decay the silence runs at, so the tail sleeps in a second or two. */
  quietDecay: number;
}

/** The plate's state the run reads (fields of `DattorroReverb`). */
interface PlateState {
  _asleep: boolean;
  _stepping: boolean;
}

/**
 * Each change toggles one parameter between its default and this value, in
 * turn. SIZE is listed twice so a glide runs up and back down between other
 * changes, and HOLD toggles twice per pass.
 */
const TOGGLES: [string, number][] = [
  ['size', 2.5],
  ['hold', 1],
  ['decay', 0.9],
  ['tankHighCut', 2500],
  ['size', 2.5],
  ['modRate', 3],
  ['modDepth', 2],
  ['hold', 1],
  ['preDelay', 0.25],
  ['inputLowCut', 200],
  ['inputHighCut', 3000],
  ['tankLowCut', 120],
  ['diffusionIn1', 0.5],
  ['diffusionIn2', 0.4],
  ['diffusionTank1', 0.8],
  ['diffusionTank2', 0.8],
  ['wet', 0.4],
  ['dry', 0.5],
];

type Phase = 'loud' | 'quiet' | 'asleep';

/** The cycle, one quantum at a time, and what it has passed through. */
interface Cycle {
  /** Quantum `q`'s input, after any change it makes. */
  step(q: number): Float32Array[][];
  /** After quantum `q` renders: record the paths the plate is on. */
  note(): void;
  /** Glided, settled, held, slept, woke: 1 once seen. */
  seen: Uint8Array;
}

function plateCycle(probe: ProbeRig, config: ReverbChangeConfig): Cycle {
  const { params, sound, quiet } = probe;
  const plate = probe.processor as unknown as PlateState;
  const arrays = TOGGLES.map(([name]) => params[name]!);
  // Float32, as the parameter arrays are, so a toggle compares like with like.
  const others = Float32Array.from(TOGGLES, ([, value]) => value);
  const defaults = Float32Array.from(arrays, (values) => values[0]!);
  const decay = params.decay!;
  const hold = params.hold!;
  const decayDefault = decay[0]!;
  const seen = new Uint8Array(5);
  let phase: Phase = 'loud';
  let left = config.loud;
  let change = 0;

  const toggle = (): void => {
    const k = change++ % TOGGLES.length;
    const values = arrays[k]!;
    values[0] = values[0] === others[k] ? defaults[k]! : others[k]!;
  };
  const step = (q: number): Float32Array[][] => {
    if (phase === 'loud') {
      if (q % config.period === 0) toggle();
      if (--left > 0) return sound;
      // Into the silence: HOLD off and a short decay, or the tail never sleeps.
      phase = 'quiet';
      hold[0] = 0;
      decay[0] = config.quietDecay;
      return quiet;
    }
    if (phase === 'quiet') {
      if (plate._asleep) {
        phase = 'asleep';
        left = config.asleep;
      }
      return quiet;
    }
    if (--left > 0) return quiet;
    phase = 'loud';
    left = config.loud;
    decay[0] = decayDefault;
    return sound;
  };
  const note = (): void => {
    if (plate._stepping) seen[0] = 1;
    else if (!plate._asleep) seen[1] = 1;
    if (hold[0] === 1) seen[2] = 1;
    if (plate._asleep) seen[3] = 1;
    if (seen[3] === 1 && phase === 'loud' && !plate._asleep) seen[4] = 1;
  };
  return { step, note, seen };
}

export default function reverbChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as ReverbChangeConfig;
  const { step, note, seen } = plateCycle(probe, config);
  const { warmup, measure } = probe.config;
  // Quanta [from, to). The measured run calls this same function, so it
  // measures code already hot.
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      probe.render(q, step(q));
      note();
    }
    if (to === warmup + measure && seen.includes(0)) {
      throw new Error(
        `the measured run missed a path (glided, settled, held, slept, woke): ${seen.join(' ')}`,
      );
    }
  };
  const chunk = config.period * 16;
  const chunks = (from: number, to: number): void => {
    for (let q = from; q < to; q += chunk) drive(q, Math.min(to, q + chunk));
  };
  return {
    warm: () => {
      // The warm-up runs the load meter for its first half, then sets the
      // measured cadence (off, 0): a load report reads Date.now() twice a
      // quantum, and V8 returns each as a new heap number.
      probe.report(64);
      chunks(0, warmup / 2);
      probe.report(probe.config.loadQuanta);
      chunks(warmup / 2, warmup);
      seen.fill(0);
    },
    drive,
  };
}
