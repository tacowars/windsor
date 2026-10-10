/**
 * The Retro reverb's run for `workletAllocationProbe.ts` (windsor#230): every
 * path its render takes, over and over. A cycle is stereo noise with one
 * parameter changed every `period` quanta (size, decay, tone, diffusion, drift
 * depth and rate, pre-delay, character, mix, duration, early, density, the gated
 * and reverse modes and the enable, so the finite field, the early taps, the
 * line taps, the pre-delay line, the mix glide, the
 * switch's fade and its cleared, dormant off (windsor#630) all run),
 * then silence at a short decay with every parameter back at its default
 * until the tail has decayed to exact zeros, the finite field has faded out,
 * the pre-delay is off and the mix has settled; then mono noise and no input
 * for `inputs` quanta each; then stereo noise for `flicker` quanta with Drift
 * depth switching between 0 and `flickerDepth` every quantum, so the tank's
 * detune delays are refilled on every other block. The probe imports it by path in its child Node,
 * which runs it directly (its types are stripped), so it imports nothing at
 * run time: the DSP's constants it compares against come in its config.
 *
 * The silence follows the reverb's own state, not a fixed schedule, so a
 * retuned tunable cannot starve it. At the end of the measured run it throws,
 * failing the probe, unless that run took every path in `PATHS`.
 */
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

export interface RetroReverbChangeConfig {
  /** Quanta between parameter changes while the noise plays. */
  period: number;
  /** Quanta of stereo noise, with changes, in each cycle. */
  loud: number;
  /** Quanta of mono noise, then of no input, in each cycle. */
  inputs: number;
  /** Quanta of Drift depth switching on and off, in each cycle. */
  flicker: number;
  /** A depth within the snap floor of 0, so the smoothed depth lands on it, and back, in one block. */
  flickerDepth: number;
  /** The decay the silence runs at, so the tail reaches zero in a second or two. */
  quietDecay: number;
  /** `RETRO_REVERB_DSP.silenceFloor`: the fade and snap threshold. */
  floor: number;
  /** `RETRO_REVERB_DSP.rate`: a pre-delay under one of its samples skips the line. */
  internalRate: number;
}

/** The DSP's fields the run reads (`RetroReverbDsp`). */
interface RetroState {
  finite: number;
  earlyLevel: number;
  preDelay: number;
  mix: number;
  targetMix: number;
  level: number;
  targetLevel: number;
  dormant: boolean;
  wetToneLeft: number;
  wetToneRight: number;
  tank: { density: number; sizeTicks: number };
}

/**
 * Each change toggles one parameter between its default and this value, in
 * turn. Mode is listed twice, so the finite field fades in, switches between
 * gated and reverse, and fades out when the silence sets it back to 0.
 */
const TOGGLES: [string, number][] = [
  ['mode', 1],
  ['size', 2.4],
  ['preDelay', 0.12],
  ['decay', 6],
  ['tone', 1500],
  ['mode', 2],
  ['diffusion', 0.2],
  ['driftDepth', 0.8],
  ['character', 0.1],
  ['enabled', 0],
  ['mix', 0.8],
  ['duration', 0.55],
  ['early', 0.8],
  ['driftRate', 3],
  ['density', 0.7],
  ['enabled', 0],
];

/**
 * Finite field, reverb alone, pre-delay line, pre-delay off, tail at zero, mix gliding, mix settled,
 * mono, no input, the switch fading, switched off and dormant, the early taps, Drift switching on
 * and off, the line taps, the line taps placed on every tick of a Size move.
 */
const PATHS = 15;

/** No input. */
const none: Float32Array[][] = [];

type Phase = 'loud' | 'quiet' | 'mono' | 'none' | 'flicker';

/** The cycle, one quantum at a time, and the paths it has passed through. */
interface Cycle {
  /** Quantum `q`'s input, after any change it makes. */
  step(q: number): Float32Array[][];
  /** After a quantum renders: record the paths the reverb is on. */
  note(): void;
  seen: Uint8Array;
}

/** The tail is exact zeros, the finite field has faded, the pre-delay is off and the mix is still. */
function settled(dsp: RetroState, config: RetroReverbChangeConfig): boolean {
  return (
    dsp.finite <= config.floor &&
    dsp.preDelay < 1 / config.internalRate &&
    dsp.wetToneLeft === 0 &&
    dsp.wetToneRight === 0 &&
    dsp.mix === dsp.targetMix
  );
}

