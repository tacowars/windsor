/** Song-owned tape controls. Old songs acquire no insert; existing sound is unchanged. */
import type { FieldNormaliser } from '../song/arrangementFields';
import { TAPE_BOUNDS, TAPE_DEFAULTS, TAPE_TYPES } from './tapeConstants';
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
}
export const DEFAULT_TAPE: TapeSpec = { kind: 'tape', model: 'studio', ...TAPE_DEFAULTS };
export const TAPE_NUMBERS = Object.keys(TAPE_BOUNDS) as Array<keyof typeof TAPE_BOUNDS>;
export const TAPE_FIELDS = ['kind', 'model', ...Object.keys(TAPE_DEFAULTS)];
export function normaliseTape(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): TapeSpec {
  n.dropUnknown(raw, TAPE_FIELDS, path);
  const values = { ...TAPE_DEFAULTS };
  for (const name of TAPE_NUMBERS) {
    const [min, max] = TAPE_BOUNDS[name];
    values[name] =
      name === 'seed'
        ? n.int(raw[name], values[name], min, max, `${path}.${name}`)
        : n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  values.split = n.bool(raw.split, values.split, `${path}.split`);
  values.enabled = n.bool(raw.enabled, values.enabled, `${path}.enabled`);
  return {
    kind: 'tape',
    model: n.pick(raw.model, TAPE_TYPES, DEFAULT_TAPE.model, `${path}.model`),
    ...values,
  };
}
