/**
 * A host insert's slot (windsor#688, record `2026-10-11-wet-path-slot`): one
 * child insert on the host's wet path, before its Mix.
 *
 *   wetPath.send ─▶ child ─▶ fade ─▶ wetPath.ret
 *
 * `withSlot` wraps a stage that has a `wetPath`, and `createInsertChain`
 * applies it to every stage it builds, so the chain's settings-only and
 * reorder paths carry the child along with its host. The child is built from
 * the chain's own registry, which the live system wraps for the load meter
 * and the song tempo, so it is metered and tempo-fed for exactly its lifetime.
 *
 * An arrival, a departure and a kind change cross over one
 * `INSERT_FADE_SECONDS` window from now: each child has its own fade, the
 * leaving one ramps to 0 while the arriving one ramps from 0 to 1, and into or
 * out of empty the host's own wet edge crosses in the same window
 * (`wetPath.route`). A leaving child is disconnected and disposed once its
 * window has passed. Any number may be leaving at once; a change always
 * lands on the newest child. The same kind, or an id-only change, is the
 * child's own `set`, with no re-wire and no fade.
 */
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { WetPath } from '../inserts/insertKind';
import type { InsertRegistry, InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { insertKind, insertSlot, SLOT_FIELD } from '../inserts/insertRegistry';
import type { AutomationHandle } from '../automation/automationHandles';

/** The strip's wait: run `run` once `seconds` have passed on the audio clock. */
export type Later = (run: () => void, seconds: number) => void;

/** What a slot needs from the chain that holds its host. */
export interface SlotDeps {
  readonly context: BaseAudioContext;
  /** The chain's registry: the child is built from it, wrappers and all. */
  readonly registry: InsertRegistry;
  readonly later: Later;
  /** Who the chain belongs to, for a refusal's message. */
  readonly owner: string;
}

/** A host's field `f` of its child is `slot.f`. */
const SLOT_PREFIX = `${SLOT_FIELD}.`;

/** Throws for `spec`'s kind, or its slot child's, when `registry` lacks it. */
export function checkInsert(registry: InsertRegistry, spec: InsertSpec, owner: string): void {
  for (const one of [spec, insertSlot(spec)]) {
    if (one && !insertKind(registry, one.kind)) {
      throw new Error(`part "${owner}": no insert kind "${one.kind}"`);
    }
  }
}

/** A live or leaving child: its stage and the gain that fades it. */
interface Child {
  readonly stage: InsertStage<InsertSpec>;
  readonly fade: GainNode;
}

/** `param` from where it is now to `to`, over one fade window from now. */
function rampFromNow(context: BaseAudioContext, param: AudioParam, to: number): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + INSERT_FADE_SECONDS);
}

interface Slot {
  /** Land `spec` (a child, or null for none) on the slot. */
  assign(spec: InsertSpec | null): void;
  /** The live child's handle on its own field `field`. */
  param(field: string): AutomationHandle | undefined;
  /** Every child, live and leaving: edges first, then the stages. */
  dispose(): void;
}

function createSlot(path: WetPath, deps: SlotDeps): Slot {
  const { context, registry, later } = deps;
  let live: Child | null = null;
  const leaving = new Set<Child>();
  const unwire = ({ stage, fade }: Child): void => {
    path.send.node.disconnect(stage.input, path.send.output);
    stage.output.disconnect(fade);
    fade.disconnect(path.ret);
  };
  const arrive = (spec: InsertSpec): Child => {
    const stage = insertKind(registry, spec.kind)!.create(context, spec);
    const fade = context.createGain();
    fade.gain.value = 0;
    path.send.node.connect(stage.input, path.send.output);
    stage.output.connect(fade);
    fade.connect(path.ret);
    rampFromNow(context, fade.gain, 1);
    return { stage, fade };
  };
  // A child the slot's own disposal already took is not in `leaving`: its late landing does nothing.
  const drop = (child: Child): void => {
    if (!leaving.delete(child)) return;
    unwire(child);
    child.stage.dispose();
  };
  const leave = (child: Child): void => {
    rampFromNow(context, child.fade.gain, 0);
    leaving.add(child);
    later(() => drop(child), INSERT_FADE_SECONDS);
  };
  return {
    assign(spec): void {
      if (live && spec && live.stage.kind === spec.kind) {
        live.stage.set(spec);
        return;
      }
      if (!live && !spec) return;
      // Connected before the old one leaves, so `param` reaches it as soon as `set` returns.
      const arriving = spec ? arrive(spec) : null;
      if (live) leave(live);
      // Into or out of empty: the host's own wet edge crosses in the same window.
      if (!live || !arriving) path.route(arriving !== null);
      live = arriving;
    },
    param: (field) => live?.stage.param?.(field),
    dispose(): void {
      const all = [...leaving, ...(live ? [live] : [])];
      leaving.clear();
      live = null;
      for (const child of all) unwire(child);
      for (const child of all) child.stage.dispose();
    },
  };
}

/**
 * `stage` with its slot, when it is a host's (it has a `wetPath`); any other
 * stage unchanged. The wrapper's `set` hands the host its own fields and the
 * slot its child, `param('slot.<f>')` is the live child's `param(f)`, and
 * `dispose` takes every child, live and leaving, before the host. A child
 * kind the registry lacks throws from `set` before anything is touched.
 */
export function withSlot(
  stage: InsertStage<InsertSpec>,
  spec: InsertSpec,
  deps: SlotDeps,
): InsertStage<InsertSpec> {
  if (!stage.wetPath) return stage;
  const slot = createSlot(stage.wetPath, deps);
  slot.assign(insertSlot(spec));
  return {
    ...stage,
    set(next: InsertSpec): void {
      checkInsert(deps.registry, next, deps.owner);
      stage.set(next);
      slot.assign(insertSlot(next));
    },
    param: (field) =>
      field.startsWith(SLOT_PREFIX)
        ? slot.param(field.slice(SLOT_PREFIX.length))
        : stage.param?.(field),
    dispose(): void {
      slot.dispose();
      stage.dispose();
    },
  };
}
