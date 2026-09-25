/** Song-owned settings for the ensemble insert (#695); preset selection writes values. */
import type { FieldNormaliser } from '../song/arrangementFields';
import { ENSEMBLE_BOUNDS, ENSEMBLE_DEFAULTS } from './ensembleConstants';

export interface EnsembleSpec {
  readonly kind: 'ensemble';
  /** Hz: the slow ("chorus") LFO. */
  readonly slowRate: number;
  /** ms: how far the slow LFO swings each line either side of its centre. */
  readonly slowDepth: number;
  /** Hz: the fast ("vibrato") LFO. */
  readonly fastRate: number;
  /** ms: the fast LFO's swing. */
  readonly fastDepth: number;
  /** ms: each line's centre delay. */
  readonly delay: number;
  /** Hz: the lowpass after the lines, standing in for the BBD filtering. */
  readonly tone: number;
  /** 0 the lines summed to mono on both sides .. 1 left / centre / right. */
  readonly width: number;
  /** 0 dry .. 1 wet. */
  readonly mix: number;
  readonly enabled: boolean;
}

export const DEFAULT_ENSEMBLE: EnsembleSpec = { kind: 'ensemble', ...ENSEMBLE_DEFAULTS };
export const ENSEMBLE_NUMBERS = Object.keys(ENSEMBLE_BOUNDS) as Array<keyof typeof ENSEMBLE_BOUNDS>;
export const ENSEMBLE_FIELDS = ['kind', ...Object.keys(ENSEMBLE_DEFAULTS)];

export function normaliseEnsemble(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): EnsembleSpec {
  n.dropUnknown(raw, ENSEMBLE_FIELDS, path);
  const values = { ...ENSEMBLE_DEFAULTS };
  for (const name of ENSEMBLE_NUMBERS) {
    const [min, max] = ENSEMBLE_BOUNDS[name];
    values[name] = n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  values.enabled = n.bool(raw.enabled, values.enabled, `${path}.enabled`);
  return { kind: 'ensemble', ...values };
}
