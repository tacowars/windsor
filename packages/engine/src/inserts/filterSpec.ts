/**
 * The Filter insert's song-owned settings (windsor#622): its mode, the SVF
 * modes' slope, and the cutoff, Reso and mix a lane may move. No presets.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { FILTER_BOUNDS, FILTER_DEFAULTS, FILTER_MODES } from './filterConstants';
import type { FilterMode } from './filterConstants';

export interface FilterSpec {
  readonly kind: 'filter';
  readonly mode: FilterMode;
  /** The SVF modes' second section; Acid ignores it. */
  readonly slope24: boolean;
  readonly cutoff: number;
  readonly resonance: number;
  readonly mix: number;
  readonly enabled: boolean;
}

export const DEFAULT_FILTER: FilterSpec = {
  kind: 'filter',
  mode: 'lowpass',
  slope24: false,
  ...FILTER_DEFAULTS,
  enabled: true,
};

export const FILTER_NUMBERS = Object.keys(FILTER_BOUNDS) as Array<keyof typeof FILTER_BOUNDS>;
export const FILTER_FIELDS = Object.keys(DEFAULT_FILTER);

export function normaliseFilter(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): FilterSpec {
  n.dropUnknown(raw, FILTER_FIELDS, path);
  const values = { ...DEFAULT_FILTER };
  for (const name of FILTER_NUMBERS) {
    const [min, max] = FILTER_BOUNDS[name];
    values[name] = n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  for (const name of ['slope24', 'enabled'] as const)
    values[name] = n.bool(raw[name], values[name], `${path}.${name}`);
  values.mode = n.pick(raw.mode, FILTER_MODES, values.mode, `${path}.mode`);
  return values;
}
