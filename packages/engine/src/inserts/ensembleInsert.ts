/**
 * The ensemble insert (#695): a Solina-style string ensemble in native nodes.
 * Three delay lines, each swept by the sum of a slow and a fast LFO, the
 * lines 120° apart; no AudioWorklet (decision 6).
 *
 *   input ─▶ split ─▶ mono (L+R)/2 ─▶ line₀ ─┬▶ pan L₀ ─▶ merge 0 ─┐
 *                                  ─▶ line₁ ─┤                     ├▶ tone ─▶ wet ─┬─▶ output
 *                                  ─▶ line₂ ─┴▶ pan R₂ ─▶ merge 1 ─┘              │
 *   input ─▶ dry ─────────────────────────────────────────────────────────────────┘
 *
 *   per rate r (slow, fast):  rateᵣ (constant source) ─▶ sinᵣ.frequency, cosᵣ.frequency
 *                             sinᵣ ─▶ depth ─┬▶ × cos φᵢ ─▶ lineᵢ.delayTime
 *                             cosᵣ ─▶ depth ─┴▶ × sin φᵢ ─▶ lineᵢ.delayTime
 *
 * **Phase lock by a sine-and-cosine basis** (decision 6): per rate, one sine
 * and one cosine oscillator (both `PeriodicWave`s, so they share the one
 * implementation path) start at one scheduled time and take their frequency
 * from one `ConstantSourceNode`, so a rate edit is a single param write that
 * reaches both on the same frame — two `.value` writes could straddle a render
 * quantum and leave a permanent phase error. Line i's LFO is
 * `cos φᵢ · sin θ + sin φᵢ · cos θ = sin(θ + φᵢ)` through two fixed-weight
 * gains, so the three lines are 0°, 120° and 240° apart by construction, at
 * any rate, with no start offset to compute from the rate.
 *
 * The wet input is the mono sum of the strip's stereo input, as on the
 * hardware; the dry path stays stereo. Width places the lines left / centre /
 * right with an equal-power law, and the wet gain divides by the per-side sum
 * of those gains, which holds the *coherent* level (lines in step) across
 * Width; with the lines modulated apart the summed power still rises a little
 * toward Width 1 (≈ 2 dB on noise at the defaults, per review).
 *
 * Off is Mix 0, the dry signal; a switch lane (windsor#628) writes the same
 * wet and dry gains, from the switch, Mix and Width together.
 *
 * `set` is param writes only: the line count and the weights are the kind's.
 * `dispose` stops all four oscillators and both rate sources, and disconnects what the stage built,
 * never the edge out of `output`.
 */
import type { KnobTarget } from '../automation/automationHandles';
import { sameValue } from '../automation/automationHandles';
import type { FieldHandles } from './insertFieldHandles';
import { fieldHandles, SWITCH_FIELD, switchOf } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import {
  ENSEMBLE_DSP,
  ENSEMBLE_LINE_PANS,
  ENSEMBLE_LINE_PHASES_DEG,
  ENSEMBLE_NAME,
} from './ensembleConstants';
import type { EnsembleSpec } from './ensembleSpec';
import {
  DEFAULT_ENSEMBLE,
  ENSEMBLE_FIELDS,
  type ENSEMBLE_NUMBERS,
  normaliseEnsemble,
} from './ensembleSpec';

const { millisecondsPerSecond: MS, degreesPerTurn, panQuarterTurn } = ENSEMBLE_DSP;

/** One rate's quadrature pair, the one source both take their frequency from, and a depth gain after each. */
interface Basis {
  readonly rate: ConstantSourceNode;
  readonly sin: OscillatorNode;
  readonly cos: OscillatorNode;
  readonly sinDepth: GainNode;
  readonly cosDepth: GainNode;
}

function oscillator(context: BaseAudioContext, real: number[], imag: number[]): OscillatorNode {
  const osc = context.createOscillator();
  const wave = context.createPeriodicWave(new Float32Array(real), new Float32Array(imag), {
    disableNormalization: true,
  });
  osc.setPeriodicWave(wave);
  return osc;
}

function basis(context: BaseAudioContext): Basis {
  const rate = context.createConstantSource();
  const sin = oscillator(context, [0, 0], [0, 1]);
  const cos = oscillator(context, [0, 1], [0, 0]);
  // One frequency signal into both: a rate edit is one param write, reaching
  // the pair on the same frame, so no render quantum can fall between them.
  for (const osc of [sin, cos]) {
    osc.frequency.value = 0;
    rate.connect(osc.frequency);
  }
  const sinDepth = context.createGain();
  const cosDepth = context.createGain();
  sin.connect(sinDepth);
  cos.connect(cosDepth);
  return { rate, sin, cos, sinDepth, cosDepth };
}

