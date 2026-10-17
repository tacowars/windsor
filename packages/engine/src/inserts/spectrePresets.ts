/**
 * Spectre's presets (record `2026-10-17-spectre-drawn-cells` decision 12):
 * the Starting point picker's reads and writes. Selecting a preset writes
 * every sound field (`SpectrePresetSettings`), so a preset is the whole
 * sound, the selection cleared; Mix, Output, Freeze's switch and the on/off
 * switch stay the user's. A song stores the values, never a preset number,
 * and the picker matches them back.
 */
import { SPECTRE_PRESETS, spectrePresetNumbered } from './spectrePresetBank';
import type { SpectrePresetGroup, SpectrePresetSettings } from './spectrePresetBase';
import type { SpectreSpec } from './spectreSpec';

export type { SpectrePreset, SpectrePresetGroup, SpectrePresetSettings } from './spectrePresetBase';
export { SPECTRE_PRESETS };

/** The groups in the picker's order. */
export const SPECTRE_PRESET_GROUPS: readonly SpectrePresetGroup[] = [
  'Drums',
  'Vocals & leads',
  'Pads & textures',
  'Freeze & FX',
];

/** `spec` with the preset's settings written over it: its Mix, Output, Freeze switch and on/off kept. */
export function applySpectrePreset(spec: SpectreSpec, number: number): SpectreSpec {
  const preset = spectrePresetNumbered(number);
  return preset ? { ...spec, ...preset.settings } : spec;
}

/** The number of the preset `spec` holds exactly, field by field and cell by cell, if any. */
export function matchingSpectrePreset(spec: SpectreSpec): number | undefined {
  return SPECTRE_PRESETS.find((preset) =>
    (Object.keys(preset.settings) as (keyof SpectrePresetSettings)[]).every(
      (key) => JSON.stringify(preset.settings[key]) === JSON.stringify(spec[key]),
    ),
  )?.number;
}
