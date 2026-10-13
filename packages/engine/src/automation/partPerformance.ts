/**
 * One part's performance values (windsor#781, record
 * `2026-10-13-midi-cc-mapping` decisions 2, 3, 6 and 8): what a MIDI CC sets
 * on the part's targets, live on held notes, and never written into the
 * patch, the song or a patch message. The automation player keeps one per
 * part, and the part's clip envelope tracks read it.
 *
 * - **A voice target or a macro** holds the offset its handle reckons for
 *   the value (`voiceOffset`, against the patch at the move), on the part's
 *   one slot for that target (`synth/voiceAutomation.ts`). The slot is
 *   absolute and floored, as a lane's is, never `relative`. The slot is taken at
 *   the first applied value and kept until the value is cleared; where
 *   every slot is taken nothing is written, and the set reads `no-slot`.
 *   While a clip envelope's track writes the slot, the track adds the
 *   envelope's offset to this one (`clipEnvelopeTracks.ts`), and the player
 *   writes that track again from now instead (`tracked`).
 * - **A strip or insert target** holds its value on the params a lane
 *   writes, through the same knob handle (the strip's, or the insert stage's
 *   `param(field)`), so the strip's knob only records while it holds. No
 *   slot. Clearing releases the handle, which writes the document's value
 *   back.
 * - **Clearing a voice target** sets its offset back to 0 and frees the
 *   slot, so the voice plays the patch's own value; with a track on it, the
 *   track keeps the slot for the envelope alone.
 * - **The lanes win** (decision 3): the player never sets a target a lane
 *   plays, and `rebind` drops a value whose target a lane now plays, without
 *   writing: the lane already holds the param. A lane switched off later
 *   releases it, and the value does not come back on its own.
 *
 * A part with nothing held changes nothing anywhere it is read.
 * `performancePlayer.test.ts`, and `system/audioSystemPerformance.test.ts` live.
 */
import type { AutomationHandle } from './automationHandles';
import { isOffsetHandle } from './automationHandles';
import type { AutomationTargetId } from './automationLane';
import type { ResolvedTarget } from './automationPlayer';

/**
 * What setting a performance value did: `applied`; `automated`, ignored
 * because a lane plays the target; `no-slot`, a voice target that found
 * every voice slot taken; `inert`, a target the part does not have now (an
 * insert it lacks, a voice target a macro maps, a macro the patch lacks).
 */
export type PerformanceResult = 'applied' | 'automated' | 'no-slot' | 'inert';

/** A target holding a performance value. */
export interface HeldPerformance {
  readonly target: AutomationTargetId;
  handle: AutomationHandle;
  /** The value, in the target's own units, clamped to its row. */
  readonly value: number;
  /** A voice target's offset, reckoned at the move; 0 on a strip or insert target. */
  readonly offset: number;
}

/** When and how a set writes. */
export interface PerformanceWrite {
  /** The audio clock's time now. */
  readonly now: number;
  /** A clip envelope's track writes the target's slot: the player writes it again, not this. */
  readonly tracked: boolean;
}

/** The part a `PartPerformance` holds values for, as the player binds it. */
export interface PerformanceBinding {
  /** The part's target on the live graph now. */
  readonly resolve: (target: AutomationTargetId) => ResolvedTarget | undefined;
  /** Told of each target `rebind` drops. */
  readonly dropped: (target: AutomationTargetId) => void;
}

const clampTo = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value;

/** The entry on `target` in `list`, if any. Allocates nothing. */
function find(list: readonly HeldPerformance[], target: string): HeldPerformance | undefined {
  for (let i = 0; i < list.length; i++) if (list[i]!.target === target) return list[i];
  return undefined;
}

/** Replace the entry on `held.target` in `list`, keeping its place, or add it last. */
function keep(list: HeldPerformance[], held: HeldPerformance): void {
  const index = list.findIndex((entry) => entry.target === held.target);
  if (index < 0) list.push(held);
  else list[index] = held;
}

