/** The ensemble's presets (#695): selecting one writes values; Width, Mix and the on switch stay the user's. */
import type { EnsembleSpec } from './ensembleSpec';
import { ENSEMBLE_PRESETS } from './ensemblePresetTables';
import { applyInsertPreset, matchingInsertPreset } from './insertPresets';

export { ENSEMBLE_PRESETS };

export function applyEnsemblePreset(spec: EnsembleSpec, id: string): EnsembleSpec {
  return applyInsertPreset(ENSEMBLE_PRESETS, spec, id);
}

export function matchingEnsemblePreset(spec: EnsembleSpec): string | undefined {
  return matchingInsertPreset(ENSEMBLE_PRESETS, spec);
}
