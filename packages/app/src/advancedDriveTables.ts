/** Display labels only; numeric bounds and reset values stay in the engine. */
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
export const DRIVE_MOD_FIELDS = [
  ['envAmount', 'Env → amount'],
  ['envBias', 'Env → bias'],
  ['envCutoff', 'Env → cutoff (oct)'],
  ['lfoAmount', 'LFO → amount'],
  ['lfoBias', 'LFO → bias'],
  ['lfoCutoff', 'LFO → cutoff (oct)'],
] as const;
export const DRIVE_SOURCE_FIELDS = [
  ['rate', 'LFO Hz'],
  ['attack', 'Attack ms'],
  ['release', 'Release ms'],
  ['sensitivity', 'Env gain dB'],
] as const;
export const DRIVE_ROUTE_LABELS = ['Single', 'Serial', 'Parallel', 'Three-band', 'Mid/Side'];
export const DRIVE_ROUTE_DIAGRAMS = [
  'Input → Stage 1 → Output',
  'Input → Stage 1 → Stage 2 → Output · Blend: Stage 1 ↔ both',
  'Input → Stage 1 / Stage 2 → Blend → Output',
  'Input → Low / Mid / High → independent stages → Sum → Output',
  'Input → Mid / Side → independent stages → Stereo → Output',
];
export const DRIVE_PLOT = {
  width: 260,
  height: 100,
  points: 130,
  minHz: 20,
  maxHz: 20000,
  rate: 48000,
  minDb: -36,
  maxDb: 24,
  dbScale: 20,
};
