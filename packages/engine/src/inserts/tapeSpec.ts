/** Song-owned tape controls. Old songs acquire no insert; existing sound is unchanged. */
import type { FieldNormaliser } from '../song/arrangementFields';
import { TAPE_BOUNDS, TAPE_DEFAULTS, TAPE_OVERSAMPLING, TAPE_TYPES } from './tapeConstants';
import type { TapeOversampling } from './tapeConstants';
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
}
export const DEFAULT_TAPE: TapeSpec = { kind: 'tape', model: 'studio', ...TAPE_DEFAULTS };
/** The knob numbers, each clamped into its `TAPE_BOUNDS`. */
const KNOB_NUMBERS = Object.keys(TAPE_BOUNDS) as Array<keyof typeof TAPE_BOUNDS>;
/** Every number the processor takes as a parameter: the knobs and the oversampling factor. */
export const TAPE_NUMBERS: ReadonlyArray<keyof typeof TAPE_BOUNDS | 'oversampling'> = [
  ...KNOB_NUMBERS,
  'oversampling',
];
export const TAPE_FIELDS = ['kind', 'model', ...Object.keys(TAPE_DEFAULTS)];
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
  return {
    kind: 'tape',
    model: n.pick(raw.model, TAPE_TYPES, DEFAULT_TAPE.model, `${path}.model`),
    ...values,
  };
}