/** Line i's two fixed weights on one basis, wired into its delay time. */
function weigh(context: BaseAudioContext, b: Basis, phaseDeg: number, line: DelayNode): GainNode[] {
  const phi = (2 * Math.PI * phaseDeg) / degreesPerTurn;
  const onSin = context.createGain();
  const onCos = context.createGain();
  onSin.gain.value = Math.cos(phi);
  onCos.gain.value = Math.sin(phi);
  b.sinDepth.connect(onSin);
  b.cosDepth.connect(onCos);
  onSin.connect(line.delayTime);
  onCos.connect(line.delayTime);
  return [onSin, onCos];
}

interface Line {
  readonly delay: DelayNode;
  readonly toLeft: GainNode;
  readonly toRight: GainNode;
}

function line(context: BaseAudioContext, mono: GainNode, merge: ChannelMergerNode): Line {
  const delay = context.createDelay(ENSEMBLE_DSP.delayMaxSeconds);
  const toLeft = context.createGain();
  const toRight = context.createGain();
  mono.connect(delay);
  delay.connect(toLeft);
  delay.connect(toRight);
  toLeft.connect(merge, 0, 0);
  toRight.connect(merge, 0, 1);
  return { delay, toLeft, toRight };
}

/** Equal-power gains for a place in [−1, 1], exact at the ends: sin((1 ∓ p)·π/4). */
function panGains(place: number): { left: number; right: number } {
  return {
    left: Math.sin((1 - place) * panQuarterTurn),
    right: Math.sin((1 + place) * panQuarterTurn),
  };
}

/** What `set` writes to: every param a setting reaches, none of the wiring. */
interface Params {
  readonly lines: readonly Line[];
  readonly bases: readonly [Basis, Basis];
  readonly tone: BiquadFilterNode;
  readonly wet: GainNode;
  readonly dry: GainNode;
}

/** Each line's place at `width`, and the per-side sum of their gains the wet level divides by. */
function placeLines(lineCount: number, width: number): { gains: number[]; perSide: number } {
  const gains: number[] = [];
  let perSide = 0;
  for (let i = 0; i < lineCount; i++) {
    const { left, right } = panGains(width * (ENSEMBLE_LINE_PANS[i] ?? 0));
    gains.push(left, right);
    perSide += left;
  }
  return { gains, perSide };
}

/** The wet and dry gains at `mix`, switched `on` (1) or off (0), the wet over the lines' per-side sum. */
const mixGains = (mix: number, on: number, perSide: number): [number, number] => {
  const heard = on ? mix : 0;
  return [heard / perSide, 1 - heard];
};

/** What one field's lane writes, less the resting value. */
type Writes = Omit<KnobTarget, 'resting'>;

/** The pair of fields each rate's basis takes. */
const BASES = [
  ['slowRate', 'slowDepth'],
  ['fastRate', 'fastDepth'],
] as const;

/**
 * Param writes only: one write per rate, into the source both oscillators of
 * its pair follow. A field a lane holds (windsor#345) is left to it. The wet
 * and dry gains are shared (Width, Mix and the switch), so `writeShared`
 * writes them.
 */
function write(p: Params, next: EnsembleSpec, lane: (field: string) => boolean): void {
  const { lines, tone } = p;
  p.bases.forEach((b, i) => {
    const [rate, depth] = BASES[i]!;
    if (!lane(rate)) b.rate.offset.value = next[rate];
    if (lane(depth)) return;
    b.sinDepth.gain.value = next[depth] / MS;
    b.cosDepth.gain.value = next[depth] / MS;
  });
  const { gains } = placeLines(lines.length, next.width);
  lines.forEach((l, i) => {
    if (!lane('delay')) l.delay.delayTime.value = next.delay / MS;
    if (lane('width')) return;
    l.toLeft.gain.value = gains[2 * i]!;
    l.toRight.gain.value = gains[2 * i + 1]!;
  });
  if (!lane('tone')) tone.frequency.value = next.tone;
}

/**
 * Each knob's lane (windsor#345): a rate on its basis's source, a depth on
 * its basis's two gains, Delay on every line, Width on every line's place.
 * The wet gain (the mix over the width's per-side sum, while on) follows
 * Width, Mix and the switch (windsor#628), and the dry gain Mix and the
 * switch, each from every field's own value at every breakpoint any of them
 * has.
 */
