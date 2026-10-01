/**
 * A voice target's automation handle (windsor#346, record
 * `2026-10-01-song-automation-lanes` decisions 2, 7, 10 and 16): a lane on
 * one of the part's FM voice fields, by its patch path (`ops.2.width`),
 * moving every ringing voice and every new one.
 *
 * The lane holds absolute values; the worklet takes offsets from the patch's
 * value, so an offset of 0 leaves it bit for bit as it was:
 * - the cutoff's lane writes octaves, `log2(value / patch)`, to the part's
 *   `cutoffMod`, which nothing else writes;
 * - the LFO rates' lanes write the same log2 ratio to a slot;
 * - every other lane writes `value − patch` to a slot.
 *
 * A slot is one of the part's `FM_LANES_MAX` k-rate parameters, taken by a
 * lane's first hold or schedule (`AudioPart.takeVoiceSlot`, which tells the
 * processor which target it moves) and freed by its release, which first
 * sets the offset back to 0. Each value is turned into an offset when it is
 * scheduled, against the part's patch then, and a patch edit resyncs every
 * lane (`system/songAutomation.ts`), so the lane's absolute value still wins
 * on new voices and on voices a live retune rebinds.
 *
 * A part hands out one handle per target, so a resync finds the same one.
 * The nine decay rows wait on windsor#347: they find no handle here, so the
 * player leaves them unplayed. `fmProcessorAutomation.test.ts` pins the
 * handles and the worklet together.
 */
import type { AutomationHandle, AutomationHow } from '../automation/automationHandles';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { PartStrip } from '../mixer/channelStrip';
import type { Patch } from '../patch/patch';
import type { AudioPart } from './audioPart';

/** Which voice field a lane moves: its patch path. */
export interface VoiceTarget {
  readonly path: string;
}

/** The cutoff's lane moves the part's `cutoffMod`, in octaves, rather than a slot. */
const CUTOFF_PATH = 'filter.cutoff';

/** The rows whose offset is a log2 ratio of the patch's value (decision 2 of windsor#346). */
const RATIO_PATHS: ReadonlySet<string> = new Set([CUTOFF_PATH, 'lfo.rate', 'lfo2.rate']);

/** windsor#347's rows: a decay time or curve reshapes a segment already sounding. */
const DECAY_PATH = /\.decay(Time|Curve)$/;

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
 * log2 of their ratio. 0 where the patch has no positive value to scale.
 */
export function voiceOffset(
  patch: Patch,
  path: string,
  row: AutomationTargetRow,
  value: number,
): number {
  const base = patchValue(patch, path);
  const clamped = value < row.min ? row.min : value > row.max ? row.max : value;
  if (!Number.isFinite(base) || !Number.isFinite(clamped)) return 0;
  if (!RATIO_PATHS.has(path)) return clamped - base;
  return base > 0 && clamped > 0 ? Math.log2(clamped / base) : 0;
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

/** The part's `cutoffMod`, which the cutoff's lane alone writes. */
function cutoffTarget(part: AudioPart): OffsetTarget {
  return { take: () => part.cutoffMod, held: () => part.cutoffMod, free: () => undefined };
}

/**
 * Each part's handles by patch path, so finding a lane's target again (a
 * resync) hands the player the handle it already holds, not a new one it
 * would release and hold again. A rebuilt part is a new `AudioPart`, and
 * starts with none.
 */
const handles = new WeakMap<AudioPart, Map<string, AutomationHandle>>();

/** The handle for `target` on `strip`'s part, or undefined when there is none. */
export function voiceAutomationHandle(
  strip: PartStrip,
  target: VoiceTarget,
  row: AutomationTargetRow,
): AutomationHandle | undefined {
  const { path } = target;
  if (DECAY_PATH.test(path)) return undefined;
  const part = strip.part;
  let byPath = handles.get(part);
  if (!byPath) handles.set(part, (byPath = new Map()));
  const known = byPath.get(path);
  if (known) return known;
  const offsetOf = (value: number): number => voiceOffset(part.patch, path, row, value);
  const where = path === CUTOFF_PATH ? cutoffTarget(part) : slotTarget(part, path);
  const handle = offsetHandle(where, offsetOf);
  byPath.set(path, handle);
  return handle;
}
