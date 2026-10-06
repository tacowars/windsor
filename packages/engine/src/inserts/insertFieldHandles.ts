/**
 * An insert stage's lane handles (windsor#345, record
 * `2026-10-01-song-automation-lanes` decisions 2 and 9): `stage.param(field)`
 * hands out a handle on the params the stage's `set` writes for that field,
 * doing `set`'s own mapping at each breakpoint.
 *
 * Each handle is a knob handle (`automation/automationHandles.ts`), built on
 * the first ask and the same object for the stage's lifetime. While it is
 * engaged, from the lane's first hold or schedule until its release, the
 * field is automated: the stage's `set` (and `setTempo`) leave its params
 * alone, as the strip's `setLevel` does for the level lane (windsor#344), so
 * a knob edit never fights the lane. The release writes the stage's current
 * spec value back.
 *
 * Where one param mixes two or more fields (a Drive's wet gain is its mix
 * times the drive's compensation, and nothing while it is off), no field's
 * target lists it: the stage names it in `shared`, and its schedule is
 * written from every field's own value at each breakpoint any of them has
 * (`sharedParamSchedule.ts`). `set` writes them through `writeShared`, never
 * itself: a knob edit is the field's new resting value, so where another
 * field's lane holds the param the schedule is written again from now.
 *
 * Every kind's `enabled` is a field too (windsor#628): a worklet kind's
 * `paramOf` names its `enabled` param, and a native kind folds it into the
 * gains `set` writes for it, shared with Mix where Mix writes them too.
 */
import type { AutomationHandle, KnobHandle, KnobTarget } from '../automation/automationHandles';
import { knobHandle, sameValue } from '../automation/automationHandles';
import { FieldTimeline } from './fieldTimeline';
import type { SharedParam } from './sharedParamSchedule';
import { SharedSchedule, sharedFieldHandle } from './sharedParamSchedule';

/** A stage's handles, by field, and the lock `set` reads. */
export interface FieldHandles {
  /** `field`'s handle; undefined where the stage writes no param for it. */
  param(field: string): AutomationHandle | undefined;
  /** Whether a lane holds `field`'s params now: `set` leaves them alone. */
  automated(field: string): boolean;
  /**
   * Writes every shared param from its fields' values now, for `set` after
   * the spec changed: directly where no lane holds any of its fields, and
   * through its schedule from now where one does, so a knob is heard at
   * once beside another field's lane (windsor#628, fix round for PR #632).
   */
  writeShared(): void;
}

/** The params fields share, and the audio clock their schedules prune by. */
export interface SharedParams {
  readonly params: readonly SharedParam[];
  readonly now: () => number;
}

/**
 * Handles over `target`, which says what one field alone writes, or
 * undefined for none, and over `shared`, the params fields write together.
 * A field a shared param reads has a target, if only an empty one.
 */
export function fieldHandles(
  target: (field: string) => KnobTarget | undefined,
  shared?: SharedParams,
): FieldHandles {
  const handles = new Map<string, KnobHandle>();
  const timelines = new Map<string, FieldTimeline>();
  const timeline = (field: string): FieldTimeline => {
    let found = timelines.get(field);
    if (!found) {
      found = new FieldTimeline(target(field)!.resting);
      timelines.set(field, found);
    }
    return found;
  };
  const automated = (field: string): boolean => handles.get(field)?.engaged === true;
  const schedules = (shared?.params ?? []).map(
    (p) => new SharedSchedule(p, p.fields.map(timeline)),
  );
  return {
    param(field) {
      const found = handles.get(field);
      if (found) return found;
      const t = target(field);
      if (!t) return undefined;
      const own = knobHandle(t);
      const tracked = timelines.get(field);
      const handle =
        tracked && shared ? sharedFieldHandle(own, tracked, schedules, shared.now) : own;
      handles.set(field, handle);
      return handle;
    },
    automated,
    writeShared() {
      if (!shared) return;
      const now = shared.now();
      shared.params.forEach((p, i) => schedules[i]!.restAt(now, p.fields.some(automated)));
    },
  };
}

/** A worklet stage's flat params, written from a spec's values except where a lane holds one. */
export interface WorkletFieldParams {
  /** The handle on `field`'s param, by `paramOf`. */
  param(field: string): AutomationHandle | undefined;
  /** `values` onto the processor's params, by name, skipping each one a lane holds. */
  write(values: Readonly<Record<string, number>>): void;
}

/**
 * A worklet kind's handles (decision 1): one k-rate param per field, named
 * by `paramOf`, written as the lane's value. `resting` is the value `set`
 * would write to a param now, which a release restores.
 */
export function workletFieldParams(
  processor: AudioWorkletNode,
  resting: (param: string) => number,
  paramOf: (field: string) => string | undefined,
): WorkletFieldParams {
  const handles = fieldHandles((name) => {
    const param = processor.parameters.get(name);
    return param && { params: [param], write: sameValue, resting: () => resting(name) };
  });
  return {
    param(field) {
      const name = paramOf(field);
      return name === undefined ? undefined : handles.param(name);
    },
    write(values) {
      for (const name in values) {
        if (!handles.automated(name)) processor.parameters.get(name)!.value = values[name]!;
      }
    },
  };
}

/** The on/off field every kind's spec has, and every worklet kind's param of the same name. */
export const SWITCH_FIELD = 'enabled';

/** A field that names its own param, when it is one of `numbers` or the switch. */
export const ownParam =
  (numbers: object) =>
  (field: string): string | undefined =>
    Object.hasOwn(numbers, field) || field === SWITCH_FIELD ? field : undefined;

/** A native kind's switch, as `set` writes it: 1 on, 0 off. */
export const switchOf = (spec: { readonly enabled: boolean }): number => Number(spec.enabled);
