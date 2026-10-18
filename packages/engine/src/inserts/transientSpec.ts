/**
 * The Transient insert's song-owned settings (record
 * `2026-10-18-transient-insert` decision 2): a flat spec of four numbers and
 * the switch. There is no threshold, ratio, timing, sidechain or link: the
 * followers' timing is the shipped row of `transientTables.ts`, never a field.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { TRANSIENT_BOUNDS, TRANSIENT_DEFAULTS } from './transientConstants';

export interface TransientSpec {
  readonly kind: 'transient';
  /** dB at each hit's front, −15 to +15. */
  readonly attack: number;
  /** dB on each hit's decay, −24 to +24. */
  readonly sustain: number;
  /** dB after the shaping, −20 to +6. */
  readonly output: number;
  /** 0 the input, 1 the shaped signal. */
  readonly mix: number;
  readonly enabled: boolean;
}

export const DEFAULT_TRANSIENT: TransientSpec = {
  kind: 'transient',
  ...TRANSIENT_DEFAULTS,
  enabled: true,
};

export const TRANSIENT_FIELDS = Object.keys(DEFAULT_TRANSIENT);
export const TRANSIENT_NUMBERS = Object.keys(TRANSIENT_BOUNDS) as Array<
  keyof typeof TRANSIENT_BOUNDS
>;

export function normaliseTransient(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): TransientSpec {
  n.dropUnknown(raw, TRANSIENT_FIELDS, path);
  const values: Record<keyof typeof TRANSIENT_BOUNDS, number> = { ...TRANSIENT_DEFAULTS };
  for (const name of TRANSIENT_NUMBERS) {
    const [min, max] = TRANSIENT_BOUNDS[name];
    values[name] = n.num(raw[name], TRANSIENT_DEFAULTS[name], min, max, `${path}.${name}`);
  }
  return {
    kind: 'transient',
    ...values,
    enabled: n.bool(raw.enabled, DEFAULT_TRANSIENT.enabled, `${path}.enabled`),
  };
}
