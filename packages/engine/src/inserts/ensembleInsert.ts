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
 *   per rate r (slow, fast):  sinᵣ ─▶ depth ─┬▶ × cos φᵢ ─▶ lineᵢ.delayTime
 *                             cosᵣ ─▶ depth ─┴▶ × sin φᵢ ─▶ lineᵢ.delayTime
 *
 * **Phase lock by a sine-and-cosine basis** (decision 6): per rate, one sine
 * and one cosine oscillator (both `PeriodicWave`s, so they share the one
 * implementation path) start together and always take the same frequency, so
 * they stay in quadrature through any rate change; line i's LFO is
 * `cos φᵢ · sin θ + sin φᵢ · cos θ = sin(θ + φᵢ)` through two fixed-weight
 * gains. The three lines are 0°, 120° and 240° apart by construction — the
 * case staggered starts would lose on the first rate change.
 *
 * The wet input is the mono sum of the strip's stereo input, as on the
 * hardware; the dry path stays stereo. Width places the lines left / centre /
 * right with an equal-power law, and the wet gain divides by the per-side sum
 * of those gains so Width moves the image, not the level.
 *
 * `set` is param writes only: the line count and the weights are the kind's.
 * `dispose` stops all four oscillators and disconnects what the stage built,
 * never the edge out of `output`.
 */
import type { InsertKind, InsertStage } from './insertKind';
import {
  ENSEMBLE_DSP,
  ENSEMBLE_LINE_PANS,
  ENSEMBLE_LINE_PHASES_DEG,
  ENSEMBLE_NAME,
} from './ensembleConstants';
import type { EnsembleSpec } from './ensembleSpec';
import { DEFAULT_ENSEMBLE, ENSEMBLE_FIELDS, normaliseEnsemble } from './ensembleSpec';

const { millisecondsPerSecond: MS, degreesPerTurn, panQuarterTurn } = ENSEMBLE_DSP;

/** One rate's quadrature pair and the depth gain after each. */
interface Basis {
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
  const sin = oscillator(context, [0, 0], [0, 1]);
  const cos = oscillator(context, [0, 1], [0, 0]);
  const sinDepth = context.createGain();
  const cosDepth = context.createGain();
  sin.connect(sinDepth);
  cos.connect(cosDepth);
  return { sin, cos, sinDepth, cosDepth };
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

/** Param writes only: the rates to both oscillators of a pair at once, so they stay in quadrature. */
function write({ lines, bases: [slow, fast], tone, wet, dry }: Params, next: EnsembleSpec): void {
  for (const [b, rate, depth] of [
    [slow, next.slowRate, next.slowDepth],
    [fast, next.fastRate, next.fastDepth],
  ] as const) {
    b.sin.frequency.value = rate;
    b.cos.frequency.value = rate;
    b.sinDepth.gain.value = depth / MS;
    b.cosDepth.gain.value = depth / MS;
  }
  let perSide = 0;
  lines.forEach((l, i) => {
    l.delay.delayTime.value = next.delay / MS;
    const { left, right } = panGains(next.width * (ENSEMBLE_LINE_PANS[i] ?? 0));
    l.toLeft.gain.value = left;
    l.toRight.gain.value = right;
    perSide += left;
  });
  tone.frequency.value = next.tone;
  const mix = next.enabled ? next.mix : 0;
  wet.gain.value = mix / perSide;
  dry.gain.value = 1 - mix;
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
  const oscillators = [slow.sin, slow.cos, fast.sin, fast.cos];
  for (const osc of oscillators) osc.start();

  const set = (next: EnsembleSpec): void =>
    write({ lines, bases: [slow, fast], tone, wet, dry }, next);
  set(spec);

  const built: AudioNode[] = [
    input,
    split,
    mono,
    merge,
    tone,
    wet,
    dry,
    ...lines.flatMap((l) => [l.delay, l.toLeft, l.toRight]),
    ...[slow, fast].flatMap((b) => [b.sin, b.cos, b.sinDepth, b.cosDepth]),
    ...weights,
  ];
  return {
    kind: ENSEMBLE_NAME,
    input,
    output,
    set,
    dispose(): void {
      for (const osc of oscillators) osc.stop();
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
