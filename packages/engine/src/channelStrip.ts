/**
 * Wiring one part through its channel strip.
 *
 *   part.output ─▶ [low cut] ─▶ [insert …] ─▶ tail ─┬─ [rotate θ] ─▶ dry destination (a bus, or the master)
 *                                                   ├─ send ─▶ return "room"
 *                                                   └─ send ─▶ return "echo"   … one send per return, at 0 unless the strip names it
 *
 * The fader is not here: `MIX.level` sets the part's k-rate `gain` param, a
 * multiply per block inside the worklet, so no `GainNode` sits in the dry path
 * for it (record §3). The stages are the strip's own processing, in order;
 * the rotation and the sends both hang off the chain's tail (#639). So the
 * sends are post-fader by construction, post-stage so a room hears what the
 * dry path hears, and, because the rotation is in the dry path only, pre-pan
 * by choice: fading a part out fades its tail with it, and every part arrives
 * at the room centred (record §7, amended by
 * docs/log/2026-09-22-639-sends-tap-the-strip-tail.md). The low cut is
 * always the first stage (#640, `lowCutStage.ts`); the strip's inserts follow
 * it in list order (#641, `inserts/`).
 *
 * The part must have been created unrouted (`destination: null`); connecting it
 * to the master as well would sum it twice.
 */
import type { AudioPart } from './audioPart';
import type { InsertRegistry, InsertSpec, InsertStage } from './inserts/insertRegistry';
import { INSERT_KINDS, insertKind } from './inserts/insertRegistry';
import type { LowCutStage } from './lowCutStage';
import { createLowCutStage } from './lowCutStage';
import type { ChannelStrip } from './mix';
import type { ReturnBus } from './returnBus';
import { createSend } from './returnBus';
import type { StereoRotate } from './stereoRotate';
import { createStereoRotate } from './stereoRotate';

/**
 * One piece of a strip's processing between the part and the tap (#639): a
 * node chain entered at `input` and left at `output`. The strip makes and
 * removes the edges into `input` and out of `output`; `dispose` releases only
 * what the stage built between them, and stops any source it started.
 */
export interface StripStage {
  readonly input: AudioNode;
  readonly output: AudioNode;
  dispose(): void;
}

