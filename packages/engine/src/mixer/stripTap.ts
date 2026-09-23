/**
 * The tap: where a channel strip's chain meets the mix (#639, #652).
 *
 *   tail ─▶ head ─┬─ [rotate θ] ─▶ dry destination
 *                 ├─ send ─▶ return "room"
 *                 └─ send ─▶ return "echo"
 *
 * One gain at the head, so a structural insert edit can fade the strip down,
 * re-wire and fade back up without a click, and so moving the tail is one
 * edge rather than one per send. It is not the fader: that is still the
 * part's k-rate `gain` inside the worklet (mixer record §3).
 */
import type { ChannelStrip } from './mix';
import type { ReturnBus } from './returnBus';
import { createSend } from './returnBus';
import type { StereoRotate } from './stereoRotate';
import { createStereoRotate } from './stereoRotate';

/** The rotation and the sends, and the one gain they all hang off. */
export interface Tap {
  readonly rotation: StereoRotate;
  readonly sends: ReadonlyMap<string, GainNode>;
  readonly tail: AudioNode;
  /** The fade gain every tapped path passes through (#652). */
  readonly head: GainNode;
  move(tail: AudioNode): void;
  /** Ramp the tapped paths to `level` over `seconds`, from wherever they are now. */
  fadeTo(level: number, seconds: number): void;
  dispose(): void;
}

export function createTap(
  context: BaseAudioContext,
  strip: ChannelStrip,
  returns: Readonly<Record<string, ReturnBus>>,
  dry: AudioNode,
  from: AudioNode,
): Tap {
  let tail = from;
  // One gain at the head of the tap (#652): every tapped path passes through
  // it, so a structural edit can fade the strip down, re-wire and fade back up
  // without a click, and moving the tail is one edge rather than one per send.
  // Not the fader — that is still the worklet's k-rate `gain` (record §3).
  const head = context.createGain();
  tail.connect(head);
  const rotation = createStereoRotate(context, strip.pan);
  head.connect(rotation.input);
  rotation.output.connect(dry);
  const sends = new Map<string, GainNode>();
  for (const [name, target] of Object.entries(returns)) {
    sends.set(name, createSend(context, head, target, strip.sends[name] ?? 0));
  }
  return {
    rotation,
    sends,
    head,
    get tail(): AudioNode {
      return tail;
    },
    move(next: AudioNode): void {
      tail.disconnect(head);
      tail = next;
      tail.connect(head);
    },
    fadeTo(level: number, seconds: number): void {
      const now = context.currentTime;
      head.gain.cancelScheduledValues(now);
      head.gain.setValueAtTime(head.gain.value, now);
      head.gain.linearRampToValueAtTime(level, now + seconds);
    },
    dispose(): void {
      tail.disconnect(head);
      head.disconnect();
      for (const send of sends.values()) send.disconnect();
      rotation.dispose();
    },
  };
}
