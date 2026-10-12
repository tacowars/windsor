/**
 * The Reverb's preset bank (windsor#774, `reverbPresetBank.ts`): 27 presets in four groups, the
 * Starting point picker's order. Selecting a preset writes all 17 space fields (the 16 numbers
 * and the voicing), so a preset is the whole space; Mix and the on/off switch stay the user's.
 * A song stores the values, never a preset number (record `2026-10-12-reverb-preset-bank`).
 */
import type { ReverbSpace } from '../mixer/reverbSpace';
import type { ReverbInsertSpec } from './reverbInsert';
import { REVERB_PRESETS } from './reverbPresetBank';

/** A preset's settings: the whole space, its voicing included. */
export type ReverbPresetSettings = Readonly<ReverbSpace>;
/** The picker's groups, in its order. */
export type ReverbPresetGroup = 'Everyday' | 'Drums' | 'Pads & leads' | 'Ambient';
export interface ReverbPreset {
  readonly number: number;
  readonly label: string;
  readonly group: ReverbPresetGroup;
  readonly settings: ReverbPresetSettings;
}

export { REVERB_PRESETS };

/** The groups in the picker's order. */
export const REVERB_PRESET_GROUPS: readonly ReverbPresetGroup[] = [
  'Everyday',
  'Drums',
  'Pads & leads',
  'Ambient',
];

/** The preset numbered `number`, if the bank has it. */
export const reverbPreset = (number: number): ReverbPreset | undefined =>
  REVERB_PRESETS.find((entry) => entry.number === number);

/** `spec` with the preset's whole space written over it: its Mix and switch kept. */
export function applyReverbPreset(spec: ReverbInsertSpec, number: number): ReverbInsertSpec {
  const preset = reverbPreset(number);
  return preset ? { ...spec, ...preset.settings } : spec;
}

/** The number of the preset whose space `space` holds exactly, field by field, if any. */
export function matchingReverbPreset(space: Readonly<ReverbSpace> | undefined): number | undefined {
  if (!space) return undefined;
  return REVERB_PRESETS.find((preset) =>
    (Object.keys(preset.settings) as (keyof ReverbSpace)[]).every(
      (key) => preset.settings[key] === space[key],
    ),
  )?.number;
}
