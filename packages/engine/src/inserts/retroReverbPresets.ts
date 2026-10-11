/**
 * The Retro reverb's preset bank (RV-8, `retroReverbPresetBank.ts`). Selecting a preset writes
 * every sound field, so a preset is the whole state; Mix and the on/off switch stay the user's.
 * A song stores the values, never a preset number.
 */
import type { RetroReverbSpec } from './retroReverbSpec';
import { RETRO_REVERB_PRESETS } from './retroReverbPresetBank';

export type RetroPresetSettings = Omit<RetroReverbSpec, 'kind' | 'mix' | 'enabled'>;
/** The menu's groups, in its order. */
export type RetroPresetGroup = 'Drums' | 'Pads & leads' | 'Ambient';
export interface RetroReverbPreset {
  readonly number: number;
  readonly label: string;
  readonly group: RetroPresetGroup;
  readonly settings: RetroPresetSettings;
}

export { RETRO_REVERB_PRESETS };

export function applyRetroPreset(spec: RetroReverbSpec, number: number): RetroReverbSpec {
  const preset = RETRO_REVERB_PRESETS.find((entry) => entry.number === number);
  return preset ? { ...spec, ...preset.settings } : spec;
}

export function matchingRetroPreset(spec: RetroReverbSpec): number | undefined {
  return RETRO_REVERB_PRESETS.find((preset) =>
    (Object.keys(preset.settings) as Array<keyof RetroPresetSettings>).every(
      (key) => preset.settings[key] === spec[key],
    ),
  )?.number;
}
