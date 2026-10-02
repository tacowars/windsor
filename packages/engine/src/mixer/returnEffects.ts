/**
 * The two effects the returns run, built once here and shared with the
 * inserts that run the same DSP on a strip (windsor#171): the plate
 * (`returnBus.ts`'s `room`, the Plate reverb insert) and the delay loop
 * (`echo`, the Echo insert). One builder each, so a return and its insert
 * cannot drift apart.
 *
 * The delay's loop, with its soft clip (#647):
 *
 *   input ─▶ delay ─▶ damp (lowpass, resonance) ─┬─▶ output
 *              ▲                                 │
 *              └── clip ◀── clipIn ◀── feedback ◀┘
 *
 * The damping resonance lifts the loop gain above 1 at `damp` once feedback
 * is high: a wanted runaway. The clip bounds what re-enters the line, so a
 * runaway settles into a saturated tone instead of growing to the limiter.
 */
import {
  DELAY_CLIP_CEILING,
  DELAY_CLIP_CURVE_POINTS,
  DELAY_CLIP_RANGE,
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
} from '../audioConstants';
import { REVERB_PROCESSOR_NAME } from '../synth/workletMessages';
import type { ReverbSpace } from './reverbSpace';
import { tanhCurve } from './tanhCurve';

/** What the delay loop is set by: the echo return's and the Echo insert's shared fields. */
export interface DelayLineSettings {
  /** Seconds. */
  readonly delayTime: number;
  /** Loop gain; clamped to `DELAY_FEEDBACK_MAX`. */
  readonly feedback: number;
  /** Hz: the lowpass in the loop. */
  readonly damp: number;
  /** The lowpass's `Q`, in dB. */
  readonly resonance: number;
}

/** The loop's nodes. `effect` is the line itself; the rest close the cycle. */
export interface DelayLine {
  readonly effect: DelayNode;
  readonly feedback: GainNode;
  readonly damp: BiquadFilterNode;
  readonly clipIn: GainNode;
  readonly clip: WaveShaperNode;
}

/** The plate's own mix: `wet` scales the tank, `dry` the input it passes. */
export interface PlateMix {
  readonly wet: number;
  readonly dry: number;
}

/** The return's mix: the tank alone, the amount set by the send. */
export const PLATE_FULLY_WET: PlateMix = { wet: 1, dry: 0 };

/**
 * `ceiling·tanh(x / ceiling)` over x in ±`DELAY_CLIP_RANGE`·ceiling, sampled
 * for a `WaveShaperNode` whose input is pre-scaled into [-1, 1]. Built once.
 */
export function delayClipCurve(): Float32Array<ArrayBuffer> {
  return tanhCurve(DELAY_CLIP_RANGE, DELAY_CLIP_CURVE_POINTS, DELAY_CLIP_CEILING);
}

/**
 * Feedback delay with a resonant damping lowpass and a soft clip in the loop:
 * the repeats darken, and a runaway saturates rather than grows. Wires
 * `input` into the line and the damped line into `output`.
 */
export function attachDelay(
  context: BaseAudioContext,
  input: AudioNode,
  output: AudioNode,
  spec: DelayLineSettings,
): DelayLine {
  const delay = context.createDelay(DELAY_MAX_SECONDS);
  const feedback = context.createGain();
  const damp = context.createBiquadFilter();
  const clipIn = context.createGain();
  const clip = context.createWaveShaper();

  damp.type = 'lowpass';
  // The curve's x axis spans ±RANGE·ceiling; this maps it onto the shaper's [-1, 1].
  clipIn.gain.value = 1 / (DELAY_CLIP_RANGE * DELAY_CLIP_CEILING);
  clip.curve = delayClipCurve();
  // Aliasing from the clip re-enters the loop on every pass and accumulates.
  clip.oversample = '2x';
  const line = { effect: delay, feedback, damp, clipIn, clip };
  writeDelay(line, spec);

  input.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(clipIn);
  clipIn.connect(clip);
  clip.connect(delay);
  damp.connect(output);
  return line;
}

/** The loop's fields, in the order `writeDelay` writes them. */
export const DELAY_LINE_FIELDS = ['delayTime', 'feedback', 'damp', 'resonance'] as const;

/**
 * One field's param on the loop and the value `writeDelay` gives it: the
 * feedback clamped to `DELAY_FEEDBACK_MAX`, the rest as they are. The Echo
 * insert's lanes (windsor#345) write through it too.
 */
export function delayLineParam(
  line: DelayLine,
  field: keyof DelayLineSettings,
): { readonly param: AudioParam; readonly value: (v: number) => number } {
  if (field === 'delayTime') return { param: line.effect.delayTime, value: (v) => v };
  if (field === 'feedback') {
    return { param: line.feedback.gain, value: (v) => Math.min(DELAY_FEEDBACK_MAX, v) };
  }
  if (field === 'damp') return { param: line.damp.frequency, value: (v) => v };
  return { param: line.damp.Q, value: (v) => v };
}

/** Param writes onto the loop; an absent field is left as it is. */
export function writeDelay(line: DelayLine, delay: Partial<DelayLineSettings>): void {
  for (const field of DELAY_LINE_FIELDS) {
    const value = delay[field];
    if (value === undefined) continue;
    const target = delayLineParam(line, field);
    target.param.value = target.value(value);
  }
}

/** Disconnect every node of the loop, or the cycle stays wired after its owner goes. */
export function disconnectDelay(line: DelayLine): void {
  for (const node of [line.effect, line.damp, line.feedback, line.clipIn, line.clip]) {
    node.disconnect();
  }
}

/**
 * The plate worklet, set to `space` at `mix`, unwired. Requires
 * `FmEngine.init()` to have loaded the reverb module.
 */
export function createPlate(
  context: BaseAudioContext,
  space: ReverbSpace,
  mix: PlateMix,
): AudioWorkletNode {
  const plate = new AudioWorkletNode(context, REVERB_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const now = context.currentTime;
  for (const [name, value] of Object.entries({ ...space, ...mix })) {
    plate.parameters.get(name)?.setValueAtTime(value, now);
  }
  return plate;
}

/** Param writes onto the plate: any space field, `wet` or `dry`; an absent one is left as it is. */
export function writePlate(
  plate: AudioWorkletNode,
  values: Partial<ReverbSpace> | Partial<PlateMix>,
): void {
  for (const [param, value] of Object.entries(values)) {
    const target = plate.parameters.get(param);
    if (target && value !== undefined) target.value = value as number;
  }
}
