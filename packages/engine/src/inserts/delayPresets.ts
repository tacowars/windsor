/** Presets write sound settings; Mix, output, Sustain and bypass stay user-owned. */
import { DEFAULT_DELAY } from './delaySpec';
import type { DelaySpec } from './delaySpec';
import { DELAY_PRESET_TABLE } from './delayPresetTables';

type Settings = Omit<DelaySpec, 'kind' | 'mix' | 'outputDb' | 'enabled' | 'sustain'>;
/** What a preset leaves to the user. */
const USER_OWNED: readonly string[] = ['kind', 'mix', 'outputDb', 'enabled', 'sustain'];
const base = Object.fromEntries(
  Object.entries(DEFAULT_DELAY).filter(([key]) => !USER_OWNED.includes(key)),
) as Settings;
export const DELAY_PRESETS = DELAY_PRESET_TABLE.map((entry) => ({
  id: entry.id,
  label: entry.label,
  settings: { ...base, ...entry.settings } as Settings,
}));
export function applyDelayPreset(spec: DelaySpec, id: string): DelaySpec {
  const preset = DELAY_PRESETS.find((entry) => entry.id === id);
  return preset ? { ...spec, ...preset.settings } : spec;
}
export function matchingDelayPreset(spec: DelaySpec): string | undefined {
  return DELAY_PRESETS.find((preset) =>
    (Object.keys(preset.settings) as Array<keyof Settings>).every(
      (key) => preset.settings[key] === spec[key],
    ),
  )?.id;
}
