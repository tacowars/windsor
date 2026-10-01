/** Song-owned tape controls. Old songs acquire no insert; existing sound is unchanged. */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import {
  TAPE_BOUNDS,
  TAPE_CORE_BOUNDS,
  TAPE_CORE_CONTROLS,
  TAPE_DEFAULTS,
  TAPE_MODELS,
  TAPE_OVERSAMPLING,
  TAPE_TYPES,
} from './tapeConstants';
import type { TapeOversampling } from './tapeConstants';
/**
 * The magnetic core's three controls, set per insert from the Tape card's Advanced section
 * (windsor#291): each inside `TAPE_CORE_BOUNDS`. Absent, the insert follows its model's row.
 */
export interface TapeCore {
  readonly drive: number;
  readonly width: number;
  readonly saturation: number;
}
export interface TapeSpec {
  readonly kind: 'tape';
  readonly model: (typeof TAPE_TYPES)[number];
  readonly drive: number;
  readonly bias: number;
  /** Legacy macro. split=false retains its original meaning and exact motion stream. */
  readonly wear: number;
  readonly wow: number;
  readonly flutter: number;
  readonly dropouts: number;
  readonly wowRate: number;
  readonly flutterRate: number;
  readonly split: boolean;
  readonly hiss: number;
  readonly trim: number;
  readonly mix: number;
  readonly seed: number;
  readonly enabled: boolean;
  /** The magnetic core's factor, 2 or 4: a per-insert product setting, never a knob (windsor#224, kept on 2026-10-01). */
  readonly oversampling: TapeOversampling;
  /**
   * The core's controls in place of the model's row (windsor#291). Additive: absent, the insert
   * plays exactly as before, so no format version moved.
   */
  readonly core?: TapeCore;
}
export const DEFAULT_TAPE: TapeSpec = { kind: 'tape', model: 'studio', ...TAPE_DEFAULTS };
/** The knob numbers, each clamped into its `TAPE_BOUNDS`. */
const KNOB_NUMBERS = Object.keys(TAPE_BOUNDS) as Array<keyof typeof TAPE_BOUNDS>;
/** Every number the processor takes as a parameter: the knobs and the oversampling factor. */
export const TAPE_NUMBERS: ReadonlyArray<keyof typeof TAPE_BOUNDS | 'oversampling'> = [
  ...KNOB_NUMBERS,
  'oversampling',
];
export const TAPE_FIELDS = ['kind', 'model', ...Object.keys(TAPE_DEFAULTS), 'core'];
/** One of `TAPE_OVERSAMPLING`; the default when absent, with a correction when it is not one. */
function oversampling(raw: unknown, path: string, n: FieldNormaliser): TapeOversampling {
  const fallback = TAPE_DEFAULTS.oversampling;
  if (raw === undefined) return fallback;
  const found = TAPE_OVERSAMPLING.find((factor) => factor === raw);
  if (found !== undefined) return found;
  n.correction(
    `${path}: ${String(raw)} is not one of ${TAPE_OVERSAMPLING.join('|')} — using ${fallback}`,
  );
  return fallback;
}
/** `model`'s row as the core's three controls. */
export function tapeModelCore(model: TapeSpec['model']): TapeCore {
  const [drive, width, saturation] = TAPE_MODELS[TAPE_TYPES.indexOf(model)]!.magnetic;
  return { drive, width, saturation };
}
/**
 * A song's `core`: absent stays absent; an object has each control clamped into
 * `TAPE_CORE_BOUNDS`, a missing or junk one taking the model's row; anything else is dropped
 * with a correction. Clamped, never refused (windsor#291 decision 1).
 */
function core(
  raw: unknown,
  model: TapeSpec['model'],
  path: string,
  n: FieldNormaliser,
): TapeCore | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    n.correction(`${path}: ${show(raw)} is not an object — following the model`);
    return undefined;
  }
  n.dropUnknown(raw, TAPE_CORE_CONTROLS, path);
  const row = tapeModelCore(model);
  const value = (name: (typeof TAPE_CORE_CONTROLS)[number]): number => {
    const [min, max] = TAPE_CORE_BOUNDS[name];
    return n.num(raw[name], row[name], min, max, `${path}.${name}`);
  };
  return { drive: value('drive'), width: value('width'), saturation: value('saturation') };
}
export function normaliseTape(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): TapeSpec {
  n.dropUnknown(raw, TAPE_FIELDS, path);
  const values = { ...TAPE_DEFAULTS };
  for (const name of KNOB_NUMBERS) {
    const [min, max] = TAPE_BOUNDS[name];
    values[name] =
      name === 'seed'
        ? n.int(raw[name], values[name], min, max, `${path}.${name}`)
        : n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  values.split = n.bool(raw.split, values.split, `${path}.split`);
  values.enabled = n.bool(raw.enabled, values.enabled, `${path}.enabled`);
  values.oversampling = oversampling(raw.oversampling, `${path}.oversampling`, n);
  const model = n.pick(raw.model, TAPE_TYPES, DEFAULT_TAPE.model, `${path}.model`);
  const override = core(raw.core, model, `${path}.core`, n);
  return { kind: 'tape', model, ...values, ...(override ? { core: override } : {}) };
}
