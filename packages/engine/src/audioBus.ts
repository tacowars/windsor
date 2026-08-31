/**
 * Effect buses built from native Web Audio nodes.
 *
 * Only the FM synthesis runs in our worklet. Filtering, reverb, delay and
 * limiting all use the browser's own nodes, which execute in its audio thread
 * and cost nothing from the main-thread frame budget that
 * `docs/design/tech-demo-proposal.md` 1 identifies as the project's primary risk.
 */

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
  /** Wet amount, 0..1; uses a generated impulse response. */
  reverb?: number;
  reverbSeconds?: number;
  reverbDecay?: number;
}

export interface AudioBus {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly filter?: BiquadFilterNode;
  readonly delay?: DelayNode;
  readonly reverb?: ConvolverNode;
}

/**
 * A decaying noise burst, used as a reverb impulse.
 *
 * Saves shipping an IR file -- which matters more than convenience here: the dev
 * server sets `Cross-Origin-Embedder-Policy: require-corp` for Havok, so any
 * cross-origin audio asset would need CORP headers to load at all.
 */
export function generateImpulseResponse(
  context: BaseAudioContext,
  seconds = 2.4,
  decay = 2.6,
): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const onsetSamples = context.sampleRate * 0.005;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      // Ramp the first few milliseconds so the onset is not a click.
      const envelope = Math.pow(1 - i / length, decay) * Math.min(1, i / onsetSamples);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
  }
  return buffer;
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
    reverb?: ConvolverNode;
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
    const convolver = context.createConvolver();
    convolver.buffer = generateImpulseResponse(
      context,
      options.reverbSeconds ?? 2.4,
      options.reverbDecay ?? 2.6,
    );
    const wet = context.createGain();
    wet.gain.value = options.reverb;
    tail.connect(convolver);
    convolver.connect(wet);
    wet.connect(output);
    bus.reverb = convolver;
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
