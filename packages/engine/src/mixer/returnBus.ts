/**
 * The send buses: destinations any part can feed through a send.
 *
 * A bus is an insert chain and a level, summed into the master beside the dry
 * buses (windsor#172). The amount each part contributes is a `send` gain
 * outside the bus, which is what lets several instruments share one room and
 * still sit in it at different depths -- and why turning a send to zero
 * silences that part's contribution without touching the tail of a part
 * still sending. Decision: docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md §1, §5;
 * record `2026-09-30-insert-rack-and-send-bus-chains` §6.
 *
 *   send ─▶ bus.input ─▶ [insert …] ─▶ fade ─▶ bus.output (level) ─▶ master
 *
 * The chain is a strip's (`insertChain.ts`), built from the same registry,
 * so a tempo-aware insert follows the song's tempo and a worklet insert is
 * metered, as on a part. A settings-only change is param writes; any other
 * list re-wires inside the fade, and the bus's own level never moves. With
 * no insert the sends reach the master unprocessed.
 *
 * The plate cost about 1% of one core per instance rendering 60 s of audio
 * under Node 24 on an Apple M4 Pro -- a development machine, not the target,
 * so an order-of-magnitude sanity check and not a milestone result under
 * CLAUDE.md invariant 5. See docs/research/2026-08-31-52-dattorro-reverb/.
 */
import { MS_PER_SECOND } from '../audioConstants';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import type { InsertSpec, InsertStage } from '../inserts/insertRegistry';
import type { RouteOptions } from './channelStrip';
import { createInsertChain, createInsertUpdater } from './insertChain';
import type { ReturnSpec } from './mix';

export { delayClipCurve } from './returnEffects';

export interface ReturnBus {
  readonly name: string;
  /** The bus as it is set now: its level and its chain. */
  readonly spec: ReturnSpec;
  /** Sends connect here. */
  readonly input: GainNode;
  /** Return gain, into the destination it was built for. */
  readonly output: GainNode;
  /** `output.gain`: how loud the bus is. */
  readonly level: AudioParam;
  /** The live inserts, in chain order. */
  readonly inserts: readonly InsertStage<InsertSpec>[];
  /** `output.gain`, as a setter, for the document's `returns` section. */
  setLevel(level: number): void;
  /**
   * The bus's chain, normalised. The same kinds in the same order are param
   * writes on the live stages; any other list re-wires inside a fade.
   */
  setInserts(specs: readonly InsertSpec[]): void;
  dispose(): void;
}

const laterByTimeout = (run: () => void, seconds: number): void => {
  setTimeout(run, seconds * MS_PER_SECOND);
};

/**
 * Build one bus into `destination`. `options` are a strip's: the insert
 * registry, the change hook and the fade's wait. A Plate reverb in the chain
 * requires `FmEngine.init()` to have loaded the reverb module.
 */
export function createReturn(
  context: BaseAudioContext,
  name: string,
  spec: ReturnSpec,
  destination: AudioNode,
  options: RouteOptions = {},
): ReturnBus {
  const input = context.createGain();
  const fade = context.createGain();
  const output = context.createGain();
  output.gain.value = spec.level;
  fade.connect(output);
  output.connect(destination);
  const registry = options.registry ?? INSERT_KINDS;
  const chain = createInsertChain(context, input, spec.inserts, registry, `bus ${name}`);
  let tail = chain.tail;
  tail.connect(fade);
  const tap = {
    move(next: AudioNode): void {
      tail.disconnect(fade);
      tail = next;
      tail.connect(fade);
    },
    fadeTo(level: number, seconds: number): void {
      const now = context.currentTime;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(fade.gain.value, now);
      fade.gain.linearRampToValueAtTime(level, now + seconds);
    },
  };
  const updates = createInsertUpdater(chain, tap, options.defer ?? laterByTimeout, options.changed);
  return {
    name,
    get spec(): ReturnSpec {
      return { level: output.gain.value, inserts: chain.specs };
    },
    input,
    output,
    level: output.gain,
    get inserts(): readonly InsertStage<InsertSpec>[] {
      return chain.stages;
    },
    setLevel(level: number): void {
      output.gain.value = level;
    },
    setInserts: (specs) => updates.set(specs),
    dispose(): void {
      // Before the graph goes, so a fade still waiting cannot re-wire it (#652).
      updates.cancel();
      tail.disconnect(fade);
      chain.dispose();
      input.disconnect();
      fade.disconnect();
      output.disconnect();
    },
  };
}

/** Build every bus in `specs`, keyed as given. */
export function createReturns<N extends string>(
  context: BaseAudioContext,
  specs: Readonly<Record<N, ReturnSpec>>,
  destination: AudioNode,
  options: RouteOptions = {},
): Readonly<Record<N, ReturnBus>> {
  const returns = {} as Record<N, ReturnBus>;
  for (const name of Object.keys(specs) as N[]) {
    returns[name] = createReturn(context, name, specs[name], destination, options);
  }
  return returns;
}

/**
 * A send: one gain from `source` into a bus. Tap the part's output -- which
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