/** Take the entry on `target` out of `list`. */
function take(list: HeldPerformance[], target: string): HeldPerformance | undefined {
  const index = list.findIndex((entry) => entry.target === target);
  return index < 0 ? undefined : list.splice(index, 1)[0];
}

/** Whether `handle` still writes `held`'s target as it did: the same handle, its value still there. */
const stillWrites = (held: HeldPerformance, handle: AutomationHandle | undefined): boolean =>
  handle === held.handle && (!isOffsetHandle(handle) || handle.defined());

export class PartPerformance {
  /** The voice targets holding a value, in the order they took their slots. */
  readonly voices: HeldPerformance[] = [];
  /** The strip and insert targets holding a value. */
  readonly knobs: HeldPerformance[] = [];

  constructor(private readonly part: PerformanceBinding) {}

  /** Whether no target holds a value. */
  get idle(): boolean {
    return this.voices.length === 0 && this.knobs.length === 0;
  }

  /** The offset held on the voice target `target`, a lane target id, if any. Allocates nothing. */
  offsetOn(target: string): number | undefined {
    return find(this.voices, target)?.offset;
  }

  /** Whether a held voice value writes through `handle`. */
  holds(handle: AutomationHandle): boolean {
    const { voices } = this;
    for (let i = 0; i < voices.length; i++) if (voices[i]!.handle === handle) return true;
    return false;
  }

  /** Every target holding a value: the voice targets, then the strip and insert ones. */
  targets(): AutomationTargetId[] {
    return [...this.voices, ...this.knobs].map((held) => held.target);
  }

  /**
   * Hold `value` on `target`: `inert` where the part has no such target now
   * or the value is not a number. Never `automated`, which is the player's
   * to say.
   */
  set(target: AutomationTargetId, value: number, write: PerformanceWrite): PerformanceResult {
    const resolved = Number.isFinite(value) ? this.part.resolve(target) : undefined;
    if (!resolved) return 'inert';
    const { handle, row } = resolved;
    const clamped = clampTo(value, row.min, row.max);
    if (!isOffsetHandle(handle)) {
      handle.hold(clamped, write.now);
      keep(this.knobs, { target, handle, value: clamped, offset: 0 });
      return 'applied';
    }
    if (!handle.defined()) return 'inert';
    const offset = handle.offsetOf(clamped);
    if (!write.tracked) {
      handle.setRelative(false);
      handle.holdOffset(offset, write.now);
      if (!handle.slotted()) return 'no-slot';
    }
    keep(this.voices, { target, handle, value: clamped, offset });
    return 'applied';
  }

  /**
   * Give `target` back at `now`: a strip or insert target to the document's
   * value, a voice target's slot to the patch's value, freed, unless a
   * track writes it (`tracked`). Whether a voice value was held.
   */
  clear(target: AutomationTargetId, now: number, tracked: boolean): boolean {
    const voice = take(this.voices, target);
    if (voice && !tracked) voice.handle.release(now);
    take(this.knobs, target)?.handle.release(now);
    return voice !== undefined;
  }

  /**
   * After the player found the part's lanes and targets again (a lane edit,
   * a patch edit or preset switch, an insert edit or a re-wired chain): a
   * target a lane now plays is the lane's, dropped unwritten; a target the
   * part no longer has (its insert gone or its field unread, a macro now
   * mapping the voice target, a macro the patch lacks) gives its handle back
   * and is dropped; a strip or insert target found on a new handle (a rebuilt
   * stage) holds its value there.
   */
  rebind(lanes: readonly { readonly target: string }[], now: number): void {
    for (const list of [this.voices, this.knobs]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const held = list[i]!;
        if (lanes.some((lane) => lane.target === held.target)) {
          list.splice(i, 1);
          this.part.dropped(held.target);
          continue;
        }
        const found = this.part.resolve(held.target)?.handle;
        if (stillWrites(held, found)) continue;
        held.handle.release(now);
        if (found && !isOffsetHandle(found)) {
          found.hold(held.value, now);
          held.handle = found;
          continue;
        }
        list.splice(i, 1);
        this.part.dropped(held.target);
      }
    }
  }
}
