/** Immutable nested stage edits: hidden stages and other inserts remain untouched. */
import type { AdvancedDriveSpec, DriveStageSpec } from '@windsor/engine';
import {
  DRIVE_MAIN_PAGE,
  DRIVE_MOD_PAGE,
  DRIVE_ROUTE_STAGES,
  DRIVE_STAGE_PAGE,
} from './advancedDriveTables';

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

/** One of Advanced Drive's pages: Main, a stage by its 0-based index, or Mod. */
export type DrivePage =
  | { readonly kind: 'main'; readonly name: string }
  | {
      readonly kind: 'stage';
      readonly name: string;
      readonly stage: number;
      readonly title: string;
    }
  | { readonly kind: 'mod'; readonly name: string };

/**
 * Advanced Drive's pages for `route` (windsor#174 decision 1): Main, one
 * Stage page per stage the routing uses, then Mod. A routing change changes
 * the Stage pages, and the rack shows Main when the page shown is gone.
 */
export function drivePages(route: AdvancedDriveSpec['route']): DrivePage[] {
  const stages = DRIVE_ROUTE_STAGES[route].map((title, stage): DrivePage => ({
    kind: 'stage',
    name: `${DRIVE_STAGE_PAGE} ${stage + 1}`,
    stage,
    title,
  }));
  return [
    { kind: 'main', name: DRIVE_MAIN_PAGE },
    ...stages,
    { kind: 'mod', name: DRIVE_MOD_PAGE },
  ];
}
