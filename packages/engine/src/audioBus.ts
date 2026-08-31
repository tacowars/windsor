/**
 * Effect buses built from native Web Audio nodes.
 *
 * Filtering, delay and limiting use the browser's own nodes; the reverb is our
 * second worklet. All of them execute in the audio thread and cost nothing from
 * the main-thread frame budget that `docs/design/tech-demo-proposal.md` 1
 * identifies as the project's primary risk -- the reverb was measured at about
 * 1% of one core per instance.
 */
import type { ReverbSpace } from './reverbSpace';
import { makeSpace } from './reverbSpace';
import { REVERB_PROCESSOR_NAME } from './workletMessages';

export interface BusFilterOptions {
  type?: BiquadFilterType;
  frequency?: number;
  Q?: number;
}

export interface BusOptions {
  filter?: BusFilterOptions;
  /** Seconds; omit or zero to leave the delay out of the graph entirely. */
  delayTime?: number;
  feedback?: number;
  delayMix?: number;
  delayDamp?: number;
  /** Wet amount, 0..1; omit or zero to leave the reverb out of the graph. */
  reverb?: number;
  /** Which room. Defaults to `DEFAULT_SPACE`. */
  reverbSpace?: Partial<ReverbSpace>;
}

export interface AudioBus {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly filter?: BiquadFilterNode;
  readonly delay?: DelayNode;
  readonly reverb?: AudioWorkletNode;
}

/**
 * Attach the reverb, fully wet, in parallel with the dry path.
 *
 * The node's own `dry` stays at zero and the bus mixes with `wet`, so the
 * amount is one gain outside the plate rather than a blend inside it. That is
 * the shape a per-part send needs, and it is why turning the amount down
 * silences the plate's contribution without changing its tail.
 *
 * Requires `FmEngine.init()` to have loaded the reverb module.
 */
function attachReverb(
  context: BaseAudioContext,
  source: AudioNode,
  output: GainNode,
  options: BusOptions,
): AudioWorkletNode {
  const reverb = new AudioWorkletNode(context, REVERB_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const space = makeSpace(options.reverbSpace);
  for (const [name, value] of Object.entries(space)) {
    reverb.parameters.get(name)?.setValueAtTime(value, context.currentTime);
  }

  const wet = context.createGain();
  wet.gain.value = options.reverb ?? 0;
  source.connect(reverb);
  reverb.connect(wet);
  wet.connect(output);
  return reverb;
}

/** Wire a bus. Connect parts to `input`; route `output` onward. */
export function createBus(context: BaseAudioContext, options: BusOptions = {}): AudioBus {
  const input = context.createGain();
  const output = context.createGain();
  const bus: {
    input: GainNode;
    output: GainNode;
    filter?: BiquadFilterNode;
    delay?: DelayNode;
    reverb?: AudioWorkletNode;
  } = { input, output };

  let tail: AudioNode = input;

  if (options.filter) {
    const filter = context.createBiquadFilter();
    filter.type = options.filter.type ?? 'lowpass';
    filter.frequency.value = options.filter.frequency ?? 12000;
    filter.Q.value = options.filter.Q ?? 0.707;
    tail.connect(filter);
    tail = filter;
    bus.filter = filter;
  }

  if (options.delayTime && options.delayTime > 0) {
    tail = attachDelay(context, tail, output, options, bus);
  }

  if (options.reverb && options.reverb > 0) {
    bus.reverb = attachReverb(context, tail, output, options);
  }

  tail.connect(output);
  return bus;
}

/**
 * Feedback delay with a damping lowpass in the loop, mixed in parallel with the
 * dry signal. Returns the node later stages should tap.
 */
function attachDelay(
  context: BaseAudioContext,
  source: AudioNode,
  output: GainNode,
  options: BusOptions,
  bus: { delay?: DelayNode },
): AudioNode {
  const delay = context.createDelay(5);
  const feedback = context.createGain();
  const damp = context.createBiquadFilter();
  const send = context.createGain();

  delay.delayTime.value = options.delayTime ?? 0.3;
  feedback.gain.value = Math.min(0.95, options.feedback ?? 0.35);
  damp.type = 'lowpass';
  damp.frequency.value = options.delayDamp ?? 3200;
  send.gain.value = options.delayMix ?? 0.3;

  source.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  damp.connect(send);
  send.connect(output);

  bus.delay = delay;
  return source;
}
