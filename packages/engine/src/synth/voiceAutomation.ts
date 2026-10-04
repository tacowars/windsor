/**
 * A voice target's automation handle (windsor#346, record
 * `2026-10-01-song-automation-lanes` decisions 2, 7, 10 and 16): a lane on
 * one of the part's FM voice fields, by its patch path (`ops.2.width`),
 * moving every ringing voice and every new one.
 *
 * The lane holds absolute values; the worklet takes offsets from the patch's
 * value, so an offset of 0 leaves it bit for bit as it was. How an offset is
 * reckoned is the target's row in the voice target table (windsor#419,
 * `worklet/fm/voiceTargetTables.ts`), the one the worklet applies it by:
 * - a `ratio` row's lane (the cutoff, the LFO rates, the decay times) writes
 *   octaves, `log2(value / patch)`, to a slot. A decay time's knob ends on
 *   exact 0, which no ratio scales, so both its ends are taken from the
 *   row's `floor` (1 ms) where they are below it, as the worklet takes its
 *   base (windsor#347): a lane at 0 plays 1 ms. Over a patch decay below the floor, a lane at or below it
 *   is offset 0, and the worklet plays the floor for any decay time a slot
 *   maps (`partFloors` in `worklet/fm/voiceOffsets.ts`), while the same
 *   decay with no lane stays instant;
 * - an `add` row's lane writes `value − patch` to a slot.
 *
 * A slot is one of the part's `FM_LANES_MAX` k-rate parameters, taken by a
 * lane's first hold or schedule (`AudioPart.takeVoiceSlot`, which tells the
 * processor which target it moves) and freed by its release, which first
 * sets the offset back to 0. Each value is turned into an offset when it is
 * scheduled, against the part's patch then, and a patch edit resyncs every
 * lane (`system/songAutomation.ts`), so the lane's absolute value still wins
 * on new voices and on voices a live retune rebinds.
 *
 * A target the part's patch maps from a macro has no handle (windsor#560):
 * the macro's mapping is its base, so a lane's absolute value could not
 * hold over it. The lane stays in the document and plays again when the
 * mapping goes; the worklet ignores a slot on a target its voice's patch
 * maps, for the quantum before the resync and for a held voice on an older
 * patch.
 *
 * A part hands out one handle per target, so a resync finds the same one.
 * The nine decay rows have handles too (windsor#347): the worklet reshapes a
 * decay already running from its level. `fmProcessorAutomation.test.ts` and
 * `fmProcessorAutomationDecay.test.ts` pin the handles and the worklet
 * together.
 */
import type { AutomationHandle, AutomationHow } from '../automation/automationHandles';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { PartStrip } from '../mixer/channelStrip';
import type { Patch } from '../patch/patch';
import { macroMapsTarget } from '../worklet/fm/macroMappings';
import { VOICE_TARGET_TABLE } from '../worklet/fm/voiceTargetTables';
import type { AudioPart } from './audioPart';

/** Which voice field a lane moves: its patch path. */
export interface VoiceTarget {
  readonly path: string;
}

/** Each target's curve and ratio floor, by path: the rows the worklet applies an offset by. */
const TARGET_ROWS: ReadonlyMap<string, { readonly ratio: boolean; readonly floor: number }> =
  new Map(
    VOICE_TARGET_TABLE.map((row) => [row.path, { ratio: row.curve === 'ratio', floor: row.floor }]),
  );

/** The number at `path` in `patch`, or NaN when there is none. */
function patchValue(patch: Patch, path: string): number {
  let node: unknown = patch;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : NaN;
  }
  return typeof node === 'number' ? node : NaN;
}

/**
 * The offset that makes `value`, a lane value in the row's units, sound over
 * `patch`: its difference from the patch's value, or for a ratio row the
 * log2 of their ratio, each end raised to the target row's `floor` where it
 * has one. 0 where the patch has no positive value to scale, or for a path
 * the table does not carry.
 */
export function voiceOffset(
  patch: Patch,
  path: string,
  row: AutomationTargetRow,
  value: number,
): number {
  const base = patchValue(patch, path);
  const target = TARGET_ROWS.get(path);
  const clamped = value < row.min ? row.min : value > row.max ? row.max : value;
  if (!target || !Number.isFinite(base) || !Number.isFinite(clamped)) return 0;
  if (!target.ratio) return clamped - base;
  const { floor } = target;
  const from = base < floor ? floor : base;
  const to = clamped < floor ? floor : clamped;
  return from > 0 && to > 0 ? Math.log2(to / from) : 0;
}

/** Where a handle writes: the param, taking a slot when it needs one, and the param it has now. */
interface OffsetTarget {
  take(): AudioParam | undefined;
  held(): AudioParam | undefined;
  free(): void;
}

function write(param: AudioParam, offset: number, time: number, how: AutomationHow): void {
  if (how === 'ramp') param.linearRampToValueAtTime(offset, time);
  else param.setValueAtTime(offset, time);
}

/** A handle that writes each lane value as its offset onto `target`. */
function offsetHandle(target: OffsetTarget, offsetOf: (value: number) => number): AutomationHandle {
  return {
    schedule(value, time, how): void {
      const param = target.take();
      if (param) write(param, offsetOf(value), time, how);
    },
    cancelFrom(time): void {
      target.held()?.cancelScheduledValues(time);
    },
    hold(value, time): void {
      const param = target.take();
      if (!param) return;
      param.cancelScheduledValues(time);
      param.setValueAtTime(offsetOf(value), time);
    },
    release(time): void {
      const param = target.held();
      if (!param) return;
      param.cancelScheduledValues(time);
      param.setValueAtTime(0, time);
      target.free();
    },
  };
}

/** The part's slot for `path`: taken on a hold or schedule, freed on release. */
function slotTarget(part: AudioPart, path: string): OffsetTarget {
  const paramOf = (slot: number | undefined): AudioParam | undefined =>
    slot === undefined ? undefined : part.voiceSlotParams[slot];
  return {
    take: () => paramOf(part.takeVoiceSlot(path)),
    held: () => paramOf(part.voiceSlotOf(path)),
    free: () => part.freeVoiceSlot(path),
  };
}

/**
 * Each part's handles by patch path, so finding a lane's target again (a
 * resync) hands the player the handle it already holds, not a new one it
 * would release and hold again. A rebuilt part is a new `AudioPart`, and
 * starts with none.
 */
const handles = new WeakMap<AudioPart, Map<string, AutomationHandle>>();

/**
 * The handle for `target` on `strip`'s part, or undefined when there is
 * none: a target the part's patch maps from a macro has none while the
 * mapping stands (record `2026-10-04-patch-macro-knobs` decision 6), so the
 * player releases its slot at the patch edit's resync, and takes it back
 * through the same handle once the mapping is gone.
 */
export function voiceAutomationHandle(
  strip: PartStrip,
  target: VoiceTarget,
  row: AutomationTargetRow,
): AutomationHandle | undefined {
  const { path } = target;
  const part = strip.part;
  if (macroMapsTarget(part.patch, path)) return undefined;
  let byPath = handles.get(part);
  if (!byPath) handles.set(part, (byPath = new Map()));
  const known = byPath.get(path);
  if (known) return known;
  const offsetOf = (value: number): number => voiceOffset(part.patch, path, row, value);
  const handle = offsetHandle(slotTarget(part, path), offsetOf);
  byPath.set(path, handle);
  return handle;
}
