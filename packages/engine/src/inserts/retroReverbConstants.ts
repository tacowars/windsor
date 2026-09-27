/** Original vintage-reverb tunables (#682); no factory microcode or delay tables. */
export const RETRO_REVERB_NAME = 'retro-reverb';
export const RETRO_REVERB_MODES = ['reverb', 'gated', 'reverse'] as const;
export const RETRO_REVERB_BOUNDS = {
  decay: [0.2, 20],
  size: [0.25, 3],
  tone: [800, 9000],
  diffusion: [0, 1],
  preDelay: [0, 0.25],
  character: [0, 1],
  mix: [0, 1],
  duration: [0.1, 0.6],
} as const;
export const RETRO_REVERB_DEFAULTS = {
  decay: 1.4,
  size: 1,
  tone: 4200,
  diffusion: 0.7,
  preDelay: 0,
  character: 0.65,
  mix: 0.3,
  enabled: true,
  duration: 0.3,
};
export const RETRO_REVERB_DSP = {
  rate: 23437.5,
  bandwidth: 9000,
  smoothSeconds: 0.05,
  // Independently chosen, unequal lengths; seconds, never ROM offsets.
  tankSeconds: [0.0311, 0.0377, 0.0433, 0.0539],
  diffuserSeconds: [0.0031, 0.0053, 0.0097],
  maxDiffusion: 0.65,
  inputTrim: 0.25,
  outputTrim: 0.6,
  stateLimit: 4,
  silenceFloor: 1e-12,
  converterSteps: 2048,
  reflectionCount: 192,
  reflectionSeed: 682,
  reflectionTrim: 0.55,
  reflectionJitterStart: 0.2,
  reflectionJitterSpan: 0.6,
  reflectionSparseStride: 4,
  reflectionEdgeFraction: 0.02,
  filterSections: 2,
  filterPoleDivisor: 8,
  hostBandwidthRatio: 0.4,
  decayTarget: 0.001,
  millisecondsPerSecond: 1000,
} as const;
