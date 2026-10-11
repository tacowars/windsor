/**
 * bloom's run for `workletAllocationProbe.ts`: every path its render takes,
 * over and over. A cycle is stereo noise with one control toggled every
 * `period` quanta (every control, the inert levers included, so a lever that
 * comes alive is already exercised; the switch twice, so it fades out, goes
 * dormant and comes back); then silence with every control at its default
 * until bloom sleeps, and `inputs` quanta more asleep; then mono noise,
 * which wakes it, and no input, for `inputs` quanta each. The probe imports
 * it by path in its child Node, which runs it directly (its types are
 * stripped), so it imports nothing at run time.
 *
 * The silence follows bloom's own state, not a fixed schedule, so a retuned
 * tunable cannot starve it. At the end of the measured run it throws,
 * failing the probe, unless that run took every path in `PATHS`.
 */
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

export interface BloomChangeConfig {
  /** Quanta between control changes while the noise plays. */
  period: number;
  /** Quanta of stereo noise, with changes, in each cycle. */
  loud: number;
  /** Quanta asleep, then of mono noise, then of no input, in each cycle. */
  inputs: number;
}

/** The DSP's fields the run reads (`BloomDsp`). */
interface BloomState {
  asleep: boolean;
  dormant: boolean;
  output: { level: number; targetLevel: number };
  envelope: { soundingCount: number };
}

/** Each change toggles one control between its default and this value, in turn. */
const TOGGLES: [string, number][] = [
  ['amount', 0.3],
  ['mix', 1],
  ['swell', 2],
  ['sustain', 4],
  ['enabled', 0],
  ['freeze', 1],
  ['spread', 1],
  ['shape', 3.5],
  ['bright', -6],
  ['octave', 12],
  ['octave', -12],
  ['octave', 7],
  ['key', 5],
  ['scale', 2],
  ['low', 55],
  ['high', 70],
  ['focus', 1.8],
  ['density', 1],
  ['enabled', 0],
];

/** Awake, asleep, woken, dormant, the switch fading, bands sounding, mono, no input. */
const PATHS = 8;

type Phase = 'loud' | 'quiet' | 'asleep' | 'mono' | 'none';

function notePaths(dsp: BloomState, phase: Phase, wasAsleep: boolean, seen: Uint8Array): void {
  seen[dsp.asleep ? 1 : 0] = 1;
  if (wasAsleep && !dsp.asleep) seen[2] = 1;
  if (dsp.dormant) seen[3] = 1;
  if (dsp.output.level !== dsp.output.targetLevel) seen[4] = 1;
  if (dsp.envelope.soundingCount > 0) seen[5] = 1;
  if (phase === 'mono') seen[6] = 1;
  if (phase === 'none') seen[7] = 1;
}

function bloomCycle(probe: ProbeRig, config: BloomChangeConfig) {
  const { params, quiet, sound } = probe;
  const dsp = (probe.processor as unknown as { dsp: BloomState }).dsp;
  const arrays = TOGGLES.map(([name]) => params[name]!);
  // Float32, as the parameter arrays are, so a toggle compares like with like.
  const others = Float32Array.from(TOGGLES, ([, value]) => value);
  const defaults = Float32Array.from(arrays, (values) => values[0]!);
  const mono = [[sound[0]![0]!]];
  const none: Float32Array[][] = [];
  const seen = new Uint8Array(PATHS);
  let phase: Phase = 'loud';
  let left = config.loud;
  let change = 0;
  let wasAsleep = false;

  const toggle = (): void => {
    const k = change++ % TOGGLES.length;
    const values = arrays[k]!;
    values[0] = values[0] === others[k] ? defaults[k]! : others[k]!;
  };
  const hush = (): void => {
    for (let k = 0; k < arrays.length; k++) arrays[k]![0] = defaults[k]!;
  };
  const step = (q: number): Float32Array[][] => {
    if (phase === 'loud') {
      if (q % config.period === 0) toggle();
      if (--left > 0) return sound;
      phase = 'quiet';
      hush();
      return quiet;
    }
    if (phase === 'quiet') {
      if (!dsp.asleep) return quiet;
      phase = 'asleep';
      left = config.inputs;
    }
    if (--left > 0) return phase === 'asleep' ? quiet : phase === 'mono' ? mono : none;
    if (phase === 'asleep' || phase === 'mono') {
      phase = phase === 'asleep' ? 'mono' : 'none';
      left = config.inputs;
      return phase === 'mono' ? mono : none;
    }
    phase = 'loud';
    left = config.loud;
    return none;
  };
  const note = (): void => {
    notePaths(dsp, phase, wasAsleep, seen);
    wasAsleep = dsp.asleep;
  };
  return { step, note, seen };
}

export default function bloomChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as BloomChangeConfig;
  const { step, note, seen } = bloomCycle(probe, config);
  const { warmup, measure } = probe.config;
  // Quanta [from, to). The measured run calls this same function, so it measures code already hot.
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      probe.render(q, step(q));
      note();
    }
    if (to === warmup + measure && seen.includes(0)) {
      throw new Error(`the measured run missed a path: ${seen.join(' ')}`);
    }
  };
  const chunk = config.period * 16;
  const chunks = (from: number, to: number): void => {
    for (let q = from; q < to; q += chunk) drive(q, Math.min(to, q + chunk));
  };
  return {
    warm: () => {
      // The load meter reports for the first half of the warm-up, then takes
      // the measured cadence (off): a report reads Date.now() twice a quantum.
      probe.report(64);
      chunks(0, warmup / 2);
      probe.report(probe.config.loadQuanta);
      chunks(warmup / 2, warmup);
      seen.fill(0);
    },
    drive,
  };
}
