/** Original four-stage phaser controls; frequencies in Hz, sweep amounts in octaves. */
export const PHASER_NAME = 'phaser';
export const PHASER_BOUNDS = {
  rate: [0.01, 8],
  center: [80, 4000],
  depth: [0, 4],
  feedback: [-0.9, 0.9],
  feedbackCut: [20, 2000],
  stereo: [0, 180],
  envelope: [-4, 4],
  bassKeep: [0, 1],
  mix: [0, 1],
} as const;
export const PHASER_DEFAULTS = {
  rate: 0.2,
  center: 900,
  depth: 2,
  feedback: 0.25,
  feedbackCut: 350,
  stereo: 0,
  envelope: 0,
  bassKeep: 0,
  mix: 0.5,
  enabled: true,
};
export const PHASER_DSP = {
  stages: 4,
  smoothSeconds: 0.03,
  attackSeconds: 0.008,
  releaseSeconds: 0.18,
  envelopeGain: 4,
  bassHz: 150,
  minHz: 20,
  maxRateRatio: 0.2,
  feedbackLimit: 2,
  degreesPerTurn: 360,
  millisecondsPerSecond: 1000,
} as const;
