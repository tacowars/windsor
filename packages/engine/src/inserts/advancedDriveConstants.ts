/** Advanced Drive's saved vocabulary and original tuning, shared by DSP and editor. */
export const ADVANCED_DRIVE_NAME = 'advanced-drive';
export const DRIVE_ROUTES = ['single', 'serial', 'parallel', 'multiband', 'mid-side'] as const;
export const DRIVE_SHAPERS = [
  'soft',
  'hard',
  'diode',
  'tube',
  'half-wave',
  'full-wave',
  'fold',
  'crush',
] as const;
export const DRIVE_FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch', 'peak'] as const;
export const DRIVE_LFO_SHAPES = ['sine', 'triangle', 'square', 'up', 'down'] as const;
export const DRIVE_DIVISIONS = {
  '1/16': 0.25,
  '1/8': 0.5,
  '1/8D': 0.75,
  '1/4': 1,
  '1/2': 2,
  '1/1': 4,
  '2/1': 8,
} as const;
export const ADVANCED_DRIVE_BOUNDS = {
  drive: [-24, 36],
  tone: [-12, 12],
  pivot: [80, 6000],
  output: [-36, 12],
  mix: [0, 1],
  blend: [0, 1],
  low: [40, 4000],
  high: [200, 16000],
  rate: [0.01, 20],
  attack: [1, 500],
  release: [10, 2000],
  sensitivity: [-24, 36],
} as const;
export const ADVANCED_DRIVE_DEFAULTS = {
  drive: 0,
  tone: 0,
  pivot: 500,
  output: 0,
  mix: 1,
  blend: 0.5,
  low: 200,
  high: 2000,
  rate: 0.25,
  attack: 10,
  release: 180,
  sensitivity: 0,
};
export const DRIVE_STAGE_BOUNDS = {
  amount: [0, 1],
  bias: [-1, 1],
  level: [-24, 24],
  frequency: [20, 20000],
  resonance: [0.5, 12],
  peak: [-18, 18],
  envAmount: [-1, 1],
  envBias: [-1, 1],
  envCutoff: [-5, 5],
  lfoAmount: [-1, 1],
  lfoBias: [-1, 1],
  lfoCutoff: [-5, 5],
} as const;
export const DRIVE_STAGE_DEFAULTS = {
  amount: 0.25,
  bias: 0,
  level: 0,
  frequency: 12000,
  resonance: Math.SQRT1_2,
  peak: 0,
  envAmount: 0,
  envBias: 0,
  envCutoff: 0,
  lfoAmount: 0,
  lfoBias: 0,
  lfoCutoff: 0,
};
export const DRIVE_DSP = {
  stages: 3,
  oversample: 2,
  firLength: 65,
  firCutoff: 0.235,
  smoothSeconds: 0.02,
  transitionSeconds: 0.008,
  controlStride: 16,
  dcHz: 8,
  maxFrequencyRatio: 0.45,
  dbDivisor: 20,
  ms: 1000,
  secondsPerMinute: 60,
  defaultTempo: 120,
  crossoverRatio: 1.25,
  driveScale: 30,
  crushBits: 16,
  crushRange: 14,
  tubeEven: 0.18,
  diodeKnee: 0.65,
  silence: 1e-12,
  maxInternal: 64,
};

export const DRIVE_ROUTE_IDS = {
  single: 0,
  serial: 1,
  parallel: 2,
  multiband: 3,
  midSide: 4,
} as const;
export const DRIVE_LFO_IDS = { sine: 0, triangle: 1, square: 2, up: 3, down: 4 } as const;
export const DRIVE_MATH = { decimal: 10, half: 0.5, blackmanA: 0.42, blackmanB: 0.08, four: 4 };
export const DRIVE_CROSSOVER = { filters: 11, pair: 4, allpassStart: 8, dryLow: 9 };
