/** The Tape card's pure edits, testable without the DOM (windsor#246, windsor#291). */
import {
  TAPE_OVERSAMPLING,
  TAPE_TYPES,
  clearTapeCore,
  setTapeCore,
  tapeCoreOf,
  type TapeCore,
  type TapeSpec,
} from '@windsor/engine';

/**
 * `spec` with the Oversampling picker's `value` (`'2'` or `'4'`) committed as
 * `spec.oversampling`; `spec` itself when the value is not a factor the
 * engine builds.
 */
export function withOversampling(spec: TapeSpec, value: string): TapeSpec {
  const factor = TAPE_OVERSAMPLING.find((f) => String(f) === value);
  return factor === undefined ? spec : { ...spec, oversampling: factor };
}

/**
 * `spec` on the Tape type picker's `value`, or `spec` itself for a type the
 * engine lacks. A set `core` stays set (windsor#291 decision 3).
 */
export function withModel(spec: TapeSpec, value: string): TapeSpec {
  const model = TAPE_TYPES.find((type) => type === value);
  return model === undefined ? spec : { ...spec, model };
}

/** Whether the insert plays its own core controls, which the Advanced header marks "Custom". */
export function isCustomCore(spec: TapeSpec): boolean {
  return spec.core !== undefined;
}

/** What an Advanced knob shows: the insert's `core`, or its model's row while it has none. */
export function coreKnobValue(spec: TapeSpec, field: keyof TapeCore): number {
  return tapeCoreOf(spec)[field];
}

/** An Advanced knob turned: all three controls written into `core`, this one changed. */
export function withCoreKnob(spec: TapeSpec, field: keyof TapeCore, value: number): TapeSpec {
  return setTapeCore(spec, field, value);
}

/** Use model: the insert follows its model's row again. */
export function withModelCore(spec: TapeSpec): TapeSpec {
  return clearTapeCore(spec);
}

/** A knob's double-click target: the model's own value for that control. */
export function modelCoreValue(spec: TapeSpec, field: keyof TapeCore): number {
  return tapeCoreOf(clearTapeCore(spec))[field];
}
