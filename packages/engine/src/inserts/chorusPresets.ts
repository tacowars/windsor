/** The chorus's presets (#695): selecting one writes values; Mix and the on switch stay the user's. */
import type { ChorusSpec } from './chorusInsert';
import { CHORUS_PRESETS } from './chorusPresetTables';
import { applyInsertPreset, matchingInsertPreset } from './insertPresets';

export { CHORUS_PRESETS };

export function applyChorusPreset(spec: ChorusSpec, id: string): ChorusSpec {
  return applyInsertPreset(CHORUS_PRESETS, spec, id);
}

export function matchingChorusPreset(spec: ChorusSpec): string | undefined {
  return matchingInsertPreset(CHORUS_PRESETS, spec);
}