function ensembleHandles(p: Params, spec: () => EnsembleSpec, now: () => number): FieldHandles {
  const { lines, bases } = p;
  const [slow, fast] = bases;
  const depthOn = (b: Basis): Writes => ({
    params: [b.sinDepth.gain, b.cosDepth.gain],
    write: (v) => [v / MS, v / MS],
  });
  const targets: Readonly<Record<string, Writes>> = {
    slowRate: { params: [slow.rate.offset], write: sameValue },
    slowDepth: depthOn(slow),
    fastRate: { params: [fast.rate.offset], write: sameValue },
    fastDepth: depthOn(fast),
    delay: { params: lines.map((l) => l.delay.delayTime), write: (v) => lines.map(() => v / MS) },
    tone: { params: [p.tone.frequency], write: sameValue },
    width: {
      params: lines.flatMap((l) => [l.toLeft.gain, l.toRight.gain]),
      write: (v) => placeLines(lines.length, v).gains,
    },
    // Mix and the switch write only the wet and dry gains, which they share.
    mix: { params: [], write: () => [] },
  };
  const wet = {
    params: [p.wet.gain],
    fields: ['width', 'mix', SWITCH_FIELD],
    value: (width: number, mix: number, on: number) =>
      mixGains(mix, on, placeLines(lines.length, width).perSide)[0],
  };
  const dry = {
    params: [p.dry.gain],
    fields: ['mix', SWITCH_FIELD],
    value: (mix: number, on: number) => mixGains(mix, on, 1)[1],
  };
  const target = (field: string): KnobTarget | undefined => {
    if (field === SWITCH_FIELD)
      return { params: [], write: () => [], resting: () => switchOf(spec()) };
    const writes = Object.hasOwn(targets, field) ? targets[field] : undefined;
    const resting = (): number => spec()[field as (typeof ENSEMBLE_NUMBERS)[number]];
    return writes && { ...writes, resting };
  };
  return fieldHandles(target, { params: [wet, dry], now });
}

/** The stage's settings and lanes over its params: `set` writes what no lane holds. */
function ensembleControls(
  params: Params,
  initial: EnsembleSpec,
): Required<Pick<InsertStage<EnsembleSpec>, 'set' | 'param'>> {
  let current = initial;
  const knobs = ensembleHandles(
    params,
    () => current,
    () => params.wet.context.currentTime,
  );
  return {
    set(next): void {
      current = next;
      write(params, next, knobs.automated);
      knobs.writeShared();
    },
    param: (field) => knobs.param(field),
  };
}

function create(context: BaseAudioContext, spec: EnsembleSpec): InsertStage<EnsembleSpec> {
  const input = context.createGain();
  const split = context.createChannelSplitter(2);
  const mono = context.createGain();
  const merge = context.createChannelMerger(2);
  const tone = context.createBiquadFilter();
  const wet = context.createGain();
  const dry = context.createGain();
  const output = context.createGain();

  input.connect(split);
  split.connect(mono, 0);
  split.connect(mono, 1);
  mono.gain.value = 1 / 2;
  const lines = ENSEMBLE_LINE_PHASES_DEG.map(() => line(context, mono, merge));
  const slow = basis(context);
  const fast = basis(context);
  const weights = lines.flatMap((l, i) =>
    [slow, fast].flatMap((b) => weigh(context, b, ENSEMBLE_LINE_PHASES_DEG[i] ?? 0, l.delay)),
  );
  tone.type = 'lowpass';
  tone.Q.value = ENSEMBLE_DSP.toneQDb;
  merge.connect(tone);
  tone.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);
  // One explicit start time for every source: a pair that began apart would
  // hold that offset forever, and its fixed weights would read it as phase.
  const sources = [slow.rate, fast.rate, slow.sin, slow.cos, fast.sin, fast.cos];
  const at = context.currentTime;
  for (const source of sources) source.start(at);

  const controls = ensembleControls({ lines, bases: [slow, fast], tone, wet, dry }, spec);
  controls.set(spec);

  const built: AudioNode[] = [
    input,
    split,
    mono,
    merge,
    tone,
    wet,
    dry,
    ...lines.flatMap((l) => [l.delay, l.toLeft, l.toRight]),
    ...[slow, fast].flatMap((b) => [b.rate, b.sin, b.cos, b.sinDepth, b.cosDepth]),
    ...weights,
  ];
  return {
    kind: ENSEMBLE_NAME,
    input,
    output,
    set: controls.set,
    param: controls.param,
    dispose(): void {
      for (const source of sources) source.stop();
      for (const node of built) node.disconnect();
    },
  };
}

export const ENSEMBLE_INSERT: InsertKind<EnsembleSpec> = {
  fields: ENSEMBLE_FIELDS,
  defaults: DEFAULT_ENSEMBLE,
  normalise: normaliseEnsemble,
  create,
};
