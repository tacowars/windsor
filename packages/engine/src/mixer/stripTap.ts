/**
 * The tap: where a channel strip's chain meets the mix (#639, #652, #667).
 * The head also feeds external detectors, before the audible gate, which
 * output, mute and solo close (`audibleGate.ts`, windsor#154).
 *
 *   tail ─▶ head ─▶ audible ─┬─ [rotate θ] ─▶ dry destination (the music bus, a group's input, the aux fader)
 *                           ├─ send ─▶ Send A
 *                           └─ send ─▶ Send B
 *
 * The dry edge is the one edge a part's Output moves (windsor#285): the
 * gate closes, the edge moves once the ramp has landed, and the gate opens
 * again (`createDryMover`). The sends and the head never move.
 *
 * One gain at the head, so a structural insert edit can fade the strip down,
 * re-wire and fade back up without a click, and so moving the tail is one
 * edge rather than one per send. It is not the fader: that is still the
 * part's k-rate `gain` inside the worklet (mixer record §3).
 */
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { AudibleGate } from './audibleGate';
import { createAudibleGate } from './audibleGate';
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
  /** After the head: output, mute and solo open and close the dry path and the sends here. */
  readonly gate: AudibleGate;
  move(tail: AudioNode): void;
  /** Where the rotation's output connects now. */
  readonly destination: AudioNode;
  /** Move the dry edge to `next` at once; `createDryMover` closes the gate around it. */
  moveDry(next: AudioNode): void;
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
  const gate = createAudibleGate(context, strip);
  const audible = gate.node;
  head.connect(audible);
  audible.connect(rotation.input);
  let destination = dry;
  rotation.output.connect(destination);
  const sends = new Map<string, GainNode>();
  for (const [name, target] of Object.entries(returns)) {
    sends.set(name, createSend(context, audible, target, strip.sends[name] ?? 0));
  }
  return {
    rotation,
    sends,
    head,
    gate,
    get tail(): AudioNode {
      return tail;
    },
    move(next: AudioNode): void {
      tail.disconnect(head);
      tail = next;
      tail.connect(head);
    },
    get destination(): AudioNode {
      return destination;
    },
    moveDry(next: AudioNode): void {
      rotation.output.disconnect(destination);
      destination = next;
      rotation.output.connect(destination);
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
      audible.disconnect();
      for (const send of sends.values()) send.disconnect();
      rotation.dispose();
    },
  };
}

/** A strip's dry edge on the move (windsor#285), and the way to stop a move still waiting. */
export interface DryMover {
  /** Move the dry edge to `next`, unless it is there already. */
  move(next: AudioNode): void;
  /** Drop a move that has not run yet: the strip is being disposed. */
  cancel(): void;
}

/**
 * Moving the dry edge without a click (windsor#285 decision 3): the gate
 * fades down, the edge moves once the ramp has landed, and the gate fades
 * back up, each over `INSERT_FADE_SECONDS`. A move asked for while one
 * waits replaces its destination, so a run of switches is one fade and the
 * last destination wins, as a run of insert edits is (#652).
 */
export function createDryMover(
  tap: Pick<Tap, 'destination' | 'moveDry' | 'gate'>,
  later: (run: () => void, seconds: number) => void,
): DryMover {
  let pending: AudioNode | null = null;
  let cancelled = false;
  return {
    move(next: AudioNode): void {
      if (pending) {
        pending = next;
        return;
      }
      if (next === tap.destination) return;
      pending = next;
      tap.gate.setMoving(true);
      later(() => {
        if (cancelled || !pending) return;
        if (pending !== tap.destination) tap.moveDry(pending);
        pending = null;
        tap.gate.setMoving(false);
      }, INSERT_FADE_SECONDS);
    },
    cancel(): void {
      cancelled = true;
      pending = null;
    },
  };
}
