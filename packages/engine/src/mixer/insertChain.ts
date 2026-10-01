/**
 * A strip's insert stages, and how a new list lands on them (#641, #652).
 *
 * The chain sits between the low cut and the tap. A settings-only change is
 * param writes. A **permutation** of the live kinds re-uses the live stages,
 * so a chorus keeps its delay contents and its LFO phase where a rebuild
 * would restart it silent. Anything else is built, attached beside the old
 * chain, handed to the tap, and only then is the old chain detached.
 *
 * Every structural change happens inside a fade (`createInsertUpdater`), so
 * the step it makes in the waveform is inaudible.
 */
import type { StripStage } from './channelStrip';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { InsertRegistry, InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { insertKind } from '../inserts/insertRegistry';
import type { Tap } from './stripTap';

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
 * Whether `next` is the live kinds in the live order. Kinds only: an insert's
 * `id` (windsor#186) is the console's, so a list that only adds or changes
 * ids is param writes to the same stages, with no rebuild and no fade.
 */
const sameKinds = (
  live: readonly InsertStage<InsertSpec>[],
  next: readonly InsertSpec[],
): boolean => live.length === next.length && live.every((stage, i) => stage.kind === next[i]?.kind);

/** The strip's inserts after `head`, and how a new list lands on them (#641). */
export interface InsertChain {
  readonly specs: readonly InsertSpec[];
  readonly stages: readonly InsertStage<InsertSpec>[];
  readonly tail: AudioNode;
  /** Whether `specs` is the live kinds in the live order: a settings-only change. */
  matches(specs: readonly InsertSpec[]): boolean;
  /** Throws for a kind the registry lacks — before a caller fades or re-wires anything. */
  check(specs: readonly InsertSpec[]): void;
  /** Settings onto the live stages, in order. Only valid when `matches` holds. */
  apply(specs: readonly InsertSpec[]): void;
  /**
   * Any other list. A **permutation** of the live kinds re-uses the live
   * stages, so a chorus keeps its delay contents and its LFO phase where a
   * rebuild would restart it silent (#652); each stage carries the settings of
   * the spec it lands on. Any other list is built, attached beside the old
   * chain, handed to `retap` so the tap moves across in one step, and only
   * then is the old chain detached and disposed. A kind the registry lacks
   * throws before anything is touched. Callers fade around this.
   */
  set(specs: readonly InsertSpec[], retap: (tail: AudioNode) => void): void;
  dispose(): void;
}

/**
 * The live stages in `specs`' order when `specs` is a permutation of their
 * kinds, else null. Each spec takes the first unclaimed stage of its kind, so
 * two of one kind keep their relative order.
 */
function reorderOf(
  stages: readonly InsertStage<InsertSpec>[],
  specs: readonly InsertSpec[],
): InsertStage<InsertSpec>[] | null {
  if (stages.length !== specs.length) return null;
  const pool = [...stages];
  const out: InsertStage<InsertSpec>[] = [];
  for (const spec of specs) {
    const at = pool.findIndex((stage) => stage.kind === spec.kind);
    if (at < 0) return null;
    out.push(...pool.splice(at, 1));
  }
  return out;
}

// eslint-disable-next-line max-lines-per-function -- one closure over the chain's stages and tail: the four operations share that state
export function createInsertChain(
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
  let applied = specs;
  let tail = chain(head, stages);
  const check = (next: readonly InsertSpec[]): void => {
    for (const spec of next) {
      if (!insertKind(registry, spec.kind)) {
        throw new Error(`part "${owner}": no insert kind "${spec.kind}"`);
      }
    }
  };
  const applyTo = (next: readonly InsertSpec[]): void => {
    stages.forEach((stage, i) => stage.set(next[i]!));
    applied = next;
  };
  return {
    get specs(): readonly InsertSpec[] {
      return applied;
    },
    get stages(): readonly InsertStage<InsertSpec>[] {
      return stages;
    },
    get tail(): AudioNode {
      return tail;
    },
    matches(next: readonly InsertSpec[]): boolean {
      return sameKinds(stages, next);
    },
    check,
    apply: applyTo,
    set(next: readonly InsertSpec[], retap: (tail: AudioNode) => void): void {
      if (sameKinds(stages, next)) {
        applyTo(next);
        return;
      }
      const moved = reorderOf(stages, next);
      if (moved) {
        // The same stages, re-wired: off the old order first, since they are
        // the very nodes the new order is built from.
        unchain(head, stages);
        stages = moved;
        applyTo(next);
        tail = chain(head, stages);
        retap(tail);
        return;
      }
      const built = build(next);
      tail = chain(head, built);
      retap(tail);
      unchain(head, stages);
      for (const stage of stages) stage.dispose();
      stages = built;
      applied = next;
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

/** The strip's insert edits, and the way to stop one that is still waiting. */
export interface InsertUpdater {
  set(specs: readonly InsertSpec[]): void;
  /**
   * Drop a re-wire that has not run yet. The strip calls this when it is
   * disposed: the deferred callback would otherwise build stages onto a graph
   * that has gone, leaving their oscillators running, and then throw on the
   * first disconnect.
   */
  cancel(): void;
}

/**
 * The strip's `setInserts`: settings go straight through, and a structural
 * edit fades down, re-wires once the ramp has landed, and fades back up. A
 * list that arrives inside that window replaces the one in flight rather than
 * starting a second fade, so a run of arrow presses is one fade and the last
 * order wins (#652).
 *
 * `rebuilt` hears each re-wire inside the fade, before it rises (windsor#345):
 * a part's song lanes on its inserts re-attach to the stages as they now
 * stand and reschedule from then. A settings-only edit lands on the same
 * stages and does not call it.
 */
export function createInsertUpdater(
  inserts: InsertChain,
  tap: Pick<Tap, 'move' | 'fadeTo'>,
  later: (run: () => void, seconds: number) => void,
  changed?: () => void,
  rebuilt?: () => void,
): InsertUpdater {
  let pending: readonly InsertSpec[] | null = null;
  let fading = false;
  let cancelled = false;
  const set = (specs: readonly InsertSpec[]): void => {
    // A kind the registry lacks is refused here, while the caller is still on
    // the stack, rather than inside the deferred re-wire.
    inserts.check(specs);
    // Inside a fade the chain has not moved yet, so what `matches` would
    // report is the old order: every list waits, and the last one wins.
    if (fading) {
      pending = specs;
      return;
    }
    if (inserts.matches(specs)) {
      inserts.apply(specs);
      changed?.();
      return;
    }
    fading = true;
    tap.fadeTo(0, INSERT_FADE_SECONDS);
    later(() => {
      if (cancelled) return;
      inserts.set(pending ?? specs, (tail) => tap.move(tail));
      pending = null;
      rebuilt?.();
      changed?.();
      tap.fadeTo(1, INSERT_FADE_SECONDS);
      fading = false;
    }, INSERT_FADE_SECONDS);
  };
  return {
    set,
    cancel(): void {
      cancelled = true;
      pending = null;
    },
  };
}
