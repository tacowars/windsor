/**
 * Wiring one part through its channel strip.
 *
 *   part.output ─▶ [stage …] ─▶ tail ─┬─ [rotate θ] ─▶ dry destination (a bus, or the master)
 *                                     ├─ send ─▶ return "room"
 *                                     └─ send ─▶ return "echo"   … one send per return, at 0 unless the strip names it
 *
 * The fader is not here: `MIX.level` sets the part's k-rate `gain` param, a
 * multiply per block inside the worklet, so no `GainNode` sits in the dry path
 * for it (record §3). The stages are the strip's own processing, in order;
 * the rotation and the sends both hang off the chain's tail (#639). So the
 * sends are post-fader by construction, post-stage so a room hears what the
 * dry path hears, and, because the rotation is in the dry path only, pre-pan
 * by choice: fading a part out fades its tail with it, and every part arrives
 * at the room centred (record §7, amended by
 * docs/log/2026-09-22-639-sends-tap-the-strip-tail.md). With no stages the
 * tail is `part.output` and the graph is the one #68 built.
 *
 * The part must have been created unrouted (`destination: null`); connecting it
 * to the master as well would sum it twice.
 */
import type { AudioPart } from './audioPart';
import type { ChannelStrip } from './mix';
import type { ReturnBus } from './returnBus';
import { createSend } from './returnBus';
import type { StereoRotate } from './stereoRotate';
import { createStereoRotate } from './stereoRotate';

/**
 * One piece of a strip's processing between the part and the tap (#639): a
 * node chain entered at `input` and left at `output`. The strip makes and
 * removes the edges into `input` and out of `output`; `dispose` releases only
 * what the stage built between them.
 */
export interface StripStage {
  readonly input: AudioNode;
  readonly output: AudioNode;
  dispose(): void;
}

export interface PartStrip {
  readonly part: AudioPart;
  /** The strip's stages, in signal order. */
  readonly stages: readonly StripStage[];
  /** Where the rotation and the sends connect: the last stage's output, or `part.output`. */
  readonly tail: AudioNode;
  readonly rotation: StereoRotate;
  /** One send per return, by return name. */
  readonly sends: ReadonlyMap<string, GainNode>;
  setLevel(level: number): void;
  setPan(pan: number): void;
  /** Throws for a return that does not exist; a typo must not be silent. */
  setSend(returnName: string, amount: number): void;
  dispose(): void;
}

/** Connect `stages` in order after `head`; returns the chain's tail. */
function chain(head: AudioNode, stages: readonly StripStage[]): AudioNode {
  let tail = head;
  for (const stage of stages) {
    tail.connect(stage.input);
    tail = stage.output;
  }
  return tail;
}

/** Remove exactly the edges `chain` made, leaving every node's other connections. */
function unchain(head: AudioNode, stages: readonly StripStage[]): void {
  let tail = head;
  for (const stage of stages) {
    tail.disconnect(stage.input);
    tail = stage.output;
  }
}

/**
 * Apply `strip` to `part`: fader, `stages` in order, then the rotation into
 * `dry` and a send to every return, both from the chain's tail.
 */
export function routePart(
  part: AudioPart,
  strip: ChannelStrip,
  returns: Readonly<Record<string, ReturnBus>>,
  dry: AudioNode,
  stages: readonly StripStage[] = [],
): PartStrip {
  const context = part.context;
  for (const name of Object.keys(strip.sends)) {
    if (!(name in returns)) {
      throw new Error(`part "${part.name}" sends to unknown return "${name}"`);
    }
  }

  part.gain.value = strip.level;

  const tail = chain(part.output, stages);

  const rotation = createStereoRotate(context, strip.pan);
  tail.connect(rotation.input);
  rotation.output.connect(dry);

  const sends = new Map<string, GainNode>();
  for (const [name, target] of Object.entries(returns)) {
    sends.set(name, createSend(context, tail, target, strip.sends[name] ?? 0));
  }

  return {
    part,
    stages,
    tail,
    rotation,
    sends,
    setLevel(level: number): void {
      part.gain.value = level;
    },
    setPan(pan: number): void {
      rotation.setPan(pan);
    },
    setSend(returnName: string, amount: number): void {
      const send = sends.get(returnName);
      if (!send) throw new Error(`part "${part.name}" has no send to return "${returnName}"`);
      send.gain.value = amount;
    },
    dispose(): void {
      // Only the edges this strip made leave `part.output` and the tail: a
      // targeted disconnect, before the stages go, since disconnecting an
      // edge that no longer exists throws.
      for (const send of sends.values()) {
        tail.disconnect(send);
        send.disconnect();
      }
      tail.disconnect(rotation.input);
      rotation.dispose();
      unchain(part.output, stages);
      for (const stage of stages) stage.dispose();
    },
  };
}
