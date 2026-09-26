/**
 * The bass card's operations (#707), without the DOM: which controls the
 * pitch mode uses, the Fixed degree picker's choices named from the key,
 * the seed a typed field or a Reseed press writes. Every function returns
 * data; the card writes it through `ctx.change`.
 */
import type { BassPitchMode } from '../../../packages/client/src/audio/index-for-editor';
import {
  BASS_PITCH_MODES,
  foldDegree,
  pitchClassName,
  scaleOffsets,
  toRoman,
} from '../../../packages/client/src/audio/index-for-editor';
import { BASS_RESEED_SPAN } from './bassConstants';
import type { Key } from './gridModel';

const MODE_LABELS: Readonly<Record<BassPitchMode, string>> = {
  followRoot: 'Follow Root',
  followChord: 'Follow Chord',
  fixed: 'Fixed',
};

/** The Pitch mode seg's choices, in the engine's order. */
export const BASS_MODE_OPTIONS: readonly { value: BassPitchMode; label: string }[] =
  BASS_PITCH_MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }));

export const isBassPitchMode = (value: string): value is BassPitchMode =>
  (BASS_PITCH_MODES as readonly string[]).includes(value);

/** Which mode-bound controls are live: Root bias for Follow Chord, the degree for Fixed. */
export function bassControlsEnabled(mode: BassPitchMode): {
  rootBias: boolean;
  fixedDegree: boolean;
} {
  return { rootBias: mode === 'followChord', fixedDegree: mode === 'fixed' };
}

/** One degree as a numeral and the pitch it names in the key: `V G`. */
function degreeLabel(degree: number, key: Key): string {
  const offsets = scaleOffsets(key.scale);
  const folded = foldDegree(degree, offsets.length);
  const carry = folded.carry > 0 ? ` +${folded.carry}` : '';
  return `${toRoman(degree + 1)} ${pitchClassName(key.root, offsets[folded.degree] ?? 0)}${carry}`;
}

/**
 * The Fixed degree select: one choice per degree of the scale (the seven
 * numerals of a seven-note scale), plus the written degree when a document
 * carries one past the scale's end, so the select never misreports it.
 */
export function fixedDegreeOptions(key: Key, current: number): { value: string; label: string }[] {
  const count = scaleOffsets(key.scale).length;
  const degrees = Array.from({ length: count }, (_, i) => i);
  if (current >= count) degrees.push(current);
  return degrees.map((degree) => ({ value: String(degree), label: degreeLabel(degree, key) }));
}

/** A typed seed: a safe integer, or null to restore the field. */
export function seedFromText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** Reseed's sequencer partial: a fresh seed from `random`, which rebuilds the part at once. */
export function reseedChange(random: () => number = Math.random): { seed: number } {
  return { seed: Math.floor(random() * BASS_RESEED_SPAN) };
}
