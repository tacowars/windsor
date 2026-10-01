/**
 * Materialize the legacy Wear macro when an independent motion dial is first edited, and the
 * magnetic core's per-insert controls (windsor#291).
 */
import type { TapeCore, TapeSpec } from './tapeSpec';
import { tapeModelCore } from './tapeSpec';
import { TAPE_CORE_BOUNDS, type TAPE_BOUNDS } from './tapeConstants';
export type TapeNumber = keyof typeof TAPE_BOUNDS;
export function tapeControlValue(spec: TapeSpec, field: TapeNumber): number {
  if (!spec.split && (field === 'wow' || field === 'flutter' || field === 'dropouts'))
    return spec.wear;
  return spec[field];
}
export function setTapeControl(spec: TapeSpec, field: TapeNumber, value: number): TapeSpec {
  if (field === 'wow' || field === 'flutter' || field === 'dropouts') {
    return {
      ...spec,
      wow: tapeControlValue(spec, 'wow'),
      flutter: tapeControlValue(spec, 'flutter'),
      dropouts: tapeControlValue(spec, 'dropouts'),
      split: true,
      [field]: value,
    };
  }
  return { ...spec, [field]: value };
}
/**
 * The core's controls the insert plays: its `core`, or its model's row while it has none, which
 * is what the Advanced section's knobs show.
 */
export function tapeCoreOf(spec: TapeSpec): TapeCore {
  return spec.core ?? tapeModelCore(spec.model);
}
/**
 * `spec` with one core control turned: all three are written into `core`, the others as they
 * play, each clamped into `TAPE_CORE_BOUNDS`. A model row can sit outside the box (Vintage's and
 * VHS's widths), and the first knob turned on such a model brings that control to the box's edge.
 */
export function setTapeCore(spec: TapeSpec, field: keyof TapeCore, value: number): TapeSpec {
  const next = { ...tapeCoreOf(spec), [field]: value };
  const clamp = (name: keyof TapeCore): number =>
    Math.min(TAPE_CORE_BOUNDS[name][1], Math.max(TAPE_CORE_BOUNDS[name][0], next[name]));
  return {
    ...spec,
    core: { drive: clamp('drive'), width: clamp('width'), saturation: clamp('saturation') },
  };
}
/** `spec` following its model's row again: the Advanced section's Use model. */
export function clearTapeCore(spec: TapeSpec): TapeSpec {
  if (!spec.core) return spec;
  const rest: { -readonly [K in keyof TapeSpec]?: TapeSpec[K] } = { ...spec };
  delete rest.core;
  return rest as TapeSpec;
}
