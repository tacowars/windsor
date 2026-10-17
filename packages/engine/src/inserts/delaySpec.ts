/** Saved Dub delay settings; tempo belongs to the song and never to the insert. */
import type { FieldNormaliser } from '../song/arrangementFields';
import {
  DELAY_BOUNDS,
  DELAY_CHARACTERS,
  DELAY_DEFAULTS,
  DELAY_DIVISIONS,
  DELAY_DSP,
  DELAY_FILTERS,
  DELAY_MODES,
  DELAY_WAVES,
} from './delayConstants';

export interface DelaySpec {
  readonly kind: 'delay';
  readonly mode: (typeof DELAY_MODES)[number];
  readonly leftSync: boolean;
  readonly rightSync: boolean;
  readonly leftDivision: keyof typeof DELAY_DIVISIONS;
  readonly rightDivision: keyof typeof DELAY_DIVISIONS;
  readonly leftMs: number;
  readonly rightMs: number;
  readonly feedback: number;
  readonly cross: number;
  readonly sustain: boolean;
  readonly filter: (typeof DELAY_FILTERS)[number];
  readonly lowCut: number;
  readonly cutoff: number;
  readonly resonance: number;
  readonly width: number;
  readonly character: (typeof DELAY_CHARACTERS)[number];
  readonly drive: number;
  readonly damping: number;
  readonly dampingHz: number;
  readonly wave: (typeof DELAY_WAVES)[number];
  readonly modRate: number;
  readonly wow: number;
  readonly sweep: number;
  readonly mix: number;
  readonly outputDb: number;
  readonly enabled: boolean;
}
export const DEFAULT_DELAY: DelaySpec = {
  kind: 'delay',
  mode: 'stereo',
  leftSync: true,
  rightSync: true,
  leftDivision: '1/8D',
  rightDivision: '1/4',
  filter: 'lowpass',
  character: 'warm',
  wave: 'drift',
  ...DELAY_DEFAULTS,
};
export const DELAY_NUMBERS = Object.keys(DELAY_BOUNDS) as Array<keyof typeof DELAY_BOUNDS>;
export const DELAY_FIELDS = Object.keys(DEFAULT_DELAY);
const divisions = Object.keys(DELAY_DIVISIONS) as Array<keyof typeof DELAY_DIVISIONS>;

export function normaliseDelay(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): DelaySpec {
  n.dropUnknown(raw, DELAY_FIELDS, path);
  const values = { ...DEFAULT_DELAY };
  for (const name of DELAY_NUMBERS) {
    const [min, max] = DELAY_BOUNDS[name];
    values[name] = n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  for (const name of ['enabled', 'leftSync', 'rightSync', 'sustain'] as const)
    values[name] = n.bool(raw[name], values[name], `${path}.${name}`);
  for (const name of ['leftDivision', 'rightDivision'] as const)
    values[name] = n.pick(raw[name], divisions, values[name], `${path}.${name}`);
  values.mode = n.pick(raw.mode, DELAY_MODES, values.mode, `${path}.mode`);
  values.filter = n.pick(raw.filter, DELAY_FILTERS, values.filter, `${path}.filter`);
  values.character = n.pick(raw.character, DELAY_CHARACTERS, values.character, `${path}.character`);
  values.wave = n.pick(raw.wave, DELAY_WAVES, values.wave, `${path}.wave`);
  return values;
}

/** Synced times saturate at 12 seconds for extremely slow imported tempos. */
export function delayMilliseconds(spec: DelaySpec, side: 'left' | 'right', bpm: number): number {
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : DELAY_DSP.defaultBpm;
  const ms = spec[`${side}Sync`]
    ? (DELAY_DSP.milliseconds *
        DELAY_DSP.secondsPerMinute *
        DELAY_DIVISIONS[spec[`${side}Division`]]) /
      tempo
    : spec[`${side}Ms`];
  return Math.max(
    DELAY_BOUNDS.leftMs[0],
    Math.min(DELAY_DSP.maxSeconds * DELAY_DSP.milliseconds, ms),
  );
}
