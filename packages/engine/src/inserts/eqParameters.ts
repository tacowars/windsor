/**
 * The Parametric EQ's AudioParams (windsor#198): flat k-rate names, `b1Freq`
 * … `b8On` then `scale`, `output` and `enabled`, with a band's type and slope
 * as their numeric ids (their index in `EQ_BAND_TYPES` / `EQ_SLOPES`). The
 * stage writes them from a spec and the worklet declares and reads them, so
 * both take the names from here. Pinned by `eqInsert.test.ts`.
 */
import {
  EQ_BAND_COUNT,
  EQ_BAND_TYPES,
  EQ_BOUNDS,
  EQ_DEFAULT_BANDS,
  EQ_DEFAULTS,
  EQ_SLOPES,
  EQ_TYPE_ID,
} from './eqConstants';
import type { EqSpec } from './eqSpec';

export const EQ_BAND_PARAMS = ['Freq', 'Gain', 'Q', 'Type', 'Slope', 'On'] as const;
export type EqBandParam = (typeof EQ_BAND_PARAMS)[number];

/** `band` counts from 0; the name counts from 1, as the console does. */
export const eqParamName = (band: number, field: EqBandParam): string => `b${band + 1}${field}`;

export interface EqParameterDescriptor {
  readonly name: string;
  readonly minValue: number;
  readonly maxValue: number;
  readonly defaultValue: number;
  readonly automationRate: 'k-rate';
}

function descriptor(name: string, range: readonly number[], value: number): EqParameterDescriptor {
  return {
    name,
    minValue: range[0]!,
    maxValue: range[1]!,
    defaultValue: value,
    automationRate: 'k-rate',
  };
}

/** Every parameter, bands first, with the new-EQ defaults. */
export function eqParameterDescriptors(): EqParameterDescriptor[] {
  const list: EqParameterDescriptor[] = [];
  EQ_DEFAULT_BANDS.forEach((band, b) => {
    list.push(
      descriptor(eqParamName(b, 'Freq'), EQ_BOUNDS.freq, band.freq),
      descriptor(eqParamName(b, 'Gain'), EQ_BOUNDS.gain, band.gain),
      descriptor(eqParamName(b, 'Q'), EQ_BOUNDS.q, band.q),
      descriptor(eqParamName(b, 'Type'), [0, EQ_BAND_TYPES.length - 1], EQ_TYPE_ID[band.type]),
      descriptor(eqParamName(b, 'Slope'), [0, EQ_SLOPES.length - 1], EQ_SLOPES.indexOf(band.slope)),
      descriptor(eqParamName(b, 'On'), [0, 1], Number(band.on)),
    );
  });
  list.push(
    descriptor('scale', EQ_BOUNDS.scale, EQ_DEFAULTS.scale),
    descriptor('output', EQ_BOUNDS.output, EQ_DEFAULTS.output),
    descriptor('enabled', [0, 1], Number(EQ_DEFAULTS.enabled)),
  );
  return list;
}

/** `spec` as parameter values, written into `out`. */
export function eqParameterValues(
  spec: EqSpec,
  out: Record<string, number> = {},
): Record<string, number> {
  for (let b = 0; b < EQ_BAND_COUNT; b++) {
    const band = spec.bands[b] ?? EQ_DEFAULT_BANDS[b]!;
    out[eqParamName(b, 'Freq')] = band.freq;
    out[eqParamName(b, 'Gain')] = band.gain;
    out[eqParamName(b, 'Q')] = band.q;
    out[eqParamName(b, 'Type')] = EQ_TYPE_ID[band.type];
    out[eqParamName(b, 'Slope')] = EQ_SLOPES.indexOf(band.slope);
    out[eqParamName(b, 'On')] = Number(band.on);
  }
  out.scale = spec.scale;
  out.output = spec.output;
  out.enabled = Number(spec.enabled);
  return out;
}
