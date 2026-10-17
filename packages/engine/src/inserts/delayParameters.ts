/**
 * The Dub delay's flat AudioParam vocabulary: a spec at a song tempo becomes
 * the processor's named k-rate parameters (`worklet/delay/delaySlots.ts`'s
 * `DELAY_PARAM_KEYS`), its choices as their ids and its switches as 0 or 1.
 * The insert, the test harness and the allocation scenario all write through
 * this, so they cannot disagree.
 */
import {
  DELAY_CHARACTER_IDS,
  DELAY_FILTER_IDS,
  DELAY_MODE_IDS,
  DELAY_WAVE_IDS,
} from './delayConstants';
import { DELAY_NUMBERS, delayMilliseconds } from './delaySpec';
import type { DelaySpec } from './delaySpec';

/** The two sides' times: a synced side's from the tempo. */
export const delayTiming = (spec: DelaySpec, bpm: number): Record<string, number> => ({
  leftMs: delayMilliseconds(spec, 'left', bpm),
  rightMs: delayMilliseconds(spec, 'right', bpm),
});

/** Every parameter, by name, for `spec` at `bpm`. */
export function delayParameters(spec: DelaySpec, bpm: number): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of DELAY_NUMBERS) values[name] = spec[name];
  values.mode = DELAY_MODE_IDS[spec.mode];
  values.filter = DELAY_FILTER_IDS[spec.filter];
  values.character = DELAY_CHARACTER_IDS[spec.character];
  values.wave = DELAY_WAVE_IDS[spec.wave];
  values.sustain = Number(spec.sustain);
  values.enabled = Number(spec.enabled);
  return { ...values, ...delayTiming(spec, bpm) };
}
