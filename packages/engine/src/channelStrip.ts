/**
 * Wiring one part through its channel strip.
 *
 *   part.output ─┬─ [rotate θ] ─▶ dry destination (a bus, or the master)
 *                ├─ send ─▶ return "room"
 *                └─ send ─▶ return "echo"   … one send per return, at 0 unless the strip names it
 *
 * The fader is not here: `MIX.level` sets the part's k-rate `gain` param, a
 * multiply per block inside the worklet, so no `GainNode` sits in the dry path
 * besides the four of the rotation (record §3). The sends tap `part.output`,
 * which is therefore post-fader by construction and, because the rotation is
 * in the dry path only, pre-pan by choice: fading a part out fades its tail
 * with it, and every part arrives at the room centred (record §7).
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

export interface PartStrip {
  readonly part: AudioPart;
  readonly rotation: StereoRotate;
  /** One send per return, by return name. */
  readonly sends: ReadonlyMap<string, GainNode>;
  setLevel(level: number): void;
  setPan(pan: number): void;
  /** Throws for a return that does not exist; a typo must not be silent. */
  setSend(returnName: string, amount: number): void;
  dispose(): void;
}

/** Apply `strip` to `part`: fader, rotation into `dry`, and a send to every return. */
export function routePart(
  part: AudioPart,
  strip: ChannelStrip,
  returns: Readonly<Record<string, ReturnBus>>,
  dry: AudioNode,
): PartStrip {
  const context = part.context;
  for (const name of Object.keys(strip.sends)) {
    if (!(name in returns)) {
      throw new Error(`part "${part.name}" sends to unknown return "${name}"`);
    }
  }

  part.gain.value = strip.level;

  const rotation = createStereoRotate(context, strip.pan);
  part.output.connect(rotation.input);
  rotation.output.connect(dry);

  const sends = new Map<string, GainNode>();
  for (const [name, target] of Object.entries(returns)) {
    sends.set(name, createSend(context, part.output, target, strip.sends[name] ?? 0));
  }

  return {
    part,
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
      for (const send of sends.values()) send.disconnect();
      rotation.dispose();
    },
  };
}
