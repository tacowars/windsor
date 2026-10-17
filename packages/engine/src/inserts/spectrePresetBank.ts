/**
 * Spectre's preset bank (record `2026-10-17-spectre-drawn-cells` decision
 * 12): twenty-four presets in four groups, the Starting point picker's
 * order, one table file a group.
 */
import type { SpectrePreset } from './spectrePresetBase';
import { SPECTRE_PRESETS_DRUMS } from './spectrePresetsDrums';
import { SPECTRE_PRESETS_FREEZE } from './spectrePresetsFreeze';
import { SPECTRE_PRESETS_PADS } from './spectrePresetsPads';
import { SPECTRE_PRESETS_VOCALS } from './spectrePresetsVocals';

export const SPECTRE_PRESETS: readonly SpectrePreset[] = [
  ...SPECTRE_PRESETS_DRUMS,
  ...SPECTRE_PRESETS_VOCALS,
  ...SPECTRE_PRESETS_PADS,
  ...SPECTRE_PRESETS_FREEZE,
];

/** The preset numbered `number`, if the bank has it. */
export const spectrePresetNumbered = (number: number): SpectrePreset | undefined =>
  SPECTRE_PRESETS.find((entry) => entry.number === number);
