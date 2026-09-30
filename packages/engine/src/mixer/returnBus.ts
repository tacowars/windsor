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
 * The plate and the delay loop are built in `returnEffects.ts`, which the
 * Plate reverb and Echo inserts share (windsor#171).
 *
 * The plate cost about 1% of one core per instance rendering 60 s of audio
 * under Node 24 on an Apple M4 Pro -- a development machine, not the target,
 * so an order-of-magnitude sanity check and not a milestone result under
 * CLAUDE.md invariant 5. See docs/research/2026-08-31-52-dattorro-reverb/.
 */
import type { DelayReturn, ReturnSpec, ReverbReturn } from './mix';
import {
  PLATE_FULLY_WET,
  attachDelay,
  createPlate,
  disconnectDelay,
  writeDelay,
  writePlate,
} from './returnEffects';
import type { ReverbSpace } from './reverbSpace';

export { delayClipCurve } from './returnEffects';

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
  /** `output.gain`, as a setter, for the document's `returns` overlay. */
  setLevel(level: number): void;
  /** Plate parameters onto the worklet; a no-op on a delay. */
  setSpace(space: Partial<ReverbSpace>): void;
  /** The delay line's time, loop feedback, damping and resonance; a no-op on a plate. */
  setDelay(
    delay: Partial<Pick<DelayReturn, 'delayTime' | 'feedback' | 'damp' | 'resonance'>>,
  ): void;
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

  const plate = spec.kind === 'reverb' ? attachPlate(context, input, output, spec) : null;
  const line = spec.kind === 'delay' ? attachDelay(context, input, output, spec) : null;
  const effect = plate ?? line?.effect;
  if (!effect) throw new Error(`return "${name}": unknown kind`);

  return {
    name,
    spec,
    input,
    output,
    level: output.gain,
    effect,
    setLevel(level: number): void {
      output.gain.value = level;
    },
    setSpace(space: Partial<ReverbSpace>): void {
      if (plate) writePlate(plate, space);
    },
    setDelay(delay): void {
      if (line) writeDelay(line, delay);
    },
    dispose(): void {
      input.disconnect();
      effect.disconnect();
      output.disconnect();
      // The loop's own nodes too, or the cycle stays wired after the return goes.
      if (line) disconnectDelay(line);
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
  const plate = createPlate(context, spec.space, PLATE_FULLY_WET);
  input.connect(plate);
  plate.connect(output);
  return plate;
}
