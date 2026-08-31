/**
 * The game's patch set, assembled from the three groups it falls into naturally.
 *
 * Kept as one map because callers address a preset by name and do not care which
 * group it came from; the split exists so each file stays readable.
 */
import type { Patch } from './patch';
import { DRUMS_PRESETS } from './presetsDrums';
import { MUSIC_PRESETS } from './presetsMusic';
import { SFX_PRESETS } from './presetsSfx';

export const PRESETS: Record<string, Patch> = {
  ...MUSIC_PRESETS,
  ...DRUMS_PRESETS,
  ...SFX_PRESETS,
};

export const PRESET_NAMES = Object.keys(PRESETS);
