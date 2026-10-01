/**
 * Apply an editable character without changing the insert's gain staging or bypass. A starting
 * point clears the core's override, so the insert follows the preset's model (windsor#291).
 */
import { clearTapeCore } from './tapeControls';
import type { TapeSpec } from './tapeSpec';
import { TAPE_PRESETS } from './tapePresetTables';
export function applyTapePreset(spec: TapeSpec, id: string): TapeSpec {
  const preset = TAPE_PRESETS.find((p) => p.id === id);
  return preset ? { ...clearTapeCore(spec), ...preset.settings, split: true } : spec;
}
