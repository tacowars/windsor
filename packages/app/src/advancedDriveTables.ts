/** Display labels only; numeric bounds and reset values stay in the engine. */
import type { AdvancedDriveSpec } from '@windsor/engine';

type DriveRoute = AdvancedDriveSpec['route'];

export const DRIVE_GLOBAL_FIELDS = [
  ['drive', 'Input dB'],
  ['tone', 'Tilt dB'],
  ['pivot', 'Tilt Hz'],
  ['output', 'Output dB'],
  ['mix', 'Mix'],
] as const;
export const DRIVE_STAGE_FIELDS = [
  ['amount', 'Amount'],
  ['bias', 'Bias'],
  ['level', 'Level dB'],
  ['frequency', 'Cutoff Hz'],
  ['resonance', 'Resonance Q'],
  ['peak', 'Peak dB'],
] as const;
/** In the rack's order: each column pairs a target's envelope amount over its LFO amount. */
export const DRIVE_MOD_FIELDS = [
  ['envAmount', 'Env → amount'],
  ['lfoAmount', 'LFO → amount'],
  ['envBias', 'Env → bias'],
  ['lfoBias', 'LFO → bias'],
  ['envCutoff', 'Env → cut oct'],
  ['lfoCutoff', 'LFO → cut oct'],
] as const;
export const DRIVE_SOURCE_FIELDS = [
  ['rate', 'LFO Hz'],
  ['attack', 'Attack ms'],
  ['release', 'Release ms'],
  ['sensitivity', 'Env gain dB'],
] as const;
/** The routing-dependent knobs on the Main page: the crossovers, or the blend. */
export const DRIVE_ROUTE_FIELDS: Readonly<
  Record<DriveRoute, readonly (readonly ['low' | 'high' | 'blend', string])[]>
> = {
  single: [],
  serial: [['blend', 'Blend']],
  parallel: [['blend', 'Blend']],
  multiband: [
    ['low', 'Low crossover Hz'],
    ['high', 'High crossover Hz'],
  ],
  'mid-side': [],
};
export const DRIVE_ROUTE_LABELS = ['Single', 'Serial', 'Parallel', 'Three-band', 'Mid/Side'];
export const DRIVE_ROUTE_DIAGRAMS = [
  'Input → Stage 1 → Output',
  'Input → Stage 1 → Stage 2 → Output · Blend: Stage 1 ↔ both',
  'Input → Stage 1 / Stage 2 → Blend → Output',
  'Input → Low / Mid / High → independent stages → Sum → Output',
  'Input → Mid / Side → independent stages → Stereo → Output',
];
/**
 * What each stage a routing uses works on, in order (windsor#174 decision
 * 1): one Stage page per entry, whose tab's tooltip it is.
 */
export const DRIVE_ROUTE_STAGES: Readonly<Record<DriveRoute, readonly string[]>> = {
  single: ['Stage 1'],
  serial: ['Stage 1', 'Stage 2'],
  parallel: ['Stage 1', 'Stage 2'],
  multiband: ['Low band', 'Mid band', 'High band'],
  'mid-side': ['Mid', 'Side'],
};
/** The pages around the Stage pages. */
export const DRIVE_MAIN_PAGE = 'Main';
export const DRIVE_MOD_PAGE = 'Mod';
export const DRIVE_STAGE_PAGE = 'Stage';
/** What the envelope and the LFO work on: the Mod page's note, and its tooltip. */
export const DRIVE_SOURCE_NOTE = 'Env follows the input';
export const DRIVE_SOURCE_HELP =
  'Envelope follows this insert’s stereo input. Cutoff modulation is in octaves. LFO Hz applies when Sync is off.';
export const DRIVE_PLOT = {
  width: 124,
  height: 80,
  points: 130,
  minHz: 20,
  maxHz: 20000,
  rate: 48000,
  minDb: -36,
  maxDb: 24,
  dbScale: 20,
  /** The shaper's grid crosses at 0 in, 0 out: the middle of the plot. */
  shaperOrigin: 0.5,
  /** The filter's grid: 0 dB across, and this frequency up. */
  gridHz: 1000,
};
