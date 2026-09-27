/** Presets preserve listening level/bypass; nested stages are copied and compared by values. */
import type { AdvancedDriveSpec } from './advancedDriveSpec';
import { ADVANCED_DRIVE_PRESETS } from './advancedDrivePresetTables';
export { ADVANCED_DRIVE_PRESETS } from './advancedDrivePresetTables';
export function applyAdvancedDrivePreset(spec: AdvancedDriveSpec, id: string): AdvancedDriveSpec {
  const preset = ADVANCED_DRIVE_PRESETS.find((p) => p.id === id);
  return preset
    ? {
        ...spec,
        ...preset.settings,
        stages: (preset.settings.stages ?? spec.stages).map((s) => ({ ...s })),
      }
    : spec;
}
export function matchingAdvancedDrivePreset(spec: AdvancedDriveSpec): string | undefined {
  return ADVANCED_DRIVE_PRESETS.find((p) =>
    Object.entries(p.settings).every(
      ([key, value]) =>
        JSON.stringify(spec[key as keyof AdvancedDriveSpec]) === JSON.stringify(value),
    ),
  )?.id;
}