/** The paths in `PATHS` that a phase alone marks. */
const PHASE_PATHS: Partial<Record<Phase, number>> = { mono: 7, none: 8, flicker: 12 };

/** After a quantum renders: record the paths the reverb is on. */
function notePaths(
  seen: Uint8Array,
  dsp: RetroState,
  phase: Phase,
  config: RetroReverbChangeConfig,
): void {
  seen[dsp.finite > config.floor ? 0 : 1] = 1;
  seen[dsp.preDelay < 1 / config.internalRate ? 3 : 2] = 1;
  if (dsp.wetToneLeft === 0 && dsp.wetToneRight === 0) seen[4] = 1;
  seen[dsp.mix === dsp.targetMix ? 6 : 5] = 1;
  const path = PHASE_PATHS[phase];
  if (path !== undefined) seen[path] = 1;
  if (dsp.level !== dsp.targetLevel) seen[9] = 1;
  if (dsp.dormant) seen[10] = 1;
  if (dsp.earlyLevel > config.floor) seen[11] = 1;
  if (dsp.tank.density !== 0) seen[13] = 1;
  // A Size move ran with Density on: a ramp counts its ticks down to 0, a held Size never starts,
  // and the taps were placed on each of them.
  if (dsp.tank.density !== 0 && dsp.tank.sizeTicks === 0 && !dsp.dormant) seen[14] = 1;
}

function retroCycle(probe: ProbeRig, config: RetroReverbChangeConfig): Cycle {
  const { params, sound, quiet } = probe;
  const dsp = (probe.processor as unknown as { dsp: RetroState }).dsp;
  const arrays = TOGGLES.map(([name]) => params[name]!);
  // Float32, as the parameter arrays are, so a toggle compares like with like.
  const others = Float32Array.from(TOGGLES, ([, value]) => value);
  const defaults = Float32Array.from(arrays, (values) => values[0]!);
  const decay = params.decay!;
  const decayDefault = decay[0]!;
  const depth = params.driftDepth!;
  const mono = [[sound[0]![0]!]];
  const seen = new Uint8Array(PATHS);
  let phase: Phase = 'loud';
  let left = config.loud;
  let change = 0;

  const toggle = (): void => {
    const k = change++ % TOGGLES.length;
    arrays[k]![0] = arrays[k]![0] === others[k] ? defaults[k]! : others[k]!;
  };
  // Every parameter at its default, the decay short: the tail runs down to zero.
  const hush = (): void => {
    for (let k = 0; k < arrays.length; k++) arrays[k]![0] = defaults[k]!;
    decay[0] = config.quietDecay;
  };
  // Drift's depth from exactly 0 to on and back, a block each: the detune delays' refill.
  const flicker = (): Float32Array[][] => {
    if (--left > 0) {
      depth[0] = depth[0] === 0 ? config.flickerDepth : 0;
      return sound;
    }
    depth[0] = 0;
    phase = 'loud';
    left = config.loud;
    return none;
  };
  const step = (q: number): Float32Array[][] => {
    if (phase === 'flicker') return flicker();
    if (phase === 'loud') {
      if (q % config.period === 0) toggle();
      if (--left > 0) return sound;
      phase = 'quiet';
      hush();
      return quiet;
    }
    if (phase === 'quiet') {
      if (!settled(dsp, config)) return quiet;
      phase = 'mono';
      left = config.inputs;
      decay[0] = decayDefault;
    }
    if (--left > 0) return phase === 'mono' ? mono : none;
    if (phase === 'mono') {
      phase = 'none';
      left = config.inputs;
      return mono;
    }
    phase = 'flicker';
    left = config.flicker;
    return none;
  };
  const note = (): void => notePaths(seen, dsp, phase, config);
  return { step, note, seen };
}

export default function retroReverbChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as RetroReverbChangeConfig;
  const { step, note, seen } = retroCycle(probe, config);
  const { warmup, measure } = probe.config;
  // Quanta [from, to). The measured run calls this same function, so it
  // measures code already hot.
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
