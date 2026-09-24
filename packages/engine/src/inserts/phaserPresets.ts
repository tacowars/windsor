/** Presets write sound values; the song never depends on a bank version. */
import type { PhaserSpec } from './phaserSpec';
import { PHASER_PRESETS } from './phaserPresetTables';
import type { PhaserSettings } from './phaserPresetTables';
export { PHASER_PRESETS };
export function applyPhaserPreset(spec: PhaserSpec, id: string): PhaserSpec {
  const preset = PHASER_PRESETS.find((entry) => entry.id === id);
  return preset ? { ...spec, ...preset.settings } : spec;
}
export function matchingPhaserPreset(spec: PhaserSpec): string | undefined {
  return PHASER_PRESETS.find((preset) =>
    (Object.keys(preset.settings) as Array<keyof PhaserSettings>).every(
      (key) => preset.settings[key] === spec[key],
    ),
  )?.id;
}
