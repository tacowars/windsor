/**
 * What a Spectre preset is (record `2026-10-17-spectre-drawn-cells` decision
 * 12): every sound field but Mix, Output, Freeze's switch and the on/off
 * switch, which stay the user's; and the neutral base each preset table
 * writes its idea over, so a preset only names what it changes. The base
 * is read from the constants, never from `DEFAULT_SPECTRE`, which is itself
 * a preset's settings.
 */
import { SPECTRE_CHOICES, SPECTRE_DEFAULTS } from './spectreConstants';
import { flat, linked } from './spectreRecipes';
import type { SpectreSpec } from './spectreSpec';

export type SpectrePresetSettings = Omit<
  SpectreSpec,
  'kind' | 'mix' | 'outputDb' | 'freeze' | 'enabled'
>;
/** The picker's groups, in its order. */
export type SpectrePresetGroup = 'Drums' | 'Vocals & leads' | 'Pads & textures' | 'Freeze & FX';
export interface SpectrePreset {
  readonly number: number;
  readonly label: string;
  readonly group: SpectrePresetGroup;
  readonly settings: SpectrePresetSettings;
}

/** `source` without `keys`: the fields a preset leaves to the user. */
function without<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...source };
  for (const key of keys) delete out[key];
  return out;
}
const choices = without(SPECTRE_CHOICES, ['freeze']);
const moves = without(SPECTRE_DEFAULTS, ['mix', 'outputDb']);

/** `changes` over a neutral Spectre: every band whole and undelayed, nothing modulated, nothing selected. */
export const spectrePreset = (changes: Partial<SpectrePresetSettings>): SpectrePresetSettings => ({
  ...choices,
  ...moves,
  curves: { gain: linked(flat(1)), delay: linked(flat(0)), feedback: linked(flat(0)) },
  selection: [],
  ...changes,
});
