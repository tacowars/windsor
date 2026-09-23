/** The song contract for the compressor; every setting travels with the song. */
import type { FieldNormaliser } from '../arrangementFields';
import {
  COMPRESSOR_ATTACKS,
  COMPRESSOR_BOUNDS,
  COMPRESSOR_DEFAULTS,
  COMPRESSOR_RATIOS,
  COMPRESSOR_RELEASES,
} from './compressorConstants';

export interface CompressorSpec {
  readonly kind: 'compressor';
  readonly threshold: number;
  readonly makeup: number;
  /** Milliseconds, from COMPRESSOR_ATTACKS. */
  readonly attack: number;
  readonly ratio: number;
  /** Seconds; zero is Auto. */
  readonly release: number;
  /** Detector-only highpass in Hz; zero bypasses it. */
  readonly highpass: number;
  readonly range: number;
  readonly mix: number;
  readonly enabled: boolean;
}
export const DEFAULT_COMPRESSOR: CompressorSpec = { kind: 'compressor', ...COMPRESSOR_DEFAULTS };
export const COMPRESSOR_FIELDS = ['kind', ...Object.keys(COMPRESSOR_DEFAULTS)];
export const COMPRESSOR_NUMBERS = Object.keys(COMPRESSOR_BOUNDS) as Array<
  keyof typeof COMPRESSOR_BOUNDS
>;

function stepped(
  value: number,
  choices: readonly number[],
  path: string,
  n: FieldNormaliser,
): number {
  let nearest = choices[0]!;
  for (const choice of choices)
    if (Math.abs(choice - value) < Math.abs(nearest - value)) nearest = choice;
  if (nearest !== value) n.correction(`${path}: clamped ${value} to ${nearest}`);
  return nearest;
}

export function normaliseCompressor(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): CompressorSpec {
  n.dropUnknown(raw, COMPRESSOR_FIELDS, path);
  const values: Record<keyof typeof COMPRESSOR_BOUNDS, number> = { ...COMPRESSOR_DEFAULTS };
  for (const name of COMPRESSOR_NUMBERS) {
    const [min, max] = COMPRESSOR_BOUNDS[name];
    values[name] = n.num(raw[name], COMPRESSOR_DEFAULTS[name], min, max, `${path}.${name}`);
  }
  return {
    kind: 'compressor',
    threshold: values.threshold,
    makeup: values.makeup,
    attack: stepped(values.attack, COMPRESSOR_ATTACKS, `${path}.attack`, n),
    ratio: stepped(values.ratio, COMPRESSOR_RATIOS, `${path}.ratio`, n),
    release: stepped(values.release, COMPRESSOR_RELEASES, `${path}.release`, n),
    highpass: values.highpass,
    range: values.range,
    mix: values.mix,
    enabled: n.bool(raw.enabled, COMPRESSOR_DEFAULTS.enabled, `${path}.enabled`),
  };
}
