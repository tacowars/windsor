/** Presets write sound settings; Mix, output and bypass stay user-owned. */
import { DEFAULT_DELAY } from './delaySpec';
import type { DelaySpec } from './delaySpec';
import { DELAY_PRESET_TABLE } from './delayPresetTables';

type Settings = Omit<DelaySpec, 'kind' | 'mix' | 'outputDb' | 'enabled'>;
const base: Settings = {
  mode: DEFAULT_DELAY.mode,
  leftSync: DEFAULT_DELAY.leftSync,
  rightSync: DEFAULT_DELAY.rightSync,
  leftDivision: DEFAULT_DELAY.leftDivision,
  rightDivision: DEFAULT_DELAY.rightDivision,
  leftMs: DEFAULT_DELAY.leftMs,
  rightMs: DEFAULT_DELAY.rightMs,
  feedback: DEFAULT_DELAY.feedback,
  highpass: DEFAULT_DELAY.highpass,
  lowpass: DEFAULT_DELAY.lowpass,
  drive: DEFAULT_DELAY.drive,
};
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
