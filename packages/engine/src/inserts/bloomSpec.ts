/** Song-owned settings for the bloom insert; every number clamped to its bounds, every enum checked. */
import type { FieldNormaliser } from '../song/arrangementFields';
import type { InsertSpec } from './insertRegistry';
import {
  BLOOM_BOUNDS,
  BLOOM_DEFAULTS,
  BLOOM_KEY_DEFAULT,
  BLOOM_OCTAVES,
  BLOOM_SCALE_DEFAULT,
} from './bloomConstants';
import type { BloomNumber } from './bloomConstants';
import { BLOOM_KEY_CHOICES, BLOOM_SCALE_CHOICES } from './bloomPitches';
import type { BloomKey, BloomScale } from './bloomPitches';

export type { BloomKey, BloomScale };

export interface BloomSpec {
  readonly kind: 'bloom';
  /** The generated layer's level, 0..1 (squared law). */
  readonly amount: number;
  /** 0 dry, 0.5 dry + layer, 1 layer only. */
  readonly mix: number;
  /** Seconds of attack on each band's level. */
  readonly swell: number;
  /** Seconds a band keeps sounding after its input leaves. */
  readonly sustain: number;
  /** Hold the current chord as a drone. */
  readonly freeze: boolean;
  /** 0 mono, 1 bands panned fully left and right. */
  readonly spread: number;
  /** 0 sine, 1 triangle, 2 saw, 3 square, 4 pulse (`BLOOM_SHAPES`); between them a morph. */
  readonly shape: number;
  /** dB per octave on the upper partials. */
  readonly bright: number;
  /** Semitones: one of `BLOOM_OCTAVES`. */
  readonly octave: number;
  /** Scale's root: one of Windsor's note names (`BLOOM_KEY_CHOICES`), `C` … `B`. */
  readonly key: BloomKey;
  /**
   * `chromatic` (off), `song` (the song's key, resolved in the stage; `key`
   * stays as it was underneath), or one of Windsor's `SCALE_NAMES`
   * (`BLOOM_SCALE_CHOICES`).
   */
  readonly scale: BloomScale;
  /** The lowest and highest band, as MIDI notes. */
  readonly low: number;
  readonly high: number;
  /** A factor on every band's width. */
  readonly focus: number;
  /** The shared compressor's amount, 0..1. */
  readonly density: number;
  readonly enabled: boolean;
  /**
   * The child insert on the generated layer, before Mix (record
   * `2026-10-11-wet-path-slot`): bloom is a host. Absent or null is none, so a
   * spec built in code without it is valid. The registry normalises it.
   */
  readonly slot?: InsertSpec | null;
}

export const DEFAULT_BLOOM: BloomSpec = {
  kind: 'bloom',
  ...BLOOM_DEFAULTS,
  key: BLOOM_KEY_DEFAULT,
  scale: BLOOM_SCALE_DEFAULT,
  slot: null,
};

/** The numbers clamped as they are; Low, High and Octave are whole semitones. */
export const BLOOM_NUMBERS = Object.keys(BLOOM_BOUNDS) as BloomNumber[];
const BLOOM_WHOLE: readonly BloomNumber[] = ['low', 'high', 'octave'];
export const BLOOM_SWITCHES = ['freeze', 'enabled'] as const;
export const BLOOM_FIELDS = ['kind', ...BLOOM_NUMBERS, ...BLOOM_SWITCHES, 'key', 'scale', 'slot'];

/** `value` if it is one of `BLOOM_OCTAVES`, else the nearest (reported). */
function octaveOf(value: number, path: string, n: FieldNormaliser): number {
  let nearest: number = BLOOM_OCTAVES[0];
  for (const step of BLOOM_OCTAVES)
    if (Math.abs(step - value) < Math.abs(nearest - value)) nearest = step;
  if (nearest !== value) n.correction(`${path}: ${value} is not an Octave step — using ${nearest}`);
  return nearest;
}

/** `raw` over the defaults; `slot` is the registry's (`normaliseInsertEntry`), so this leaves it empty. */
export function normaliseBloom(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): BloomSpec {
  n.dropUnknown(raw, BLOOM_FIELDS, path);
  const values = { ...BLOOM_DEFAULTS };
  for (const name of BLOOM_NUMBERS) {
    const [min, max] = BLOOM_BOUNDS[name];
    const read = BLOOM_WHOLE.includes(name) ? n.int.bind(n) : n.num.bind(n);
    values[name] = read(raw[name], values[name], min, max, `${path}.${name}`);
  }
  values.octave = octaveOf(values.octave, `${path}.octave`, n);
  for (const name of BLOOM_SWITCHES)
    values[name] = n.bool(raw[name], values[name], `${path}.${name}`);
  return {
    kind: 'bloom',
    ...values,
    key: n.pick(raw.key, BLOOM_KEY_CHOICES, BLOOM_KEY_DEFAULT, `${path}.key`),
    scale: n.pick(raw.scale, BLOOM_SCALE_CHOICES, BLOOM_SCALE_DEFAULT, `${path}.scale`),
    slot: null,
  };
}
