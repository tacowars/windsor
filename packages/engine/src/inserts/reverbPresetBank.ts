/**
 * Windsor's Reverb bank (windsor#774): 27 presets in four groups, numbered in the Starting point
 * picker's order, the groups' tables concatenated. Each group's table file lists its presets'
 * measured T30, level against Resident and peak; `docs/research/2026-10-12-reverb-preset-bank/`
 * has the rig and the whole bank's figures.
 */
import { AMBIENT_PRESETS } from './reverbPresetsAmbient';
import { DRUMS_PRESETS } from './reverbPresetsDrums';
import { EVERYDAY_PRESETS } from './reverbPresetsEveryday';
import { PADS_PRESETS } from './reverbPresetsPads';
import type { ReverbPreset } from './reverbPresets';

export const REVERB_PRESETS: readonly ReverbPreset[] = [
  ...EVERYDAY_PRESETS,
  ...DRUMS_PRESETS,
  ...PADS_PRESETS,
  ...AMBIENT_PRESETS,
];