export interface PartStrip {
  readonly part: AudioPart;
  /** The strip's stages, in signal order: the low cut, then the inserts. */
  readonly stages: readonly StripStage[];
  /** The first stage (#640). */
  readonly lowCut: LowCutStage;
  /** The live inserts, in list order (#641). */
  readonly inserts: readonly InsertStage<InsertSpec>[];
  /** Where the rotation and the sends connect: the last stage's output. */
  readonly tail: AudioNode;
  readonly rotation: StereoRotate;
  /** One send per return, by return name. */
  readonly sends: ReadonlyMap<string, GainNode>;
  setLevel(level: number): void;
  setPan(pan: number): void;
  /** Hz; the caller clamps. */
  setLowCut(hz: number): void;
  /**
   * The strip's inserts, normalised (#641). The same kinds in the same order
   * are param writes on the live stages; any other list rebuilds this strip's
   * insert chain and nothing else.
   */
  setInserts(specs: readonly InsertSpec[]): void;
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
 * The tap (#639): the rotation into `dry` and one send per return, all fed
 * from one node — the chain's tail. `move` re-feeds them from a new tail when
 * the inserts are rebuilt (#641); the rotation and the sends themselves stay.
 */
interface Tap {
  readonly rotation: StereoRotate;
  readonly sends: ReadonlyMap<string, GainNode>;
  readonly tail: AudioNode;
  move(tail: AudioNode): void;
  dispose(): void;
}

function createTap(
  context: BaseAudioContext,
  strip: ChannelStrip,
  returns: Readonly<Record<string, ReturnBus>>,
  dry: AudioNode,
  from: AudioNode,
): Tap {
  let tail = from;
  const rotation = createStereoRotate(context, strip.pan);
  tail.connect(rotation.input);
  rotation.output.connect(dry);
  const sends = new Map<string, GainNode>();
  for (const [name, target] of Object.entries(returns)) {
    sends.set(name, createSend(context, tail, target, strip.sends[name] ?? 0));
  }
  // Only the edges the tap made leave the tail: targeted disconnects, and
  // before any stage goes, since disconnecting an edge that no longer exists throws.
  const untap = (): void => {
    for (const send of sends.values()) tail.disconnect(send);
    tail.disconnect(rotation.input);
  };
  return {
    rotation,
    sends,
    get tail(): AudioNode {
      return tail;
    },
    move(next: AudioNode): void {
      untap();
      tail = next;
      tail.connect(rotation.input);
      for (const send of sends.values()) tail.connect(send);
    },
    dispose(): void {
      untap();
      for (const send of sends.values()) send.disconnect();
      rotation.dispose();
    },
  };
}

const sameKinds = (
  live: readonly InsertStage<InsertSpec>[],
  next: readonly InsertSpec[],
): boolean => live.length === next.length && live.every((stage, i) => stage.kind === next[i]?.kind);

/** The strip's inserts after `head`, and how a new list lands on them (#641). */
interface InsertChain {
  readonly stages: readonly InsertStage<InsertSpec>[];
  readonly tail: AudioNode;
  /**
   * The same kinds in the same order are param writes. Any other list is
   * built, attached beside the old chain, handed to `retap` so the tap moves
   * across in one step, and only then is the old chain detached and disposed.
   * A kind the registry lacks throws before anything is touched.
   */
  set(specs: readonly InsertSpec[], retap: (tail: AudioNode) => void): void;
  dispose(): void;
}

function createInsertChain(
  context: BaseAudioContext,
  head: AudioNode,
  specs: readonly InsertSpec[],
  registry: InsertRegistry,
  owner: string,
): InsertChain {
  const build = (list: readonly InsertSpec[]): InsertStage<InsertSpec>[] =>
    list.map((spec) => {
      const kind = insertKind(registry, spec.kind);
      if (!kind) throw new Error(`part "${owner}": no insert kind "${spec.kind}"`);
      return kind.create(context, spec);
    });
  let stages = build(specs);
  let tail = chain(head, stages);
  return {
    get stages(): readonly InsertStage<InsertSpec>[] {
      return stages;
    },
    get tail(): AudioNode {
      return tail;
    },
    set(next: readonly InsertSpec[], retap: (tail: AudioNode) => void): void {
      if (sameKinds(stages, next)) {
        stages.forEach((stage, i) => stage.set(next[i]!));
        return;
      }
      const built = build(next);
      tail = chain(head, built);
      retap(tail);
      unchain(head, stages);
      for (const stage of stages) stage.dispose();
      stages = built;
    },
    dispose(): void {
      unchain(head, stages);
      for (const stage of stages) stage.dispose();
    },
  };
}

/**
 * Apply `strip` to `part`: fader, the low cut, the strip's inserts from
 * `registry`, then the rotation into `dry` and a send to every return, both
 * from the chain's tail.
 */
export function routePart(
  part: AudioPart,
  strip: ChannelStrip,
  returns: Readonly<Record<string, ReturnBus>>,
  dry: AudioNode,
  registry: InsertRegistry = INSERT_KINDS,
): PartStrip {
  const context = part.context;
  for (const name of Object.keys(strip.sends)) {
    if (!(name in returns)) {
      throw new Error(`part "${part.name}" sends to unknown return "${name}"`);
    }
  }

  part.gain.value = strip.level;

  const lowCut = createLowCutStage(context, strip.lowCut);
  part.output.connect(lowCut.input);
  const inserts = createInsertChain(context, lowCut.output, strip.inserts, registry, part.name);
  const tap = createTap(context, strip, returns, dry, inserts.tail);
  const { rotation, sends } = tap;

  return {
    part,
    get stages(): readonly StripStage[] {
      return [lowCut, ...inserts.stages];
    },
    lowCut,
    get inserts(): readonly InsertStage<InsertSpec>[] {
      return inserts.stages;
    },
    get tail(): AudioNode {
      return tap.tail;
    },
    rotation,
    sends,
    setLevel(level: number): void {
      part.gain.value = level;
    },
    setPan(pan: number): void {
      rotation.setPan(pan);
    },
    setLowCut(hz: number): void {
      lowCut.setFrequency(hz);
    },
    setInserts(specs: readonly InsertSpec[]): void {
      inserts.set(specs, (tail) => tap.move(tail));
    },
    setSend(returnName: string, amount: number): void {
      const send = sends.get(returnName);
      if (!send) throw new Error(`part "${part.name}" has no send to return "${returnName}"`);
      send.gain.value = amount;
    },
    dispose(): void {
      tap.dispose();
      inserts.dispose();
      part.output.disconnect(lowCut.input);
      lowCut.dispose();
    },
  };
}
