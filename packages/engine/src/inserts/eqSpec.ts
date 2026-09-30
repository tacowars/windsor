/**
 * The Parametric EQ's song settings (windsor#198): eight bands and three
 * globals, normalised through `FieldNormaliser` like every other insert kind.
 * The kind is additive, so `ARRANGEMENT_VERSION` does not change. Pinned by
 * `eqSpec.test.ts`.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import {
  EQ_BAND_COUNT,
  EQ_BAND_TYPES,
  EQ_BOUNDS,
  EQ_DEFAULT_BANDS,
  EQ_DEFAULTS,
  EQ_SLOPES,
} from './eqConstants';
import type { EqBandType, EqSlope } from './eqConstants';

export interface EqBand {
  readonly on: boolean;
  readonly type: EqBandType;
  /** dB/oct; heard on the cuts only. */
  readonly slope: EqSlope;
  readonly freq: number;
  /** dB; heard on the bell and the shelves only. */
  readonly gain: number;
  /** Ignored by a 6 dB/oct cut. */
  readonly q: number;
}

export interface EqSpec {
  readonly kind: 'eq';
  readonly enabled: boolean;
  /** Multiplies every bell and shelf gain (0 – 2; the console shows %). */
  readonly scale: number;
  /** dB after the bands. */
  readonly output: number;
  /** Exactly `EQ_BAND_COUNT` bands. */
  readonly bands: readonly EqBand[];
}

export const DEFAULT_EQ_BANDS: readonly EqBand[] = EQ_DEFAULT_BANDS.map((band) => ({ ...band }));
export const DEFAULT_EQ: EqSpec = { kind: 'eq', ...EQ_DEFAULTS, bands: DEFAULT_EQ_BANDS };
export const EQ_FIELDS = ['kind', 'enabled', 'scale', 'output', 'bands'];
export const EQ_BAND_FIELDS = ['on', 'type', 'slope', 'freq', 'gain', 'q'];

function normaliseSlope(
  raw: unknown,
  fallback: EqSlope,
  path: string,
  n: FieldNormaliser,
): EqSlope {
  if ((EQ_SLOPES as readonly unknown[]).includes(raw)) return raw as EqSlope;
  if (raw !== undefined)
    n.correction(`${path}: ${show(raw)} is not one of ${EQ_SLOPES.join('|')} — using ${fallback}`);
  return fallback;
}

export function normaliseEqBand(
  raw: unknown,
  fallback: EqBand,
  path: string,
  n: FieldNormaliser,
): EqBand {
  const band = n.section(raw, path);
  n.dropUnknown(band, EQ_BAND_FIELDS, path);
  return {
    on: n.bool(band.on, fallback.on, `${path}.on`),
    type: n.pick(band.type, EQ_BAND_TYPES, fallback.type, `${path}.type`),
    slope: normaliseSlope(band.slope, fallback.slope, `${path}.slope`, n),
    freq: n.num(band.freq, fallback.freq, ...EQ_BOUNDS.freq, `${path}.freq`),
    gain: n.num(band.gain, fallback.gain, ...EQ_BOUNDS.gain, `${path}.gain`),
    q: n.num(band.q, fallback.q, ...EQ_BOUNDS.q, `${path}.q`),
  };
}

function normaliseBands(raw: unknown, path: string, n: FieldNormaliser): EqBand[] {
  let list: readonly unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw !== undefined)
    n.correction(`${path}: ${show(raw)} is not a list of bands — using defaults`);
  if (Array.isArray(raw) && raw.length > EQ_BAND_COUNT)
    n.correction(`${path}: ${raw.length} bands for an ${EQ_BAND_COUNT}-band EQ — truncated`);
  if (Array.isArray(raw) && raw.length < EQ_BAND_COUNT)
    n.correction(
      `${path}: ${raw.length} bands for an ${EQ_BAND_COUNT}-band EQ — filled from the defaults`,
    );
  return DEFAULT_EQ_BANDS.map((fallback, i) =>
    i < list.length ? normaliseEqBand(list[i], fallback, `${path}[${i}]`, n) : { ...fallback },
  );
}

export function normaliseEq(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): EqSpec {
  const section = isRecord(raw) ? raw : {};
  n.dropUnknown(section, EQ_FIELDS, path);
  return {
    kind: 'eq',
    enabled: n.bool(section.enabled, EQ_DEFAULTS.enabled, `${path}.enabled`),
    scale: n.num(section.scale, EQ_DEFAULTS.scale, ...EQ_BOUNDS.scale, `${path}.scale`),
    output: n.num(section.output, EQ_DEFAULTS.output, ...EQ_BOUNDS.output, `${path}.output`),
    bands: normaliseBands(section.bands, `${path}.bands`, n),
  };
}
