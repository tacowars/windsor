/**
 * Returns: destinations any part can feed through a send.
 *
 * A return is an effect run fully wet, with its own level, summed into the
 * master beside the dry buses. The amount each part contributes is a `send`
 * gain outside the effect, which is what lets several instruments share one
 * room and still sit in it at different depths -- and why turning a send to
 * zero silences that part's contribution without touching the tail of a part
 * still sending. Decision: docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md §1, §5.
 *
 *   send ─▶ return.input ─▶ [plate 100% wet | delay] ─▶ return.output (level) ─▶ master
 *
 * The plate cost about 1% of one core per instance rendering 60 s of audio
 * under Node 24 on an Apple M4 Pro -- a development machine, not the target,
 * so an order-of-magnitude sanity check and not a milestone result under
 * CLAUDE.md invariant 3. See docs/research/2026-08-31-52-dattorro-reverb/.
 */
import { DELAY_FEEDBACK_MAX, DELAY_MAX_SECONDS } from './audioConstants';
import type { DelayReturn, ReturnSpec, ReverbReturn } from './mix';
import { REVERB_PROCESSOR_NAME } from './workletMessages';

export interface ReturnBus {
  readonly name: string;
  readonly spec: ReturnSpec;
  /** Sends connect here. */
  readonly input: GainNode;
  /** Return gain, into the destination it was built for. */
  readonly output: GainNode;
  /** `output.gain`: how loud the room is. */
  readonly level: AudioParam;
  /** The plate worklet, or the delay line. */
  readonly effect: AudioWorkletNode | DelayNode;
  dispose(): void;
}

/**
 * Build one return into `destination`.
 *
 * A reverb return requires `FmEngine.init()` to have loaded the reverb module.
 */
export function createReturn(
  context: BaseAudioContext,
  name: string,
  spec: ReturnSpec,
  destination: AudioNode,
): ReturnBus {
  const input = context.createGain();
  const output = context.createGain();
  output.gain.value = spec.level;
  output.connect(destination);

  const effect =
    spec.kind === 'reverb'
      ? attachPlate(context, input, output, spec)
      : attachDelay(context, input, output, spec);

  return {
    name,
    spec,
    input,
    output,
    level: output.gain,
    effect,
    dispose(): void {
      input.disconnect();
      effect.disconnect();
      output.disconnect();
    },
  };
}

/** Build every return in `specs`, keyed as given. */
export function createReturns<N extends string>(
  context: BaseAudioContext,
  specs: Readonly<Record<N, ReturnSpec>>,
  destination: AudioNode,
): Readonly<Record<N, ReturnBus>> {
  const returns = {} as Record<N, ReturnBus>;
  for (const name of Object.keys(specs) as N[]) {
    returns[name] = createReturn(context, name, specs[name], destination);
  }
  return returns;
}

/**
 * A send: one gain from `source` into a return. Tap the part's output -- which
 * is post-fader by construction and pre-pan by choice (record §7).
 */
export function createSend(
  context: BaseAudioContext,
  source: AudioNode,
  target: ReturnBus,
  amount: number,
): GainNode {
  const send = context.createGain();
  send.gain.value = amount;
  source.connect(send);
  send.connect(target.input);
  return send;
}

/** The plate, fully wet: its own `dry` stays at zero, the amount is the send. */
function attachPlate(
  context: BaseAudioContext,
  input: GainNode,
  output: GainNode,
  spec: ReverbReturn,
): AudioWorkletNode {
  const plate = new AudioWorkletNode(context, REVERB_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const now = context.currentTime;
  for (const [name, value] of Object.entries(spec.space)) {
    plate.parameters.get(name)?.setValueAtTime(value, now);
  }
  plate.parameters.get('wet')?.setValueAtTime(1, now);
  plate.parameters.get('dry')?.setValueAtTime(0, now);

  input.connect(plate);
  plate.connect(output);
  return plate;
}

/** Feedback delay with a damping lowpass in the loop; the repeats darken. */
function attachDelay(
  context: BaseAudioContext,
  input: GainNode,
  output: GainNode,
  spec: DelayReturn,
): DelayNode {
  const delay = context.createDelay(DELAY_MAX_SECONDS);
  const feedback = context.createGain();
  const damp = context.createBiquadFilter();

  delay.delayTime.value = spec.delayTime;
  feedback.gain.value = Math.min(DELAY_FEEDBACK_MAX, spec.feedback);
  damp.type = 'lowpass';
  damp.frequency.value = spec.damp;

  input.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  damp.connect(output);
  return delay;
}
