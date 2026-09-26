/** Song-owned stages: normalisation constructs independent objects and retains inactive stages. */
import type { FieldNormaliser } from '../song/arrangementFields';
import {
  ADVANCED_DRIVE_DEFAULTS,
  ADVANCED_DRIVE_BOUNDS,
  DRIVE_STAGE_DEFAULTS,
  DRIVE_STAGE_BOUNDS,
  DRIVE_ROUTES,
  DRIVE_SHAPERS,
  DRIVE_FILTERS,
  DRIVE_LFO_SHAPES,
  DRIVE_DIVISIONS,
  DRIVE_DSP,
} from './advancedDriveConstants';

type Numbers<T> = { readonly [K in keyof T]: number };
export interface DriveStageSpec extends Numbers<typeof DRIVE_STAGE_DEFAULTS> {
  readonly enabled: boolean;
  readonly shaping: boolean;
  readonly filtering: boolean;
  readonly pre: boolean;
  readonly shaper: (typeof DRIVE_SHAPERS)[number];
  readonly filter: (typeof DRIVE_FILTERS)[number];
}
export interface AdvancedDriveSpec extends Numbers<typeof ADVANCED_DRIVE_DEFAULTS> {
  readonly kind: 'advanced-drive';
  readonly route: (typeof DRIVE_ROUTES)[number];
  readonly enabled: boolean;
  readonly compensation: boolean;
  readonly sync: boolean;
  readonly division: keyof typeof DRIVE_DIVISIONS;
  readonly wave: (typeof DRIVE_LFO_SHAPES)[number];
  readonly stages: readonly DriveStageSpec[];
}
export const DEFAULT_DRIVE_STAGE: DriveStageSpec = {
  ...DRIVE_STAGE_DEFAULTS,
  enabled: true,
  shaping: true,
  filtering: false,
  pre: false,
  shaper: 'soft',
  filter: 'lowpass',
};
export const DEFAULT_ADVANCED_DRIVE: AdvancedDriveSpec = {
  kind: 'advanced-drive',
  ...ADVANCED_DRIVE_DEFAULTS,
  route: 'single',
  enabled: true,
  compensation: true,
  sync: false,
  division: '1/4',
  wave: 'sine',
  stages: Array.from({ length: DRIVE_DSP.stages }, () => ({ ...DEFAULT_DRIVE_STAGE })),
};

export function normaliseDriveStage(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
): DriveStageSpec {
  const o = n.section(raw, path);
  n.dropUnknown(o, Object.keys(DEFAULT_DRIVE_STAGE), path);
  const out = { ...DEFAULT_DRIVE_STAGE };
  for (const key of Object.keys(DRIVE_STAGE_BOUNDS) as (keyof typeof DRIVE_STAGE_BOUNDS)[]) {
    const [min, max] = DRIVE_STAGE_BOUNDS[key];
    out[key] = n.num(o[key], out[key], min, max, `${path}.${key}`);
  }
  for (const key of ['enabled', 'shaping', 'filtering', 'pre'] as const)
    out[key] = n.bool(o[key], out[key], `${path}.${key}`);
  out.shaper = n.pick(o.shaper, DRIVE_SHAPERS, out.shaper, `${path}.shaper`);
  out.filter = n.pick(o.filter, DRIVE_FILTERS, out.filter, `${path}.filter`);
  return out;
}
export function normaliseAdvancedDrive(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): AdvancedDriveSpec {
  n.dropUnknown(raw, Object.keys(DEFAULT_ADVANCED_DRIVE), path);
  const out = { ...DEFAULT_ADVANCED_DRIVE };
  for (const key of Object.keys(ADVANCED_DRIVE_BOUNDS) as (keyof typeof ADVANCED_DRIVE_BOUNDS)[]) {
    const [min, max] = ADVANCED_DRIVE_BOUNDS[key];
    out[key] = n.num(raw[key], out[key], min, max, `${path}.${key}`);
  }
  for (const key of ['enabled', 'compensation', 'sync'] as const)
    out[key] = n.bool(raw[key], out[key], `${path}.${key}`);
  out.route = n.pick(raw.route, DRIVE_ROUTES, out.route, `${path}.route`);
  out.wave = n.pick(raw.wave, DRIVE_LFO_SHAPES, out.wave, `${path}.wave`);
  out.division = n.pick(
    raw.division,
    Object.keys(DRIVE_DIVISIONS) as (keyof typeof DRIVE_DIVISIONS)[],
    out.division,
    `${path}.division`,
  );
  if (out.high < out.low * DRIVE_DSP.crossoverRatio) {
    out.high = out.low * DRIVE_DSP.crossoverRatio;
    n.correction(`${path}.high: raised to preserve crossover spacing`);
  }
  if (raw.stages !== undefined && !Array.isArray(raw.stages))
    n.correction(`${path}.stages: not a list — using defaults`);
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  if (stages.length > DRIVE_DSP.stages) n.correction(`${path}.stages: extra stages dropped`);
  out.stages = Array.from({ length: DRIVE_DSP.stages }, (_, i) =>
    normaliseDriveStage(stages[i], `${path}.stages[${i}]`, n),
  );
  return out;
}
