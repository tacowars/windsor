/** Song-owned settings for the original retro reverb; preset selection writes values. */
import type { FieldNormaliser } from '../song/arrangementFields';
import {
  RETRO_REVERB_BOUNDS,
  RETRO_REVERB_CONVERTERS,
  RETRO_REVERB_DEFAULTS,
  RETRO_REVERB_MODES,
} from './retroReverbConstants';

export interface RetroReverbSpec {
  readonly kind: 'retro-reverb';
  readonly mode: (typeof RETRO_REVERB_MODES)[number];
  readonly converter: (typeof RETRO_REVERB_CONVERTERS)[number];
  readonly duration: number;
  readonly decay: number;
  readonly size: number;
  readonly tone: number;
  readonly diffusion: number;
  readonly preDelay: number;
  readonly character: number;
  readonly mix: number;
  readonly enabled: boolean;
  readonly early: number;
  readonly driftRate: number;
  readonly driftDepth: number;
  readonly density: number;
  readonly lowDecay: number;
  readonly lowCross: number;
}
export const DEFAULT_RETRO_REVERB: RetroReverbSpec = {
  kind: 'retro-reverb',
  mode: 'reverb',
  converter: 'linear',
  ...RETRO_REVERB_DEFAULTS,
};
export const RETRO_REVERB_NUMBERS = Object.keys(RETRO_REVERB_BOUNDS) as Array<
  keyof typeof RETRO_REVERB_BOUNDS
>;
export const RETRO_REVERB_FIELDS = [
  'kind',
  'mode',
  'converter',
  ...Object.keys(RETRO_REVERB_DEFAULTS),
];

export function normaliseRetroReverb(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): RetroReverbSpec {
  n.dropUnknown(raw, RETRO_REVERB_FIELDS, path);
  const values = { ...RETRO_REVERB_DEFAULTS };
  for (const name of RETRO_REVERB_NUMBERS) {
    const [min, max] = RETRO_REVERB_BOUNDS[name];
    values[name] = n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  values.enabled = n.bool(raw.enabled, values.enabled, `${path}.enabled`);
  const mode = RETRO_REVERB_MODES.find((value) => value === raw.mode) ?? 'reverb';
  if (raw.mode !== undefined && raw.mode !== mode) n.correction(`${path}.mode: using reverb`);
  const converter = RETRO_REVERB_CONVERTERS.find((value) => value === raw.converter) ?? 'linear';
  if (raw.converter !== undefined && raw.converter !== converter)
    n.correction(`${path}.converter: using linear`);
  return { kind: 'retro-reverb', mode, converter, ...values };
}
