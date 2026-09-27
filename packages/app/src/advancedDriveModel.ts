/** Immutable nested stage edits: hidden stages and other inserts remain untouched. */
import type { AdvancedDriveSpec, DriveStageSpec } from '@windsor/engine';
export function editDriveStage<K extends keyof DriveStageSpec>(
  spec: AdvancedDriveSpec,
  index: number,
  key: K,
  value: DriveStageSpec[K],
): AdvancedDriveSpec {
  return {
    ...spec,
    stages: spec.stages.map((stage, i) => (i === index ? { ...stage, [key]: value } : stage)),
  };
}
