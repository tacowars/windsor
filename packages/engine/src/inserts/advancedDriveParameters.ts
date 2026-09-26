/** A flat AudioParam vocabulary shared by adapter, processor and render harness. */
import type { AdvancedDriveSpec } from './advancedDriveSpec';
import { DEFAULT_ADVANCED_DRIVE } from './advancedDriveSpec';
import {
  ADVANCED_DRIVE_BOUNDS,
  DRIVE_STAGE_BOUNDS,
  DRIVE_DSP,
  DRIVE_ROUTES,
  DRIVE_SHAPERS,
  DRIVE_FILTERS,
  DRIVE_LFO_SHAPES,
  DRIVE_DIVISIONS,
} from './advancedDriveConstants';

export function advancedDriveParameters(
  spec: AdvancedDriveSpec,
  bpm = DRIVE_DSP.defaultTempo,
): Record<string, number> {
  const data: Record<string, number> = {
    bpm,
    route: DRIVE_ROUTES.indexOf(spec.route),
    wave: DRIVE_LFO_SHAPES.indexOf(spec.wave),
    beats: DRIVE_DIVISIONS[spec.division],
  };
  for (const key of Object.keys(ADVANCED_DRIVE_BOUNDS) as (keyof typeof ADVANCED_DRIVE_BOUNDS)[])
    data[key] = spec[key];
  for (const key of ['enabled', 'compensation', 'sync'] as const) data[key] = Number(spec[key]);
  spec.stages.forEach((stage, i) => {
    for (const key of Object.keys(DRIVE_STAGE_BOUNDS) as (keyof typeof DRIVE_STAGE_BOUNDS)[])
      data[`s${i}_${key}`] = stage[key];
    for (const key of ['enabled', 'shaping', 'filtering', 'pre'] as const)
      data[`s${i}_${key}`] = Number(stage[key]);
    data[`s${i}_shaper`] = DRIVE_SHAPERS.indexOf(stage.shaper);
    data[`s${i}_filter`] = DRIVE_FILTERS.indexOf(stage.filter);
  });
  return data;
}
export const ADVANCED_DRIVE_PARAMETERS = Object.entries(
  advancedDriveParameters(DEFAULT_ADVANCED_DRIVE),
).map(([name, defaultValue]) => ({ name, defaultValue, automationRate: 'k-rate' as const }));
