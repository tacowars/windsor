/** Apply an editable character without changing the insert's gain staging or bypass. */
import type { TapeSpec } from './tapeSpec';
import { TAPE_PRESETS } from './tapePresetTables';
export function applyTapePreset(spec: TapeSpec, id: string): TapeSpec {
  const preset = TAPE_PRESETS.find((p) => p.id === id);
  return preset ? { ...spec, ...preset.settings, split: true } : spec;
}
