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
 * Where one param mixes two fields (a Drive's wet gain is its mix times the
 * drive's compensation), each field's handle writes it from the other
 * field's `live` value: the other lane's latest while that one is engaged,
 * else the spec's.
 */
import type { AutomationHandle, KnobHandle, KnobTarget } from '../automation/automationHandles';
import { knobHandle, sameValue } from '../automation/automationHandles';

/** A stage's handles, by field, and the lock `set` reads. */
export interface FieldHandles {
  /** `field`'s handle; undefined where the stage writes no param for it. */
  param(field: string): AutomationHandle | undefined;
  /** Whether a lane holds `field`'s params now: `set` leaves them alone. */
  automated(field: string): boolean;
  /** `field`'s value now: its lane's latest while it holds the params, else `knob`. */
  live(field: string, knob: number): number;
}

/** Handles over `target`, which says what one field writes, or undefined for none. */
export function fieldHandles(target: (field: string) => KnobTarget | undefined): FieldHandles {
  const handles = new Map<string, KnobHandle>();
  const latest = new Map<string, number>();
  const engaged = (field: string): boolean => handles.get(field)?.engaged === true;
  return {
    param(field) {
      const found = handles.get(field);
      if (found) return found;
      const t = target(field);
      if (!t) return undefined;
      const write = (value: number): readonly number[] => {
        latest.set(field, value);
        return t.write(value);
      };
      const handle = knobHandle({ ...t, write });
      handles.set(field, handle);
      return handle;
    },
    automated: engaged,
    live: (field, knob) => (engaged(field) ? (latest.get(field) ?? knob) : knob),
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

/** A field that names its own param, when it is one of `numbers`. */
export const ownParam =
  (numbers: object) =>
  (field: string): string | undefined =>
    Object.hasOwn(numbers, field) ? field : undefined;
